import http from "node:http"
import { withoutSessionCookie } from "./session-token.mjs"

const hopByHop = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade"
])

export function proxyRequest(request, response, session) {
  const headers = requestHeaders(request)
  const upstream = http.request({
    hostname: session.containerName,
    port: 4300,
    method: request.method,
    path: upstreamPath(request.url),
    headers
  }, incoming => {
    const outgoing = responseHeaders(incoming.headers)
    response.writeHead(incoming.statusCode ?? 502, outgoing)
    incoming.pipe(response)
  })
  upstream.on("error", error => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
    response.end(`The desktop is unavailable: ${error.message}`)
  })
  request.pipe(upstream)
}

export function proxyUpgrade(request, socket, head, session) {
  const upstream = http.request({
    hostname: session.containerName,
    port: 4300,
    method: request.method,
    path: upstreamPath(request.url),
    headers: requestHeaders(request, true)
  })

  upstream.on("upgrade", (response, target, targetHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`)
    for (let index = 0; index < response.rawHeaders.length; index += 2) {
      socket.write(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`)
    }
    socket.write("\r\n")
    if (targetHead.length) socket.write(targetHead)
    if (head.length) target.write(head)
    // Either side closing ends the other.
    socket.on("close", () => target.destroy())
    target.on("close", () => socket.destroy())
    socket.pipe(target).pipe(socket)
  })

  upstream.on("response", response => {
    socket.write(`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? "Upgrade failed"}\r\nConnection: close\r\n\r\n`)
    socket.destroy()
  })
  upstream.on("error", () => socket.destroy())
  upstream.end()
}

function requestHeaders(request, upgrade = false) {
  const headers = { ...request.headers }
  for (const name of hopByHop) if (!upgrade || (name !== "connection" && name !== "upgrade")) delete headers[name]
  const cookies = withoutSessionCookie(request.headers.cookie)
  if (cookies) headers.cookie = cookies
  else delete headers.cookie
  headers["x-forwarded-host"] = request.headers.host ?? ""
  headers["x-forwarded-proto"] = "https"
  return headers
}

function responseHeaders(headers) {
  const output = { ...headers }
  for (const name of hopByHop) delete output[name]
  return output
}

function upstreamPath(value = "/") {
  const url = new URL(value, "http://demo.invalid")
  return `${url.pathname}${url.search}`
}
