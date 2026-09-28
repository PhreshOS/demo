import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import Images, { imageTag, tar } from "../source/images.mjs"

test("the build context is a tar archive tar itself reads back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phresh-demo-images-"))
  try {
    const archive = join(directory, "context.tar")
    await writeFile(archive, tar([{ name: "Dockerfile.desktop", content: Buffer.from("FROM scratch\n") }, { name: "source/machine.mjs", content: Buffer.from("export {}\n") }]))
    assert.deepEqual(execFileSync("tar", ["-tf", archive], { encoding: "utf8" }).trim().split("\n"), ["Dockerfile.desktop", "source/machine.mjs"])
    assert.equal(execFileSync("tar", ["-xOf", archive, "Dockerfile.desktop"], { encoding: "utf8" }), "FROM scratch\n")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("a new release is built, tried as a desktop, and only then becomes current", async () => {
  const calls = []
  const images = new Map([["phreshos/demo:current", "old"]])
  const docker = {
    async imageId(reference) { return images.get(reference) ?? null },
    async build({ tag, buildArgs }) { calls.push(["build", tag, buildArgs]); images.set(tag, "new") },
    async run(configuration) { calls.push(["run", configuration.Image]); return "trial" },
    async inspect() { return { State: { Running: true, Health: { Status: "healthy" } } } },
    async stop(id) { calls.push(["stop", id]) },
    async tagImage(reference, repository, tag) { calls.push(["tag", reference, `${repository}:${tag}`]); images.set(`${repository}:${tag}`, images.get(reference)) },
    async listImages() { return [{ Id: "old" }, { Id: "new" }] },
    async removeImage(id) { calls.push(["remove", id]) }
  }
  const versions = { "https://registry.npmjs.org/@phreshos/cli/latest": { version: "0.1.80" }, "https://api.github.com/repos/PhreshOS/system/releases/latest": { tag_name: "v0.1.103" }, "https://api.github.com/repos/PhreshOS/sprout-program/releases/latest": { tag_name: "v0.1.3" } }
  const fetch = async url => ({ ok: true, json: async () => versions[url] })
  const manager = new Images({ docker, repository: "phreshos/demo", root: new URL("..", import.meta.url).pathname, fetch, log: { log() {} } })

  const image = `phreshos/demo:${imageTag({ cli: "0.1.80", system: "0.1.103", sprout: "0.1.3" })}`
  assert.deepEqual(await manager.check(), { image, changed: true })
  assert.deepEqual(calls, [
    ["build", image, { CLI_VERSION: "0.1.80", SYSTEM_VERSION: "0.1.103", SPROUT_VERSION: "0.1.3", SOURCE_REVISION: "0.1.103-sprout0.1.3-cli0.1.80" }],
    ["run", image],
    ["stop", "trial"],
    ["tag", image, "phreshos/demo:current"],
    ["remove", "old"]
  ])

  // Nothing new: nothing is built or moved.
  calls.length = 0
  assert.deepEqual(await manager.check(), { image, changed: false })
  assert.deepEqual(calls, [])
})

test("an image that does not come up healthy never becomes current", async () => {
  const tagged = []
  const docker = {
    async imageId(reference) { return reference.endsWith(":current") ? "old" : null },
    async build() {},
    async run() { return "trial" },
    async inspect() { return { State: { Running: false, ExitCode: 1 } } },
    async stop() {},
    async tagImage(...args) { tagged.push(args) },
    async listImages() { return [] },
    async removeImage() {}
  }
  const fetch = async url => ({ ok: true, json: async () => url.includes("npmjs") ? { version: "1" } : { tag_name: "v1" } })
  const manager = new Images({ docker, repository: "phreshos/demo", root: new URL("..", import.meta.url).pathname, fetch, log: { log() {} } })
  await assert.rejects(manager.check(), /stopped with exit code 1/)
  assert.deepEqual(tagged, [])
})
