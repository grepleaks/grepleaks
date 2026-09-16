import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { WORDMARK, WORDMARK_WIDTH } from "./brand-art"
import { Logo } from "./logo"

export const LOGO_RAIN_WIDTH = WORDMARK_WIDTH + 16
export const LOGO_RAIN_HEIGHT = WORDMARK.length + 8

export function LogoRain() {
  const { theme, mode } = useTheme()
  const dimensions = useTerminalDimensions()
  const width = createMemo(() => Math.max(1, Math.min(LOGO_RAIN_WIDTH, dimensions().width - 4)))
  const expanded = createMemo(() => width() >= WORDMARK_WIDTH + 4 && dimensions().height >= 32)
  return (
    <box width={width()} height={expanded() ? LOGO_RAIN_HEIGHT : 4} alignItems="center" flexShrink={0}>
      <Show when={expanded()} fallback={<Logo />}>
        <box
          position="absolute"
          top={4}
          left={Math.floor((width() - WORDMARK_WIDTH) / 2)}
          width={WORDMARK_WIDTH}
          height={WORDMARK.length}
          backgroundColor={theme.background}
        >
          <For each={WORDMARK}>
            {(line) => (
              <text fg={mode() === "dark" ? "#ffffff" : theme.text} selectable={false}>
                {line.slice(0, 33)}
                <span style={{ fg: theme.primary }}>{line.slice(33)}</span>
              </text>
            )}
          </For>
        </box>
      </Show>
      <box
        position="absolute"
        top={expanded() ? 11 : 2}
        width={Math.min(27, width())}
        alignItems="center"
        backgroundColor={theme.background}
      >
        <text fg={theme.textMuted} selectable={false}>
          YOUR AI PENTEST ENVIRONMENT
        </text>
      </box>
    </box>
  )
}
