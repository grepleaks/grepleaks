import { useTheme } from "../context/theme"
import { Prompt, type PromptRef } from "../component/prompt"
import { createEffect, createMemo, createSignal, onMount } from "solid-js"
import { BeamsBackground } from "../component/beams-background"
import { LogoRain } from "../component/logo-rain"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "../context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { usePluginRuntime } from "../plugin/runtime"
import { useEditorContext } from "../context/editor"
import { useTerminalDimensions } from "@opentui/solid"
import { useTuiConfig } from "../config"
import { HomeSessionDestinationProvider } from "./home/session-destination"

let once = false

export function Home() {
  const { theme } = useTheme()
  const pluginRuntime = usePluginRuntime()
  const sync = useSync()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const editor = useEditorContext()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const promptMaxWidth = createMemo(() => {
    const configured = tuiConfig.prompt?.max_width
    const available = Math.max(1, dimensions().width - 4)
    if (configured === "auto") return Math.min(available, Math.max(75, Math.floor(dimensions().width * 0.7)))
    return Math.min(available, configured ?? 79)
  })
  let sent = false

  onMount(() => {
    editor.clearSelection()
  })

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r) return
    if (route.prompt) {
      r.set(route.prompt)
      once = true
      return
    }
    if (!args.prompt) return
    r.set({ input: args.prompt, parts: [] })
    once = true
  }

  // Wait for sync and model store to be ready before auto-submitting --prompt
  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!sync.ready || !local.model.ready) return
    if (!args.prompt) return
    if (r.current.input !== args.prompt) return
    sent = true
    r.submit()
  })

  return (
    <HomeSessionDestinationProvider>
      <box flexGrow={1} overflow="hidden">
        <BeamsBackground />
        <box zIndex={1} flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
          <box flexGrow={1} minHeight={0} />

          <box flexShrink={0}>
            <pluginRuntime.Slot name="home_logo" mode="replace">
              <LogoRain />
            </pluginRuntime.Slot>
          </box>
          <box height={1} minHeight={0} flexShrink={1} />
          <box
            width="100%"
            maxWidth={promptMaxWidth()}
            zIndex={1000}
            backgroundColor={theme.background}
            paddingTop={1}
            flexShrink={0}
          >
            <pluginRuntime.Slot name="home_prompt" mode="replace" ref={bind}>
              <Prompt ref={bind} right={<pluginRuntime.Slot name="home_prompt_right" />} />
            </pluginRuntime.Slot>
          </box>
          <pluginRuntime.Slot name="home_bottom" />
          <box flexGrow={1} minHeight={0} />
          <Toast />
        </box>
      </box>
      <pluginRuntime.Slot name="home_footer" mode="single_winner" />
    </HomeSessionDestinationProvider>
  )
}
