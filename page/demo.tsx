import { StrictMode, useEffect, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { Button, Flex, Heading, Loading, Surface, Text, UIProvider, useRequirement } from "@phreshos/react-ui"
import logoSource from "./logo.svg" with { type: "text" }

const logo = `data:image/svg+xml,${encodeURIComponent(logoSource)}`

/** What the manager reports, one line per change, while it prepares a desktop. */
type Progress =
  | { status: "container" | "system" | "failed" | "full" }
  | { status: "ready", desktop: string }

function Demo() {
  const [progress, setProgress] = useState<Progress>({ status: "container" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setProgress({ status: "container" })
    void follow(controller.signal, next => {
      setProgress(next)
      if (next.status === "ready") location.replace(next.desktop)
    }).catch(() => {
      if (!controller.signal.aborted) setProgress({ status: "failed" })
    })
    return () => controller.abort()
  }, [attempt])

  if (progress.status === "failed" || progress.status === "full") {
    return <Page>
      <Flex direction="column" align="center" gap="medium" style={{ textAlign: "center" }}>
        <Heading level={1} size="large">{progress.status === "full" ? "The garden is full right now." : "Nothing grew this time."}</Heading>
        <Text tone="secondary">{progress.status === "full" ? "Every demo is in use. Try again in a few minutes." : "Your desktop could not be started."}</Text>
        <Button color="primary" onPress={() => setAttempt(value => value + 1)}>Try again</Button>
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
      This desktop is yours for now. It is cleared an hour after you leave, so keep private things out of it.
    </Text>
  </Page>
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
