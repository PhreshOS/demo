# PhreshOS Demo

This directory owns the complete ephemeral demo deployment: the desktop image,
the session manager, its routing configuration, and its behavior tests.

## Desktop image

`Dockerfile.desktop` builds a disposable machine with the public PhreshOS CLI
installed globally. During the image build, that CLI performs the same official
System installation transaction as a user installation and verifies the
resolved System and Sprout versions. The verified result is stored as a local
machine seed. First boot extracts that seed into the container's writable layer
so atomic System updates behave like they do on a normal filesystem. No source
repository or release is downloaded while creating the session.

```sh
docker build \
  --file Dockerfile.desktop \
  --build-arg CLI_VERSION=<version> \
  --build-arg SYSTEM_VERSION=<expected-version> \
  --build-arg SPROUT_VERSION=<expected-version> \
  --build-arg SOURCE_REVISION=<commit> \
  --tag phreshos/demo:<version> \
  .
```

The manager builds this image itself. Every ten minutes
(`DEMO_IMAGE_CHECK_MILLISECONDS`) it reads the latest CLI from npm and the
latest System and Sprout releases from GitHub. When any has changed, it builds
`phreshos/demo:<system>-sprout<sprout>-cli<cli>`, runs it once as a desktop
until its System answers, and only then points `phreshos/demo:current` at it.
New desktops start from `current`, so each release reaches the demo without any
change here, and a release whose image does not come up never does. Desktops
already running keep the image they started from; older images are removed once
nothing uses them.

The image listens on port `4300`. The CLI, installed System, registered
service, Programs, and `PHRESHOS_HOME` all live inside the container's writable
layer. The container is the disposable machine: stopping the System leaves that
machine alive, while removing the container removes its complete installation
and state. The session manager starts each desktop as root inside its rootless
Docker user namespace, with resource limits, no host mounts, and no additional
privileges. The image also includes the standard compiler toolchain needed by
Programs with native Node dependencies.

```sh
docker run --rm --user 0:0 \
  --memory 1536m --cpus 1 --pids-limit 256 \
  --security-opt no-new-privileges \
  --publish 127.0.0.1:14300:4300 \
  phreshos/demo:<version>
```

The machine's PID 1 acts as its native service manager. It starts and stops the
installed service through the public CLI, and serializes System lifecycle
mutations requested by that same CLI inside Terminal. An update therefore
continues inside the machine while the old System and its Terminal Endpoint are
stopping. All other CLI operations run directly. The globally installed
`phresh` command owns status, updates, Program installation, and service control
without delegating anything to the Docker host.

## Session manager

The manager owns ephemeral demo sessions. A first visit establishes a secure
browser-session cookie and renders the preparing page. That page confirms the
start with a same-origin `POST`, so link previews and other isolated `GET`
requests do not consume a container. The request remains open while the desktop
starts, then the manager redirects once to a short issued first-level hostname
such as `demo-abc1234.phreshos.com`. The seven-character identifier is the
shareable desktop capability. The hostname routes every request without
exposing the entry host's browser-session cookie to the desktop. Crawl robots
are excluded from the entry and issued hostnames through their shared
`robots.txt` response.

HTTP and WebSocket traffic is proxied to the session's container. A desktop
lives a fixed time from its creation, one hour by default
(`DEMO_LIFETIME_MILLISECONDS`), whether or not anyone is connected, and is
removed when that time ends. The manager passes the machine its start and end
as `PHRESHOS_DEMO_STARTED_AT` and `PHRESHOS_DEMO_EXPIRES_AT`; the machine writes
them to `/etc/phreshos/demo.json`, where Sprout finds them and shows the time
left. The file only informs: the manager ends the machine on time regardless of
it. A visitor who opens an ended desktop is sent back to the entry page, which
says so and offers a new one. The manager recovers running containers after its
own restart and limits concurrent sessions.

```sh
npm run verify
npm run build:manager
```

`Caddyfile` terminates origin HTTPS for the entry and issued desktop hostnames,
then forwards HTTP and WebSocket traffic to the manager on `127.0.0.1:18000`.

Server addresses and credentials never belong in this repository; they stay
with whoever deploys it. The generated `phreshos.zip` image input is ignored.
