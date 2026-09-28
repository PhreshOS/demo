import { spawn } from "node:child_process"
import { access, chmod, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { pathToFileURL } from "node:url"

const seed = "/usr/local/share/phreshos-demo/machine-seed.tar"
const seeded = "/var/lib/phreshos/.demo-machine-seeded"
export const machineSocket = "/run/phreshos-demo-machine.sock"
const realCli = "/usr/local/bin/phresh"

export async function runMachine({ provision = provisionMachine, command = phresh, supervise = createSupervisor, shutdown = waitForShutdown } = {}) {
  await provision()
  const supervisor = await supervise()
  let started = false

  try {
    await command(["system", "start"])
    started = true
    await shutdown()
  } finally {
    await supervisor.close()
    if (started) await command(["system", "stop"])
  }
}

async function provisionMachine() {
  try {
    await access(seeded)
    return
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }

  await execute("tar", ["-xf", seed, "-C", "/"])
  await writeFile(seeded, "")
}

function phresh(arguments_) {
  return execute(realCli, arguments_)
}

function execute(executable, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd: options.cwd,
      env: process.env,
      stdio: options.output ? ["ignore", "pipe", "pipe"] : "inherit"
    })

    child.stdout?.on("data", chunk => options.output("stdout", String(chunk)))
    child.stderr?.on("data", chunk => options.output("stderr", String(chunk)))

    child.once("error", reject)
    child.once("close", code => {
      if (code === 0) resolve()
      else reject(new Error(`${executable} ${arguments_.join(" ")} exited with ${code ?? "no status"}`))
    })
  })
}

async function createSupervisor() {
  await rm(machineSocket, { force: true })
  let pending = Promise.resolve()

  const server = createServer(socket => {
    let source = ""
    socket.setEncoding("utf8")
    socket.on("error", () => undefined)
    socket.on("data", chunk => {
      source += chunk
      const boundary = source.indexOf("\n")
      if (boundary < 0) return
      socket.pause()

      let request
      try { request = parseRequest(source.slice(0, boundary)) }
      catch (error) {
        send(socket, { error: error instanceof Error ? error.message : String(error) })
        return socket.end()
      }

      const operation = pending.then(async () => {
        try {
          await execute(realCli, request.arguments, {
            cwd: request.cwd,
            output: (stream, data) => {
              process[stream].write(data)
              send(socket, { stream, data })
            }
          })
          send(socket, { exitCode: 0 })
        } catch (error) {
          console.error(error)
          send(socket, { error: error instanceof Error ? error.message : String(error) })
        } finally {
          socket.end()
        }
      })
      pending = operation.catch(() => undefined)
    })
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(machineSocket, resolve)
  })
  await chmod(machineSocket, 0o600)

  return {
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      await pending
      await rm(machineSocket, { force: true })
    }
  }
}

function parseRequest(source) {
  const value = JSON.parse(source)
  if (!value || !Array.isArray(value.arguments) || !value.arguments.every(argument => typeof argument === "string")) {
    throw new Error("A machine command needs string arguments")
  }
  if (typeof value.cwd !== "string" || !value.cwd) throw new Error("A machine command needs a working directory")
  if (value.arguments[0] !== "system" || !machineOperations.has(value.arguments[1])) {
    throw new Error("The machine supervisor accepts only System lifecycle operations")
  }
  return { arguments: value.arguments, cwd: value.cwd }
}

function send(socket, message) {
  if (!socket.destroyed && socket.writable) socket.write(`${JSON.stringify(message)}\n`)
}

const machineOperations = new Set(["install", "uninstall", "start", "stop", "enable", "disable"])

function waitForShutdown() {
  return new Promise(resolve => {
    let settled = false
    // Signal listeners do not keep Node's event loop alive. This timer is the
    // machine lifetime; the System service may stop without powering it off.
    const lifetime = setInterval(() => undefined, 2_147_483_647)

    const finish = () => {
      if (settled) return
      settled = true
      clearInterval(lifetime)
      process.off("SIGINT", finish)
      process.off("SIGTERM", finish)
      resolve()
    }

    process.on("SIGINT", finish)
    process.on("SIGTERM", finish)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMachine().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
