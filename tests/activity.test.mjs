import assert from "node:assert/strict"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import Activity from "../source/activity.mjs"

const visit = (address, agent = "Mozilla/5.0") => ({ headers: { "cf-connecting-ip": address, "user-agent": agent } })
const lines = async (directory, day) => (await readFile(join(directory, `${day}.log`), "utf8")).trim().split("\n").map(line => JSON.parse(line))

test("one visitor reads the same all day, another differently, and no address is written", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phresh-demo-activity-"))
  try {
    const activity = new Activity({ directory, now: () => Date.parse("2026-10-01T10:00:00Z") })
    await activity.record("start", { desktop: "demo-abc1234" }, visit("203.0.113.7"))
    await activity.record("start", { desktop: "demo-def5678" }, visit("203.0.113.7"))
    await activity.record("page", { desktop: null }, visit("198.51.100.4", "curl/8.0"))
    await activity.record("end", { desktop: "demo-abc1234", lived: 3600 })

    const [first, second, other, end] = await lines(directory, "2026-10-01")
    assert.equal(first.visitor, second.visitor)
    assert.notEqual(first.visitor, other.visitor)
    assert.equal(other.agent, "curl/8.0")
    assert.deepEqual(Object.keys(end).sort(), ["desktop", "event", "lived", "time"])
    const written = await readFile(join(directory, "2026-10-01.log"), "utf8")
    assert(!written.includes("203.0.113.7") && !written.includes("198.51.100.4"))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("a new day forgets the last day's secret, and a week's end forgets its lines", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phresh-demo-activity-"))
  let now = Date.parse("2026-10-01T23:59:00Z")
  try {
    const activity = new Activity({ directory, retentionDays: 7, now: () => now })
    await activity.record("start", {}, visit("203.0.113.7"))
    now = Date.parse("2026-10-02T00:01:00Z")
    await activity.record("start", {}, visit("203.0.113.7"))

    const [yesterday] = await lines(directory, "2026-10-01")
    const [today] = await lines(directory, "2026-10-02")
    assert.notEqual(yesterday.visitor, today.visitor)
    assert.deepEqual((await readdir(directory)).sort(), ["2026-10-01.log", "2026-10-02.log", "secret-2026-10-02"])

    now = Date.parse("2026-10-08T12:00:00Z")
    await activity.record("page", {}, visit("203.0.113.7"))
    assert.deepEqual((await readdir(directory)).sort(), ["2026-10-02.log", "2026-10-08.log", "secret-2026-10-08"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
