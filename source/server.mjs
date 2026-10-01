import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import http from "node:http"
import { configuration } from "./configuration.mjs"
import Docker from "./docker.mjs"
import Activity from "./activity.mjs"
import createHandler, { name } from "./handler.mjs"
import Sessions from "./sessions.mjs"
import Images from "./images.mjs"
import { demoPage, unavailable } from "./pages.mjs"
import { proxyUpgrade } from "./proxy.mjs"
import { requestHostname } from "./session-host.mjs"

const config = configuration()
const activity = new Activity({ directory: config.activity })
const docker = new Docker(config.socket)
const images = new Images({ docker, repository: config.repository, root: new URL("..", import.meta.url).pathname })
const sessions = new Sessions({
  docker,
  image: `${config.repository}:current`,
  network: config.network,
  domain: config.sessionDomain,
  statePath: config.state,
  lifetimeMilliseconds: config.lifetimeMilliseconds,
  maxSessions: config.maxSessions,
  onRemove: record => void activity.record("end", { desktop: name(record), lived: Math.round((Date.now() - record.createdAt) / 1000) })
})

await sessions.initialize()

const upgraded = new Set()
const script = await readFile(new URL("../dist/demo.js", import.meta.url), "utf8")
// Named by its content: caches in between can keep it forever, and never serve an old page.
const scriptPath = `/__manager/demo-${createHash("sha256").update(script).digest("hex").slice(0, 12)}.js`
const page = { html: demoPage(scriptPath), script, scriptPath }
const handle = createHandler({ config, sessions, page, activity })
const server = http.createServer((request, response) => {
  void handle(request, response).catch(error => {
    console.error(error)
    if (response.headersSent) response.destroy()
    else send(response, 500, unavailable("The desktop could not be started."))
  })
})

server.on("upgrade", (request, socket, head) => {
  const record = sessions.getByHostname(requestHostname(request.headers.host))
  if (!record || record.status !== "ready") {
    socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n")
    return
  }
  upgraded.add(socket)
  // A connected browser is what using a desktop means; how long it stayed tells use from a glance.
  const connected = Date.now()
  void activity.record("connect", { desktop: name(record) }, request)
  socket.on("close", () => {
    upgraded.delete(socket)
    void activity.record("disconnect", { desktop: name(record), stayed: Math.round((Date.now() - connected) / 1000) }, request)
  })
  proxyUpgrade(request, socket, head, record)
})

server.listen(config.port, config.host, () => {
  console.log(`PhreshOS demo manager listening on http://${config.host}:${config.port}`)
})

const cleanup = setInterval(() => void sessions.expire().catch(error => console.error(error)), 5_000)
cleanup.unref()

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void shutdown())

// Every release reaches the demo on its own: the image follows the latest CLI, System, and Sprout.
const checkImage = () => void images.refresh().catch(error => console.error("The demo image could not be refreshed:", error))
checkImage()
const imageCheck = setInterval(checkImage, config.imageCheckMilliseconds)
imageCheck.unref()

async function shutdown() {
  clearInterval(cleanup)
  clearInterval(imageCheck)
  for (const socket of upgraded) socket.destroy()
  await new Promise(resolve => server.close(resolve))
  await sessions.persist()
  process.exit(0)
}
