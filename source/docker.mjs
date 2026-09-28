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

  async createDesktop({ token, name, image, network }) {
    const created = await this.json("POST", `/containers/create?name=${encodeURIComponent(name)}`, desktopConfiguration({ token, image, network }), [201])
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

  async json(method, path, body, expected) {
    const response = await this.request(method, path, body, expected)
    return response.body.length ? JSON.parse(response.body.toString("utf8")) : null
  }

  request(method, path, body, expected = [200]) {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
    return new Promise((resolve, reject) => {
      const request = http.request({
        socketPath: this.socketPath,
        path: `${api}${path}`,
        method,
        headers: payload ? { "content-type": "application/json", "content-length": payload.length } : {}
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

export function desktopConfiguration({ token, image, network }) {
  return {
    Image: image,
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
