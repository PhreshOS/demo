import { resolve } from "node:path"
import { validHostname } from "./session-host.mjs"

export function configuration(environment = process.env) {
  return Object.freeze({
    host: value(environment.DEMO_LISTEN_HOST, "0.0.0.0"),
    port: integer(environment.DEMO_LISTEN_PORT, 8080, "DEMO_LISTEN_PORT", 1, 65_535),
    entryHost: hostname(environment.DEMO_ENTRY_HOST, "demo.phreshos.com", "DEMO_ENTRY_HOST"),
    sessionDomain: hostname(environment.DEMO_SESSION_DOMAIN, "phreshos.com", "DEMO_SESSION_DOMAIN"),
    socket: resolve(value(environment.DEMO_DOCKER_SOCKET, "/var/run/docker.sock")),
    network: value(environment.DEMO_DOCKER_NETWORK, "phresh-demo"),
    // New desktops start from this repository's `current` image, which the manager keeps on the latest release.
    repository: value(environment.DEMO_IMAGE_REPOSITORY, "phreshos/demo"),
    imageCheckMilliseconds: integer(environment.DEMO_IMAGE_CHECK_MILLISECONDS, 1_800_000, "DEMO_IMAGE_CHECK_MILLISECONDS", 60_000),
    state: resolve(value(environment.DEMO_STATE, "/data/sessions.json")),
    // What visitors do, a file per day; see Activity.
    activity: resolve(value(environment.DEMO_ACTIVITY, "/data/activity")),
    lifetimeMilliseconds: integer(environment.DEMO_LIFETIME_MILLISECONDS, 3_600_000, "DEMO_LIFETIME_MILLISECONDS", 60_000),
    // A desktop no browser is connected to ends after this long, so a visitor who left frees it.
    idleMilliseconds: integer(environment.DEMO_IDLE_MILLISECONDS, 600_000, "DEMO_IDLE_MILLISECONDS", 60_000),
    maxSessions: integer(environment.DEMO_MAX_SESSIONS, 7, "DEMO_MAX_SESSIONS", 1)
  })
}

function hostname(input, fallback, name) {
  const parsed = value(input, fallback).toLowerCase()
  if (!validHostname(parsed)) throw new Error(`${name} must be a hostname`)
  return parsed
}

function value(input, fallback) {
  if (input === undefined) return fallback
  if (!input || input !== input.trim()) throw new Error("Demo configuration values cannot be empty or padded")
  return input
}

function integer(input, fallback, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (input === undefined) return fallback
  if (!/^\d+$/.test(input)) throw new Error(`${name} must be an integer`)
  const parsed = Number(input)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} is outside its supported range`)
  return parsed
}
