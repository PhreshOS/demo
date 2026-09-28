import { randomBytes } from "node:crypto"

export const cookieName = "phresh_demo"

export function createToken() {
  return randomBytes(32).toString("base64url")
}

export function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
}

export function readCookies(header = "") {
  return Object.fromEntries(header.split(";").flatMap(part => {
    const separator = part.indexOf("=")
    if (separator < 1) return []
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    return name ? [[name, value]] : []
  }))
}

export function sessionToken(cookieHeader) {
  const cookie = readCookies(cookieHeader)[cookieName]
  return cookie === undefined
    ? { token: null, source: "none", valid: true }
    : { token: cookie, source: "cookie", valid: validToken(cookie) }
}

export function sessionCookie(token) {
  if (!validToken(token)) throw new Error("A demo cookie needs a valid session token")
  return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`
}

export function withoutSessionCookie(header = "") {
  return header.split(";")
    .map(value => value.trim())
    .filter(value => value && value.split("=", 1)[0] !== cookieName)
    .join("; ")
}
