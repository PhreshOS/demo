import { robots, unavailable } from "./pages.mjs"
import { proxyRequest } from "./proxy.mjs"
import { requestHostname } from "./session-host.mjs"
import { createToken, sessionCookie, sessionToken } from "./session-token.mjs"

export default function createHandler({ config, sessions, page, activity = null }) {
  const note = (event, fields, request) => activity?.record(event, fields, request)

  return async function handle(request, response) {
    const url = new URL(request.url ?? "/", `https://${config.entryHost}`)

    if (url.pathname === "/robots.txt") {
      sendText(response, 200, robots())
      return
    }

    if (url.pathname === "/__manager/health") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      response.end('{"status":"ready"}\n')
      return
    }

    const hostname = requestHostname(request.headers.host)
    if (hostname === config.entryHost) {
      await handleEntry(request, response, url)
      return
    }

    const record = sessions.getByHostname(hostname)
    if (!record) {
      // A desktop that has ended sends its visitor back to start a new one, told why.
      if (request.method === "GET" && url.pathname === "/") redirectTo(response, `https://${config.entryHost}/?ended`)
      else send(response, 404, unavailable("This desktop link is invalid or has ended."))
      return
    }

    if (record.pending) {
      await record.pending
      if (response.destroyed) return
    }

    if (record.status === "failed") {
      send(response, 502, unavailable("This desktop could not be started."))
      return
    }

    if (request.method === "GET" && url.pathname === "/") note("desktop", { desktop: name(record) }, request)
    proxyRequest(request, response, record)
  }

  async function handleEntry(request, response, url) {
    if (url.pathname === "/__manager/start") {
      await start(request, response)
      return
    }
    if (url.pathname === page.scriptPath) {
      sendScript(response, page.script)
      return
    }
    if (url.pathname !== "/") {
      send(response, 404, unavailable("This desktop link is invalid or has ended."))
      return
    }
    const selected = sessionToken(request.headers.cookie)
    if (!selected.valid) {
      send(response, 400, unavailable("The browser session is invalid."))
      return
    }
    const record = selected.token ? sessions.get(selected.token) : null
    note("page", { desktop: record ? name(record) : null }, request)
    if (record?.status === "ready") {
      redirect(response, record.hostname)
      return
    }
    // The page starts or follows the desktop itself, and shows a failure too.
    send(response, 200, page.html, selected.token ? undefined : sessionCookie(createToken()), true)
  }

  async function start(request, response) {
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST", "cache-control": "no-store" })
      response.end()
      return
    }

    const selected = sessionToken(request.headers.cookie)
    if (!selected.valid || selected.source !== "cookie" || !selected.token) {
      sendProgress(response, 400, [{ status: "failed" }])
      return
    }

    // Trying again replaces a desktop that failed to start.
    const previous = sessions.get(selected.token)
    if (previous?.status === "failed") await sessions.remove(previous, "failed")
    const existing = previous?.status === "failed" ? null : previous
    const record = existing ?? sessions.create(selected.token)
    note(record ? (existing ? "resume" : "start") : "full", { desktop: record ? name(record) : null }, request)
    if (!record) {
      // A duration, not a time, so the visitor's clock need not agree with the manager's.
      sendProgress(response, 503, [{ status: "full", freesIn: sessions.freesIn() }])
      return
    }

    // One line per status as it changes; the last names the desktop or the failure.
    await new Promise(resolve => {
      const report = () => {
        if (response.destroyed) return finish()
        response.write(`${JSON.stringify(progress(record))}\n`)
        if (record.status === "ready" || record.status === "failed") {
          response.end()
          finish()
        }
      }
      const unwatch = sessions.watch(record, report)
      const finish = () => {
        unwatch()
        resolve()
      }
      response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" })
      report()
    })
  }
}

/** The failure's cause stays in the manager's log; the page only learns that it failed. */
function progress(record) {
  return record.status === "ready" ? { status: "ready", desktop: `https://${record.hostname}/` } : { status: record.status }
}

function sendProgress(response, status, lines) {
  response.writeHead(status, { "content-type": "application/x-ndjson", "cache-control": "no-store" })
  response.end(lines.map(line => `${JSON.stringify(line)}\n`).join(""))
}

function redirectTo(response, location) {
  response.writeHead(302, { location, "cache-control": "no-store" })
  response.end()
}

function redirect(response, hostname, status = 302) {
  response.writeHead(status, { location: `https://${hostname}/`, "cache-control": "no-store" })
  response.end()
}

function send(response, status, body, cookie, scripts = false) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'${scripts ? "; script-src 'self'; connect-src 'self'; img-src data:" : ""}`,
    ...(cookie ? { "set-cookie": cookie } : {})
  })
  response.end(body)
}

function sendScript(response, body) {
  response.writeHead(200, {
    "content-type": "text/javascript; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    // Its path names its content, so a new page is a new path and this one never changes.
    "cache-control": "public, max-age=31536000, immutable"
  })
  response.end(body)
}

function sendText(response, status, body) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "public, max-age=86400"
  })
  response.end(body)
}

/** A desktop's short name in the activity log: the first label of its hostname. */
export function name(record) {
  return record.hostname.split(".")[0]
}
