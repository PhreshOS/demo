import assert from "node:assert/strict"
import { mkdtemp, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { invokedAs, supervised } from "../source/phresh.mjs"

test("the machine owns every System lifecycle mutation", () => {
  for (const operation of ["install", "uninstall", "start", "stop", "enable", "disable"]) {
    assert.equal(supervised(["system", operation]), true)
  }
})

test("ordinary CLI operations remain direct", () => {
  assert.equal(supervised(["system", "status"]), false)
  assert.equal(supervised(["system", "version"]), false)
  assert.equal(supervised(["program", "list"]), false)
})

test("the installed phresh symlink invokes its resolved proxy module", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phreshos-demo-proxy-"))
  const modulePath = fileURLToPath(new URL("../source/phresh.mjs", import.meta.url))
  const executable = join(directory, "phresh")
  await symlink(modulePath, executable)

  assert.equal(invokedAs(executable, modulePath), true)
})
