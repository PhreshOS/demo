import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import Sessions from "../source/sessions.mjs"
import { desktopHostname } from "../source/session-host.mjs"
import { createToken } from "../source/session-token.mjs"

test("a desktop ends a fixed time after its creation, connected or not", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phresh-demo-sessions-"))
  let now = 1_000
  const stopped = []
  const docker = {
    async ensureNetwork() {},
    async listDesktops() { return [] },
    async createDesktop() { return "container" },
    async inspect() { return { State: { Running: true, Health: { Status: "healthy" } } } },
    async stop(id) { stopped.push(id) }
  }
  try {
    const sessions = new Sessions({ docker, image: "image", network: "network", domain: "phreshos.com", statePath: join(directory, "state.json"), lifetimeMilliseconds: 3_600_000, maxSessions: 1, now: () => now })
    await sessions.initialize()
    const token = createToken()
    const record = sessions.create(token)
    assert(record)
    assert.equal(record.token, token)
    assert.equal(sessions.getByHostname(record.hostname), record)
    await record.pending
    assert.equal(record.status, "ready")
    assert.equal(sessions.create(), null)

    assert.equal(record.expiresAt, 1_000 + 3_600_000)
    now += 3_599_999
    assert.equal(await sessions.expire(), 0)
    now += 1
    assert.equal(await sessions.expire(), 1)
    assert.equal(sessions.getByHostname(record.hostname), null)
    assert.deepEqual(stopped, ["container"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("a starting desktop reports its container, then its System, then ready", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phresh-demo-sessions-"))
  const docker = {
    async ensureNetwork() {},
    async listDesktops() { return [] },
    async createDesktop() { return "container" },
    async inspect() { return { State: { Running: true, Health: { Status: "healthy" } } } },
    async stop() {}
  }
  try {
    const sessions = new Sessions({ docker, image: "image", network: "network", domain: "phreshos.com", statePath: join(directory, "state.json"), lifetimeMilliseconds: 3_600_000, maxSessions: 1 })
    await sessions.initialize()
    const record = sessions.create(createToken())
    const seen = [record.status]
    const unwatch = sessions.watch(record, changed => seen.push(changed.status))
    await record.pending
    unwatch()
    assert.deepEqual(seen, ["container", "system", "ready"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("a restored desktop keeps its issued hostname", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phresh-demo-sessions-"))
  const statePath = join(directory, "state.json")
  const token = createToken()
  const issued = desktopHostname(token, "phreshos.com", 1)
  await writeFile(statePath, JSON.stringify({ [token]: { hostname: issued, createdAt: 1_000 } }))
  const docker = {
    async ensureNetwork() {},
    async listDesktops() { return [{ Id: "container", State: "running", Labels: { "phreshos.demo.session": token }, Names: ["/desktop"] }] }
  }
  try {
    const sessions = new Sessions({ docker, image: "image", network: "network", domain: "phreshos.com", statePath, lifetimeMilliseconds: 3_600_000, maxSessions: 5 })
    await sessions.initialize()
    assert.equal(sessions.getByHostname(issued)?.token, token)
    assert.equal(JSON.parse(await readFile(statePath, "utf8"))[token].hostname, issued)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("an invalid saved hostname cannot become a desktop route", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phresh-demo-sessions-"))
  const statePath = join(directory, "state.json")
  const token = createToken()
  await writeFile(statePath, JSON.stringify({ [token]: { hostname: "unissued.phreshos.com" } }))
  const docker = {
    async ensureNetwork() {},
    async listDesktops() { return [{ Id: "container", State: "running", Labels: { "phreshos.demo.session": token }, Names: ["/desktop"] }] }
  }
  try {
    const sessions = new Sessions({ docker, image: "image", network: "network", domain: "phreshos.com", statePath, lifetimeMilliseconds: 3_600_000, maxSessions: 5 })
    await sessions.initialize()
    assert.equal(sessions.getByHostname("unissued.phreshos.com"), null)
    assert.equal(sessions.get(token)?.hostname, desktopHostname(token, "phreshos.com"))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("a short hostname collision chooses another identifier", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phresh-demo-sessions-"))
  const docker = {
    async ensureNetwork() {},
    async listDesktops() { return [] },
    async createDesktop() { return "container" },
    async inspect() { return { State: { Running: true, Health: { Status: "healthy" } } } }
  }
  try {
    const sessions = new Sessions({ docker, image: "image", network: "network", domain: "phreshos.com", statePath: join(directory, "state.json"), lifetimeMilliseconds: 3_600_000, maxSessions: 5 })
    await sessions.initialize()
    const token = createToken()
    const occupied = desktopHostname(token, "phreshos.com")
    sessions.hostnames.set(occupied, { token: createToken() })
    const record = sessions.create(token)
    assert.equal(record.hostname, desktopHostname(token, "phreshos.com", 1))
    await record.pending
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
