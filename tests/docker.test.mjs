import assert from "node:assert/strict"
import test from "node:test"
import { desktopConfiguration } from "../source/docker.mjs"

test("a desktop owns a writable disposable OS inside the rootless engine", () => {
  const configuration = desktopConfiguration({ token: "token", image: "image", network: "network" })
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
})
