import assert from "node:assert/strict"
import test from "node:test"
import { desktopConfiguration } from "../source/docker.mjs"

test("a desktop owns a writable disposable OS inside the rootless engine", () => {
  const configuration = desktopConfiguration({ token: "token", image: "image", network: "network", startedAt: 0, expiresAt: 3_600_000 })
  assert.equal(configuration.User, "0:0")
  assert.equal(configuration.HostConfig.Privileged, false)
  assert.equal(configuration.HostConfig.ReadonlyRootfs, false)
  assert.equal(configuration.HostConfig.NetworkMode, "network")
  assert.deepEqual(configuration.HostConfig.SecurityOpt, ["no-new-privileges"])
  assert.equal(configuration.HostConfig.Binds, undefined)
  assert.equal(configuration.HostConfig.Memory, 1_610_612_736)
  assert.equal(configuration.HostConfig.MemorySwap, 1_610_612_736)
  assert.equal(configuration.HostConfig.NanoCpus, 1_000_000_000)
  assert.equal(configuration.HostConfig.PidsLimit, 256)
  assert.equal(configuration.HostConfig.Tmpfs, undefined)
  // The machine is told its own lifetime.
  assert.deepEqual(configuration.Env, ["PHRESHOS_DEMO_STARTED_AT=1970-01-01T00:00:00.000Z", "PHRESHOS_DEMO_EXPIRES_AT=1970-01-01T01:00:00.000Z"])
})
