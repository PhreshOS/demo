import { StrictMode, useEffect, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { Button, Flex, Heading, Loading, ProgressBar, Surface, Text, UIProvider, useRequirement } from "@phreshos/react-ui"
import logoSource from "./logo.svg" with { type: "text" }

const logo = `data:image/svg+xml,${encodeURIComponent(logoSource)}`

/** What the manager reports, one line per change, while it prepares a desktop. */
type Progress =
  | { status: "container" | "system" | "failed" }
  | { status: "full", freesIn: number | null, lifetime: number }
  | { status: "ready", desktop: string }

function Demo() {
  const [progress, setProgress] = useState<Progress>({ status: "container" })
  const [attempt, setAttempt] = useState(0)
  // A visitor whose desktop has ended arrives here told so, and starts a new one only when they choose.
  const [ended, setEnded] = useState(() => new URLSearchParams(location.search).has("ended"))

  useEffect(() => {
    if (ended) return
    const controller = new AbortController()
    setProgress({ status: "container" })
    void follow(controller.signal, next => {
      setProgress(next)
      if (next.status === "ready") location.replace(next.desktop)
    }).catch(() => {
      if (!controller.signal.aborted) setProgress({ status: "failed" })
    })
    return () => controller.abort()
  }, [attempt, ended])

  if (ended) {
    return <Page>
      <Flex direction="column" align="center" gap="medium" style={{ textAlign: "center" }}>
        <Heading level={1} size="large">Your demo has returned to seed.</Heading>
        <Text tone="secondary">Its time is up, and everything in it is gone.</Text>
        <Button color="primary" onPress={() => {
          history.replaceState(null, "", "/")
          setEnded(false)
        }}>Plant a new one</Button>
      </Flex>
    </Page>
  }

  if (progress.status === "failed" || progress.status === "full") {
    return <Page>
      <Flex direction="column" align="center" gap="medium" style={{ textAlign: "center" }}>
        <Heading level={1} size="large">{progress.status === "full" ? "The garden is full right now." : "Nothing grew this time."}</Heading>
        <Text tone="secondary">{progress.status === "full" ? "Every demo is in use." : "Your desktop could not be started."}</Text>
        {progress.status === "full" && <Wait freesIn={progress.freesIn} lifetime={progress.lifetime} />}
        {/* When every demo is in use, the garden can still be planted at home. */}
        <Flex gap="small" wrap justify="center">
          <Button color="primary" onPress={() => setAttempt(value => value + 1)}>Try again</Button>
          {progress.status === "full" && <Button href="https://phreshos.com/docs">Install it on your machine</Button>}
        </Flex>
      </Flex>
    </Page>
  }

  const system = progress.status === "system" || progress.status === "ready"
  return <Page>
    <Loading steps>
      <Step ready={system} message="Preparing the soil" />
      <Step ready={progress.status === "ready"} message="Planting PhreshOS" />
      {/* The desktop takes over from here and shows its own loading. */}
      <Step ready={false} message="Opening your desktop" />
    </Loading>
    <Text tone="secondary" size="small" style={{ position: "absolute", insetInline: 0, bottom: "2em", textAlign: "center" }}>
      This desktop is yours for an hour, then it is cleared. Nothing in it is kept, so keep private things out of it.
    </Text>
  </Page>
}

/**
 * How long until the soonest demo ends: the time left, large, and a bar of how far that demo
 * is through its life, full when it ends. Counted each second from when the manager said so.
 */
function Wait({ freesIn, lifetime }: Readonly<{ freesIn: number | null, lifetime: number }>) {
  const [arrived] = useState(Date.now)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  if (freesIn === null) return <Text tone="secondary">Try again in a few minutes.</Text>
  const remaining = Math.max(0, arrived + freesIn - now)
  const left = Math.ceil(remaining / 1000)
  const filled = Math.min(100, Math.max(0, (lifetime - remaining) / lifetime * 100))
  const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`

  return <Flex direction="column" align="center" gap="small" style={{ width: "min(22rem, 80vw)", marginBlock: "0.5em" }}>
    <Heading level={2} size="xlarge" style={{ fontVariantNumeric: "tabular-nums" }}>{left > 0 ? time : "Free now"}</Heading>
    <ProgressBar value={filled} valueLabel="" label={left > 0 ? "until the next demo is free" : "A demo is free. Try again to plant yours."} style={{ width: "100%" }} />
  </Flex>
}

function Step({ ready, message }: Readonly<{ ready: boolean, message: string }>) {
  useRequirement(ready, message)
  return null
}

/** The whole page is one flat Surface, so it takes the theme's paint and text color. */
function Page({ children }: Readonly<{ children: ReactNode }>) {
  return <Surface as="main" depth="flat" radius={0} style={{ position: "relative", height: "100%", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif" }}>
    {children}
    {/* The same brand as the site's header, so a visitor knows where they still are. */}
    <a href="https://phreshos.com" style={{ position: "absolute", top: "1.5em", left: "1.5em", display: "flex", alignItems: "center", gap: 10, color: "inherit", textDecoration: "none", fontSize: 20, fontWeight: 600 }}>
      <img src={logo} alt="" width={28} height={28} />
      PhreshOS
    </a>
  </Surface>
}

/** Starts the desktop, or follows the one already starting, reporting each line of progress. */
async function follow(signal: AbortSignal, report: (progress: Progress) => void) {
  const response = await fetch("/__manager/start", { method: "POST", signal })
  if (!response.body) throw new Error("The manager sent no progress")
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffered = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffered += value
    const lines = buffered.split("\n")
    buffered = lines.pop() ?? ""
    for (const line of lines) if (line) report(JSON.parse(line) as Progress)
  }
}

document.head.append(Object.assign(document.createElement("link"), { rel: "icon", href: logo }))

createRoot(document.getElementById("demo")!).render(<StrictMode><UIProvider><Demo /></UIProvider></StrictMode>)
