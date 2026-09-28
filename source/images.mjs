import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { desktopConfiguration } from "./docker.mjs"

/** The files the desktop image is built from, relative to this repository. */
const contextFiles = ["Dockerfile.desktop", "source/machine.mjs", "source/phresh.mjs"]

/**
 * Keeps the demo image on the latest published PhreshOS. It checks the latest CLI, System, and
 * Sprout releases; when any has changed, it builds an image from them, tries it as a real desktop,
 * and only then moves the `current` tag to it. New desktops start from `current`, so a release
 * reaches visitors without any change here, and a broken release never does. Desktops already
 * running keep the image they started from.
 */
export default class Images {
  constructor({ docker, repository, root, fetch = globalThis.fetch, log = console }) {
    this.docker = docker
    this.repository = repository
    this.root = root
    this.fetch = fetch
    this.log = log
    this.running = null
  }

  /** Checks once, building when needed; a check already under way is shared. */
  refresh() {
    this.running ??= this.check().finally(() => { this.running = null })
    return this.running
  }

  async check() {
    const versions = await this.latest()
    const tag = imageTag(versions)
    const image = `${this.repository}:${tag}`
    const current = await this.docker.imageId(`${this.repository}:current`)
    const built = await this.docker.imageId(image)
    if (built && built === current) return { image, changed: false }

    if (!built) {
      this.log.log(`Building ${image}`)
      await this.docker.build({
        tag: image,
        dockerfile: "Dockerfile.desktop",
        context: await this.context(),
        buildArgs: { CLI_VERSION: versions.cli, SYSTEM_VERSION: versions.system, SPROUT_VERSION: versions.sprout, SOURCE_REVISION: tag }
      })
    }

    await this.tryDesktop(image)
    await this.docker.tagImage(image, this.repository, "current")
    this.log.log(`${image} is now current`)
    await this.prune(image)
    return { image, changed: true }
  }

  /** The latest published CLI, System, and Sprout versions. */
  async latest() {
    const [cli, system, sprout] = await Promise.all([
      this.json("https://registry.npmjs.org/@phreshos/cli/latest").then(release => release.version),
      this.json("https://api.github.com/repos/PhreshOS/system/releases/latest").then(release => release.tag_name.replace(/^v/, "")),
      this.json("https://api.github.com/repos/PhreshOS/sprout-program/releases/latest").then(release => release.tag_name.replace(/^v/, ""))
    ])
    return { cli, system, sprout }
  }

  async json(url) {
    const response = await this.fetch(url, { headers: { accept: "application/json", "user-agent": "phreshos-demo" } })
    if (!response.ok) throw new Error(`${url} answered ${response.status}`)
    return await response.json()
  }

  /** Runs the image as a desktop would be run, and waits for its System to answer. */
  async tryDesktop(image) {
    const now = Date.now()
    const id = await this.docker.run(desktopConfiguration({ token: "image-check", image, network: "bridge", startedAt: now, expiresAt: now + 120_000 }))
    try {
      const deadline = Date.now() + 90_000
      while (Date.now() < deadline) {
        const container = await this.docker.inspect(id)
        if (!container.State.Running) throw new Error(`${image} stopped with exit code ${container.State.ExitCode}`)
        if (container.State.Health?.Status === "healthy") return
        if (container.State.Health?.Status === "unhealthy") throw new Error(`${image} became unhealthy`)
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      throw new Error(`${image} did not become healthy within 90 seconds`)
    } finally {
      await this.docker.stop(id).catch(() => undefined)
    }
  }

  /** Removes older demo images; an image a running desktop still uses stays until it is free. */
  async prune(keep) {
    const keepId = await this.docker.imageId(keep)
    for (const image of await this.docker.listImages(this.repository)) {
      if (image.Id === keepId) continue
      await this.docker.removeImage(image.Id).catch(() => undefined)
    }
  }

  async context() {
    return tar(await Promise.all(contextFiles.map(async name => ({ name, content: await readFile(resolve(this.root, name)) }))))
  }
}

/** One tag names everything an image was built from. */
export function imageTag({ cli, system, sprout }) {
  return `${system}-sprout${sprout}-cli${cli}`
}

/** A plain tar archive of a few small files, as Docker takes a build context. */
export function tar(files) {
  const blocks = []
  for (const { name, content } of files) {
    const header = Buffer.alloc(512)
    header.write(name, 0, 100, "utf8")
    header.write("0000644\0", 100, 8, "ascii")
    header.write("0000000\0", 108, 8, "ascii")
    header.write("0000000\0", 116, 8, "ascii")
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii")
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136, 12, "ascii")
    header.write("        ", 148, 8, "ascii")
    header.write("0", 156, 1, "ascii")
    header.write("ustar\0", 257, 6, "ascii")
    header.write("00", 263, 2, "ascii")
    let sum = 0
    for (const byte of header) sum += byte
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii")
    blocks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return Buffer.concat(blocks)
}
