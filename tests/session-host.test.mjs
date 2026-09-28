import assert from "node:assert/strict"
import test from "node:test"
import { desktopHostname, requestHostname, validDesktopHostname, validHostname } from "../source/session-host.mjs"
import { createToken } from "../source/session-token.mjs"

test("a desktop receives a stable first-level hostname capability", () => {
  const token = createToken()
  const hostname = desktopHostname(token, "phreshos.com")
  assert.match(hostname, /^demo-[a-z0-9]{7}\.phreshos\.com$/)
  assert.equal(desktopHostname(token, "phreshos.com"), hostname)
  assert.notEqual(desktopHostname(token, "phreshos.com", 1), hostname)
  assert.equal(validDesktopHostname(hostname, "phreshos.com"), true)
  assert.equal(validDesktopHostname("unissued.phreshos.com", "phreshos.com"), false)
})

test("request hostnames are normalized without accepting malformed authority", () => {
  assert.equal(requestHostname("DEMO-ABC1234.phreshos.com:443"), "demo-abc1234.phreshos.com")
  assert.equal(requestHostname(" demo.phreshos.com"), null)
  assert.equal(requestHostname("demo.phreshos.com/path"), null)
  assert.equal(validHostname("phreshos.com"), true)
  assert.equal(validHostname("PhreshOS.com"), false)
})
