import { readFile } from "node:fs/promises"
import http from "node:http"
import { configuration } from "./configuration.mjs"
import Docker from "./docker.mjs"
import createHandler from "./handler.mjs"
import Sessions from "./sessions.mjs"
import { demoPage, unavailable } from "./pages.mjs"
import { proxyUpgrade } from "./proxy.mjs"
import { requestHostname } from "./session-host.mjs"

const config = configuration()
const docker = new Docker(config.socket)
const sessions = new Sessions({
  docker,
  image: config.image,
  network: config.network,
  domain: config.sessionDomain,
  statePath: config.state,
  idleMilliseconds: config.idleMilliseconds,
  maxSessions: config.maxSessions
})

await sessions.initialize()

const upgraded = new Set()
const scriptPath = "/__manager/demo.js"
const page = {
  html: demoPage(scriptPath),
  script: await readFile(new URL("../dist/demo.js", import.meta.url), "utf8"),
  scriptPath
}
const handle = createHandler({ config, sessions, page })
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
  socket.on("close", () => upgraded.delete(socket))
  proxyUpgrade(request, socket, head, record, {
    connected: () => sessions.connected(record),
    disconnected: () => sessions.disconnected(record)
  })
})

server.listen(config.port, config.host, () => {
  console.log(`PhreshOS demo manager listening on http://${config.host}:${config.port}`)
})

const cleanup = setInterval(() => void sessions.expireIdle().catch(error => console.error(error)), 30_000)
cleanup.unref()

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void shutdown())

async function shutdown() {
  clearInterval(cleanup)
  for (const socket of upgraded) socket.destroy()
  await new Promise(resolve => server.close(resolve))
  await sessions.persist()
  process.exit(0)
}
