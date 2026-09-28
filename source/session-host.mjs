import { createHash } from "node:crypto"
import { validToken } from "./session-token.mjs"

const identifierLength = 7
const identifierSpace = 36n ** BigInt(identifierLength)

export function desktopHostname(token, domain, attempt = 0) {
  if (!validToken(token)) throw new Error("A desktop hostname needs a valid session token")
  if (!validHostname(domain)) throw new Error("A desktop hostname needs a valid domain")
  if (!Number.isSafeInteger(attempt) || attempt < 0) throw new Error("A desktop hostname needs a valid attempt")
  return `demo-${identifier(token, attempt)}.${domain.toLowerCase()}`
}

export function validDesktopHostname(hostname, domain) {
  if (typeof hostname !== "string" || !validHostname(domain)) return false
  const suffix = `.${domain}`
  return hostname.endsWith(suffix) && /^demo-[a-z0-9]{7}$/.test(hostname.slice(0, -suffix.length))
}

function identifier(token, attempt) {
  const digest = createHash("sha256").update(token).update(":").update(String(attempt)).digest()
  // DNS folds letter case, so seven base-36 symbols are the full alphanumeric space.
  return (digest.readBigUInt64BE() % identifierSpace).toString(36).padStart(identifierLength, "0")
}

export function requestHostname(header) {
  if (typeof header !== "string" || !header || header !== header.trim()) return null
  try {
    const url = new URL(`http://${header}`)
    if (url.username || url.password || url.pathname !== "/") return null
    return url.hostname.toLowerCase().replace(/\.$/, "")
  } catch {
    return null
  }
}

export function validHostname(value) {
  if (typeof value !== "string" || value.length > 253 || value !== value.toLowerCase()) return false
  return value.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
}
