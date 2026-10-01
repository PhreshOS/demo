import { createHash, randomBytes } from "node:crypto"
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * What visitors do with the demo, one line per event and a file per day, kept for a week.
 * A visitor is their address hashed with a secret kept for that day only: the same visitor
 * reads the same all day, so one person opening many desktops shows, and once the day's
 * secret is deleted no line leads back to an address. No address is ever written.
 */
export default class Activity {
  constructor({ directory, retentionDays = 7, now = Date.now }) {
    this.directory = directory
    this.retentionDays = retentionDays
    this.now = now
    this.day = null
    this.secret = null
    this.writing = Promise.resolve()
  }

  /** Records one event, and who caused it when a request did. Never throws. */
  record(event, fields = {}, request = null) {
    this.writing = this.writing.then(() => this.write(event, fields, request)).catch(error => console.error("Activity could not be recorded:", error))
    return this.writing
  }

  async write(event, fields, request) {
    const day = new Date(this.now()).toISOString().slice(0, 10)
    if (day !== this.day) await this.open(day)
    const line = {
      time: new Date(this.now()).toISOString(),
      event,
      ...fields,
      ...(request ? { visitor: this.visitor(request), agent: String(request.headers["user-agent"] ?? "").slice(0, 200) } : {})
    }
    await appendFile(join(this.directory, `${day}.log`), `${JSON.stringify(line)}\n`, { mode: 0o600 })
  }

  visitor(request) {
    const address = clientAddress(request)
    return createHash("sha256").update(this.secret).update(address).digest("hex").slice(0, 12)
  }

  /** Starts a day: its secret, and the end of every day older than the retention. */
  async open(day) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const secretPath = join(this.directory, `secret-${day}`)
    this.secret = await readFile(secretPath).catch(async () => {
      const secret = randomBytes(32)
      await writeFile(secretPath, secret, { mode: 0o600 })
      return secret
    })
    this.day = day

    const oldest = new Date(Date.parse(day) - (this.retentionDays - 1) * 86_400_000).toISOString().slice(0, 10)
    for (const name of await readdir(this.directory)) {
      const secretDay = /^secret-(\d{4}-\d{2}-\d{2})$/.exec(name)?.[1]
      const logDay = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(name)?.[1]
      // A past day's secret goes at once: its lines stay readable, never traceable.
      if ((secretDay && secretDay !== day) || (logDay && logDay < oldest)) await rm(join(this.directory, name), { force: true })
    }
  }
}

/** The visitor's address as Cloudflare saw it, or the nearest one known. */
function clientAddress(request) {
  const forwarded = request.headers["cf-connecting-ip"] ?? String(request.headers["x-forwarded-for"] ?? "").split(",")[0]
  return String(forwarded || request.socket?.remoteAddress || "unknown").trim()
}
