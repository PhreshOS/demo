import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { desktopHostname, validDesktopHostname } from "./session-host.mjs"
import { createToken, validToken } from "./session-token.mjs"

export default class Sessions {
  constructor({ docker, image, network, domain, statePath, lifetimeMilliseconds, maxSessions, now = Date.now, onRemove = () => {} }) {
    this.docker = docker
    this.onRemove = onRemove
    this.image = image
    this.network = network
    this.domain = domain
    this.statePath = statePath
    this.lifetimeMilliseconds = lifetimeMilliseconds
    this.maxSessions = maxSessions
    this.now = now
    this.records = new Map()
    this.hostnames = new Map()
    this.watchers = new Map()
    this.saving = Promise.resolve()
  }

  async initialize() {
    await this.docker.ensureNetwork(this.network)
    const persisted = await this.readState()
    const containers = await this.docker.listDesktops()
    const live = new Map(containers
      .filter(container => container.State === "running")
      .flatMap(container => {
        const token = container.Labels?.["phreshos.demo.session"]
        return validToken(token) ? [[token, container]] : []
      }))

    for (const [token, container] of live) {
      const previous = persisted[token]
      // Recovery must not reauthorize a hostname outside the current session URL contract.
      this.add({
        token,
        hostname: validDesktopHostname(previous?.hostname, this.domain)
          ? previous.hostname
          : desktopHostname(token, this.domain),
        containerId: container.Id,
        containerName: container.Names?.[0]?.replace(/^\//, "") ?? this.name(token),
        status: "ready",
        createdAt: previous?.createdAt ?? this.now(),
        expiresAt: previous?.expiresAt ?? (previous?.createdAt ?? this.now()) + this.lifetimeMilliseconds,
        pending: null
      })
    }

    await this.persist()
  }

  get(token) {
    return this.records.get(token) ?? null
  }

  getByHostname(hostname) {
    return this.hostnames.get(hostname) ?? null
  }

  create(token = createToken()) {
    if (!validToken(token)) throw new Error("A desktop needs a valid session token")
    if (this.records.has(token)) throw new Error("The desktop session already exists")
    if (this.records.size >= this.maxSessions) return null
    let attempt = 0
    let hostname
    do {
      hostname = desktopHostname(token, this.domain, attempt++)
    } while (this.hostnames.has(hostname))
    const createdAt = this.now()
    const record = {
      token,
      hostname,
      containerId: null,
      containerName: this.name(token),
      status: "container",
      createdAt,
      // A desktop lives a fixed time from its creation, whether or not anyone is connected.
      expiresAt: createdAt + this.lifetimeMilliseconds,
      pending: null
    }
    this.add(record)
    record.pending = this.start(record)
    void this.persist()
    return record
  }

  /** Calls `listener` with the record whenever its status changes, until the returned function is called. */
  watch(record, listener) {
    const listeners = this.watchers.get(record) ?? new Set()
    this.watchers.set(record, listeners.add(listener))
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.watchers.delete(record)
    }
  }

  setStatus(record, status) {
    record.status = status
    for (const listener of this.watchers.get(record) ?? []) listener(record)
  }

  /** How long until the soonest desktop ends and a new one can start, in milliseconds; null while none runs. */
  freesIn() {
    let soonest = null
    for (const record of this.records.values()) if (soonest === null || record.expiresAt < soonest) soonest = record.expiresAt
    return soonest === null ? null : Math.max(0, soonest - this.now())
  }

  /** Removes every desktop whose lifetime has ended. */
  async expire() {
    const now = this.now()
    const expired = [...this.records.values()].filter(record => record.expiresAt <= now)
    for (const record of expired) await this.remove(record)
    return expired.length
  }

  async remove(record) {
    if (this.records.get(record.token) !== record) return
    this.records.delete(record.token)
    this.hostnames.delete(record.hostname)
    this.watchers.delete(record)
    this.onRemove(record)
    if (record.containerId) await this.docker.stop(record.containerId).catch(() => undefined)
    await this.persist()
  }

  async persist() {
    const values = Object.fromEntries([...this.records].map(([token, record]) => [token, {
      hostname: record.hostname,
      containerId: record.containerId,
      containerName: record.containerName,
      status: record.status,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt
    }]))
    this.saving = this.saving.then(async () => {
      await mkdir(dirname(this.statePath), { recursive: true })
      const temporary = `${this.statePath}.tmp`
      await writeFile(temporary, `${JSON.stringify(values)}\n`, { mode: 0o600 })
      await rename(temporary, this.statePath)
    })
    return await this.saving
  }

  async start(record) {
    try {
      record.containerId = await this.docker.createDesktop({
        token: record.token,
        name: record.containerName,
        image: this.image,
        network: this.network,
        startedAt: record.createdAt,
        expiresAt: record.expiresAt
      })
      this.setStatus(record, "system")
      await this.persist()
      const deadline = this.now() + 30_000
      while (this.now() < deadline) {
        const container = await this.docker.inspect(record.containerId)
        if (!container.State.Running) throw new Error(`Desktop container stopped with exit code ${container.State.ExitCode}`)
        if (container.State.Health?.Status === "healthy") {
          record.pending = null
          this.setStatus(record, "ready")
          await this.persist()
          return
        }
        if (container.State.Health?.Status === "unhealthy") throw new Error("Desktop container became unhealthy")
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error("Desktop container did not become healthy within 30 seconds")
    } catch (error) {
      console.error(`Desktop ${record.containerName} could not start:`, error)
      record.pending = null
      this.setStatus(record, "failed")
      await this.persist()
    }
  }

  async readState() {
    try { return JSON.parse(await readFile(this.statePath, "utf8")) }
    catch (error) {
      if (error.code === "ENOENT") return {}
      throw error
    }
  }

  name(token) {
    return `phresh-desktop-${token.slice(0, 16)}`
  }

  add(record) {
    if (this.records.has(record.token) || this.hostnames.has(record.hostname)) throw new Error("The desktop session already exists")
    this.records.set(record.token, record)
    this.hostnames.set(record.hostname, record)
    return record
  }
}
