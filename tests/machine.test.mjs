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

test("the machine writes the lifetime it was given where Programs read it, read-only", async () => {
  const { mkdtemp, readFile, stat, rm: remove } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { announceLifetime } = await import("../source/machine.mjs")
  const directory = await mkdtemp(join(tmpdir(), "phresh-demo-machine-"))
  const file = join(directory, "phreshos", "demo.json")
  try {
    await announceLifetime({ PHRESHOS_DEMO_STARTED_AT: "2026-09-28T08:00:00.000Z", PHRESHOS_DEMO_EXPIRES_AT: "2026-09-28T09:00:00.000Z" }, file)
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { startedAt: "2026-09-28T08:00:00.000Z", expiresAt: "2026-09-28T09:00:00.000Z" })
    assert.equal((await stat(file)).mode & 0o777, 0o444)
    // Written again at the next boot, even though it is read-only.
    await announceLifetime({ PHRESHOS_DEMO_STARTED_AT: "2026-09-28T08:00:00.000Z", PHRESHOS_DEMO_EXPIRES_AT: "2026-09-28T10:00:00.000Z" }, file)
    assert.equal(JSON.parse(await readFile(file, "utf8")).expiresAt, "2026-09-28T10:00:00.000Z")
    // Without a lifetime, there is no file: an ordinary machine.
    const plain = join(directory, "plain.json")
    await announceLifetime({}, plain)
    await assert.rejects(stat(plain))
  } finally {
    await remove(directory, { recursive: true, force: true })
  }
})

test("the machine shows its clock with the lifetime it was given, and never fails over it", async () => {
  const { showClock } = await import("../source/machine.mjs")
  const calls = []
  const lifetime = { PHRESHOS_DEMO_STARTED_AT: "2026-09-28T08:00:00.000Z", PHRESHOS_DEMO_EXPIRES_AT: "2026-09-28T09:00:00.000Z" }
  await showClock(async arguments_ => calls.push(arguments_), lifetime)
  assert.deepEqual(calls, [["process", "create", "--program", "sprout", "--name", "clock", "--replace", "--client-layer", "under",
    "--option", "view=clock", "--option", "startedAt=2026-09-28T08:00:00.000Z", "--option", "expiresAt=2026-09-28T09:00:00.000Z"]])
  // An ordinary machine has no clock.
  await showClock(async arguments_ => calls.push(arguments_), {})
  assert.equal(calls.length, 1)
  // A clock that cannot start leaves the machine running.
  const error = console.error
  console.error = () => {}
  try { await showClock(async () => { throw new Error("no") }, lifetime) }
  finally { console.error = error }
})

test("a machine with a lifetime shows its clock once its System has started", async () => {
  const calls = []
  const saved = { started: process.env.PHRESHOS_DEMO_STARTED_AT, expires: process.env.PHRESHOS_DEMO_EXPIRES_AT }
  process.env.PHRESHOS_DEMO_STARTED_AT = "2026-09-28T08:00:00.000Z"
  process.env.PHRESHOS_DEMO_EXPIRES_AT = "2026-09-28T09:00:00.000Z"
  try {
    await runMachine({
      provision: async () => undefined,
      announce: async () => undefined,
      command: async arguments_ => calls.push(arguments_.slice(0, 2).join(" ")),
      supervise: async () => ({ close: async () => undefined }),
      shutdown: async () => calls.push("shutdown")
    })
  } finally {
    for (const [name, value] of [["PHRESHOS_DEMO_STARTED_AT", saved.started], ["PHRESHOS_DEMO_EXPIRES_AT", saved.expires]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  assert.deepEqual(calls, ["system start", "process create", "shutdown", "system stop"])
})
