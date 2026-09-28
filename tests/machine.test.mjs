import assert from "node:assert/strict"
import test from "node:test"
import { runMachine } from "../source/machine.mjs"

test("the machine boots and shuts down the installed System through its CLI", async () => {
  const calls = []

  await runMachine({
    provision: async () => calls.push(["machine", "provision"]),
    command: async arguments_ => calls.push(arguments_),
    supervise: async () => ({ close: async () => calls.push(["machine", "supervisor-close"]) }),
    shutdown: async () => calls.push(["machine", "shutdown"])
  })

  assert.deepEqual(calls, [
    ["machine", "provision"],
    ["system", "start"],
    ["machine", "shutdown"],
    ["machine", "supervisor-close"],
    ["system", "stop"]
  ])
})

test("a failed boot does not pretend that a System service was started", async () => {
  let waited = false

  await assert.rejects(
    runMachine({
      provision: async () => undefined,
      supervise: async () => ({ close: async () => undefined }),
      command: async arguments_ => {
        if (arguments_[1] === "start") throw new Error("start failed")
      },
      shutdown: async () => { waited = true }
    }),
    /start failed/
  )

  assert.equal(waited, false)
})
