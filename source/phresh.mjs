#!/usr/bin/env node

import { spawn } from "node:child_process"
import { realpathSync } from "node:fs"
import { createConnection } from "node:net"
import { fileURLToPath } from "node:url"
import { machineSocket } from "./machine.mjs"

const realCli = "/usr/local/bin/phresh"

export function main(arguments_ = process.argv.slice(2)) {
  if (!supervised(arguments_)) {
    const child = spawn(realCli, arguments_, { stdio: "inherit" })
    child.once("error", fail)
    child.once("close", code => { process.exitCode = code ?? 1 })
  } else {
    forward(arguments_).catch(fail)
  }
}

export function supervised(arguments_) {
  return arguments_[0] === "system" && operations.has(arguments_[1])
}

export function invokedAs(entry, modulePath = fileURLToPath(import.meta.url)) {
  // Node resolves this module's URL through the executable symlink while
  // argv keeps the symlink path. Compare their real paths or the CLI is inert.
  return typeof entry === "string" && realpathSync(entry) === realpathSync(modulePath)
}

function forward(arguments_) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(machineSocket)
    let source = ""
    let completed = false

    socket.setEncoding("utf8")
    socket.once("connect", () => socket.write(`${JSON.stringify({ arguments: arguments_, cwd: process.cwd() })}\n`))
    socket.on("data", chunk => {
      source += chunk
      while (true) {
        const boundary = source.indexOf("\n")
        if (boundary < 0) break
        const line = source.slice(0, boundary)
        source = source.slice(boundary + 1)
        const message = JSON.parse(line)
        if (message.stream === "stdout") process.stdout.write(message.data)
        else if (message.stream === "stderr") process.stderr.write(message.data)
        else if (typeof message.exitCode === "number") {
          completed = true
          process.exitCode = message.exitCode
        } else if (typeof message.error === "string") return reject(new Error(message.error))
      }
    })
    socket.once("error", reject)
    socket.once("close", () => completed ? resolve() : reject(new Error("The machine supervisor ended before the System operation completed")))
  })
}

function fail(error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

const operations = new Set(["install", "uninstall", "start", "stop", "enable", "disable"])

if (invokedAs(process.argv[1])) main()
