import http from "node:http"

const api = "/v1.40"

export default class Docker {
  constructor(socketPath) {
    this.socketPath = socketPath
  }

  async ensureNetwork(name) {
    const found = await this.request("GET", `/networks/${encodeURIComponent(name)}`, undefined, [200, 404])
    if (found.status === 200) return
    await this.request("POST", "/networks/create", { Name: name, CheckDuplicate: true }, [201, 409])
  }

  async createDesktop({ token, name, image, network, startedAt, expiresAt }) {
    const created = await this.json("POST", `/containers/create?name=${encodeURIComponent(name)}`, desktopConfiguration({ token, image, network, startedAt, expiresAt }), [201])
    await this.request("POST", `/containers/${created.Id}/start`, undefined, [204])
    return created.Id
  }

  async inspect(id) {
    return await this.json("GET", `/containers/${encodeURIComponent(id)}/json`, undefined, [200])
  }

  async stop(id) {
    await this.request("POST", `/containers/${encodeURIComponent(id)}/stop?t=10`, undefined, [204, 304, 404])
  }

  async listDesktops() {
    const filters = encodeURIComponent(JSON.stringify({ label: ["phreshos.demo=true"] }))
    return await this.json("GET", `/containers/json?all=true&filters=${filters}`, undefined, [200])
  }

  /** Starts one container from a complete configuration, without a name. */
  async run(configuration) {
    const created = await this.json("POST", "/containers/create", configuration, [201])
    await this.request("POST", `/containers/${created.Id}/start`, undefined, [204])
    return created.Id
  }

  /** The id an image reference points to, or null when there is none. */
  async imageId(reference) {
    const found = await this.request("GET", `/images/${encodeURIComponent(reference)}/json`, undefined, [200, 404])
    return found.status === 200 ? JSON.parse(found.body.toString("utf8")).Id : null
  }

  /** Builds an image from a tar context; the build's own failure becomes this call's failure. */
  async build({ tag, dockerfile, context, buildArgs }) {
    const query = new URLSearchParams({ t: tag, dockerfile, buildargs: JSON.stringify(buildArgs), rm: "1", forcerm: "1", pull: "1" })
    const response = await this.request("POST", `/build?${query}`, context, [200])
    for (const line of response.body.toString("utf8").split("\n")) {
      if (!line.trim()) continue
      const message = JSON.parse(line)
      if (message.errorDetail || message.error) throw new Error(`Building ${tag} failed: ${message.errorDetail?.message ?? message.error}`)
    }
  }

  async tagImage(reference, repository, tag) {
    await this.request("POST", `/images/${encodeURIComponent(reference)}/tag?repo=${encodeURIComponent(repository)}&tag=${encodeURIComponent(tag)}`, undefined, [201])
  }

  async listImages(repository) {
    const filters = encodeURIComponent(JSON.stringify({ reference: [repository] }))
    return await this.json("GET", `/images/json?filters=${filters}`, undefined, [200])
  }

  async removeImage(id) {
    await this.request("DELETE", `/images/${encodeURIComponent(id)}`, undefined, [200, 404])
  }

  async json(method, path, body, expected) {
    const response = await this.request(method, path, body, expected)
    return response.body.length ? JSON.parse(response.body.toString("utf8")) : null
  }

  request(method, path, body, expected = [200]) {
    // A Buffer is sent as it is, such as a build context; anything else as JSON.
    const raw = Buffer.isBuffer(body)
    const payload = body === undefined ? null : raw ? body : Buffer.from(JSON.stringify(body))
    return new Promise((resolve, reject) => {
      const request = http.request({
        socketPath: this.socketPath,
        path: `${api}${path}`,
        method,
        headers: payload ? { "content-type": raw ? "application/x-tar" : "application/json", "content-length": payload.length } : {}
      }, response => {
        const chunks = []
        response.on("data", chunk => chunks.push(chunk))
        response.on("end", () => {
          const result = { status: response.statusCode ?? 0, body: Buffer.concat(chunks) }
          if (expected.includes(result.status)) resolve(result)
          else reject(new Error(`Docker ${method} ${path} returned ${result.status}: ${result.body.toString("utf8")}`))
        })
      })
      request.on("error", reject)
      if (payload) request.end(payload)
      else request.end()
    })
  }
}

export function desktopConfiguration({ token, image, network, startedAt, expiresAt }) {
  return {
    Image: image,
    // The machine learns its own lifetime from here; the manager, not the machine, ends it on time.
    Env: [
      `PHRESHOS_DEMO_STARTED_AT=${new Date(startedAt).toISOString()}`,
      `PHRESHOS_DEMO_EXPIRES_AT=${new Date(expiresAt).toISOString()}`
    ],
    // Root here is confined to the rootless engine's user namespace. The
    // writable layer is the disposable OS that Program installers own.
    User: "0:0",
    Labels: {
      "phreshos.demo": "true",
      "phreshos.demo.session": token
    },
    ExposedPorts: { "4300/tcp": {} },
    HostConfig: {
      AutoRemove: true,
      NetworkMode: network,
      Privileged: false,
      ReadonlyRootfs: false,
      Memory: 1_610_612_736,
      MemorySwap: 1_610_612_736,
      NanoCpus: 1_000_000_000,
      PidsLimit: 256,
      SecurityOpt: ["no-new-privileges"],
      // /tmp belongs to the same disposable writable layer as the rest of the
      // desktop. A separate small tmpfs breaks installers that unpack native
      // toolchains there without strengthening session isolation.
      // Docker enables local-log compression by default, but compression is
      // invalid when retention owns only one file.
      LogConfig: { Type: "local", Config: { "max-size": "10m", "max-file": "1", compress: "false" } }
    },
    StopTimeout: 10
  }
}
