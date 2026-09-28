import assert from "node:assert/strict"
import test from "node:test"
import { cookieName, createToken, readCookies, sessionCookie, sessionToken, validToken, withoutSessionCookie } from "../source/session-token.mjs"

test("a session token is an opaque 256-bit URL-safe capability", () => {
  const token = createToken()
  assert.equal(token.length, 43)
  assert.equal(validToken(token), true)
  assert.equal(validToken("short"), false)
})

test("the browser session token comes only from its host-scoped cookie", () => {
  const cookie = createToken()
  assert.deepEqual(sessionToken(`${cookieName}=${cookie}`), { token: cookie, source: "cookie", valid: true })
  assert.deepEqual(sessionToken(), { token: null, source: "none", valid: true })
})

test("session cookies are browser-session scoped and removed before proxying", () => {
  const token = createToken()
  assert.equal(sessionCookie(token), `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`)
  assert.deepEqual(readCookies(`theme=dark; ${cookieName}=${token}`), { theme: "dark", [cookieName]: token })
  assert.equal(withoutSessionCookie(`theme=dark; ${cookieName}=${token}; auth=value`), "theme=dark; auth=value")
})
