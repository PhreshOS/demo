import assert from "node:assert/strict"
import test from "node:test"
import createHandler from "../source/handler.mjs"
import { createToken, sessionCookie } from "../source/session-token.mjs"

const page = { html: "<!doctype html>", script: "", scriptPath: "/__manager/demo.js" }

test("the entry hostname serves preparation independently of how DNS matched it", async () => {
  const sessions = { get: () => null }
  const response = captureResponse()
  await createHandler({ config: { entryHost: "demo.phreshos.com" }, sessions, page })(
    { url: "/", method: "GET", headers: { host: "demo.phreshos.com" } }, response
  )

  assert.equal(response.status, 200)
  assert.equal(response.written, page.html)
  assert.match(response.headers["set-cookie"], /^phresh_demo=/)
})

test("a start request reports each status as it changes, ending with the desktop", async () => {
  const token = createToken()
  const record = { token, hostname: "demo-abc1234.phreshos.com", status: "container", pending: Promise.resolve() }
  const sessions = fakeSessions(record)
  const response = captureResponse()
  const completion = createHandler({ config: { entryHost: "demo.phreshos.com" }, sessions, page })(start(token), response)

  await Promise.resolve()
  sessions.change("system")
  sessions.change("ready")
  await completion

  assert.equal(response.status, 200)
  assert.deepEqual(response.lines(), [
    { status: "container" },
    { status: "system" },
    { status: "ready", desktop: "https://demo-abc1234.phreshos.com/" }
  ])
  assert.equal(response.ends, 1)
  assert.equal(sessions.watching(), 0)
})

test("a failure reaches the page without its cause", async () => {
  const token = createToken()
  const record = { token, hostname: "demo-abc1234.phreshos.com", status: "container", pending: Promise.resolve() }
  const sessions = fakeSessions(record)
  const response = captureResponse()
  const completion = createHandler({ config: { entryHost: "demo.phreshos.com" }, sessions, page })(start(token), response)

  sessions.change("failed")
  await completion

  assert.deepEqual(response.lines(), [{ status: "container" }, { status: "failed" }])
})

test("trying again replaces a desktop that failed to start", async () => {
  const token = createToken()
  const failed = { token, hostname: "demo-abc1234.phreshos.com", status: "failed", pending: null }
  const fresh = { token, hostname: "demo-abc1234.phreshos.com", status: "ready", pending: null }
  const removed = []
  const sessions = {
    get: () => failed,
    async remove(record) { removed.push(record) },
    create: () => fresh,
    watch: () => () => undefined
  }
  const response = captureResponse()
  await createHandler({ config: { entryHost: "demo.phreshos.com" }, sessions, page })(start(token), response)

  assert.deepEqual(removed, [failed])
  assert.deepEqual(response.lines(), [{ status: "ready", desktop: "https://demo-abc1234.phreshos.com/" }])
})

test("a full manager answers that it is full, and how long until a desktop frees", async () => {
  const token = createToken()
  const sessions = { get: () => null, create: () => null, freesIn: () => 754_000 }
  const response = captureResponse()
  await createHandler({ config: { entryHost: "demo.phreshos.com" }, sessions, page })(start(token), response)

  assert.equal(response.status, 503)
  assert.deepEqual(response.lines(), [{ status: "full", freesIn: 754_000 }])
})

function start(token) {
  return { url: "/__manager/start", method: "POST", headers: { host: "demo.phreshos.com", cookie: sessionCookie(token) } }
}

function fakeSessions(record) {
  const listeners = new Set()
  return {
    get: candidate => candidate === record.token ? record : null,
    create() { throw new Error("The existing desktop must be reused") },
    watch(_, listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    change(status) {
      record.status = status
      for (const listener of [...listeners]) listener(record)
    },
    watching: () => listeners.size
  }
}

function captureResponse() {
  return {
    status: null,
    headers: null,
    ends: 0,
    destroyed: false,
    written: "",
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    write(chunk) {
      this.written += chunk
    },
    end(chunk = "") {
      this.written += chunk
      this.ends += 1
    },
    lines() {
      return this.written.split("\n").filter(Boolean).map(line => JSON.parse(line))
    }
  }
}

test("opening a desktop that has ended goes back to the entry, told why", async () => {
  const sessions = { getByHostname: () => null }
  const response = captureResponse()
  await createHandler({ config: { entryHost: "demo.phreshos.com" }, sessions, page })(
    { url: "/", method: "GET", headers: { host: "demo-abc1234.phreshos.com" } }, response
  )

  assert.equal(response.status, 302)
  assert.equal(response.headers.location, "https://demo.phreshos.com/?ended")
})
