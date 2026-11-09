import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createSignal, For, Show, onCleanup } from "solid-js"
import { readFileSync } from "node:fs"
import path from "node:path"

const id = "internal:sidebar-findings"

type Summary = {
  total: number
  verified: number
  bySeverity: Record<string, number>
  byStatus: Record<string, number>
  latest: Array<{
    id: string
    title: string
    severity: string
    status: string
    verified: boolean
    target: string
    category: string
  }>
}

function summaryPath(): string {
  const workspace = process.env.GREPLEAKS_WORKSPACE || process.env.PWD || process.cwd()
  return path.join(workspace, ".grepleaks", "summary.json")
}

function readSummary(): Summary | undefined {
  try {
    return JSON.parse(readFileSync(summaryPath(), "utf8")) as Summary
  } catch {
    return undefined
  }
}

function severityColor(api: TuiPluginApi, severity: string) {
  const theme = api.theme.current
  if (severity === "critical") return theme.error
  if (severity === "high") return theme.warning
  if (severity === "medium") return theme.primary
  if (severity === "low") return theme.success
  return theme.textMuted
}

function shorten(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = createSignal(true)
  const [summary, setSummary] = createSignal<Summary | undefined>(readSummary())
  const theme = () => props.api.theme.current
  const timer = setInterval(() => setSummary(readSummary()), 2000)
  onCleanup(() => clearInterval(timer))

  return (
    <Show when={summary() && summary()!.total > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setOpen((value) => !value)}>
          <text fg={theme().text}>
            <b>
              {open() ? "▼" : "▶"} Findings
            </b>
          </text>
          <text fg={theme().textMuted}>{summary()!.total}</text>
          <Show when={summary()!.verified > 0}>
            <text fg={theme().success}>{summary()!.verified} verified</text>
          </Show>
        </box>
        <Show when={open()}>
          <text fg={theme().textMuted}>
            {summary()!.bySeverity.critical ?? 0}C · {summary()!.bySeverity.high ?? 0}H ·{" "}
            {summary()!.bySeverity.medium ?? 0}M · {summary()!.bySeverity.low ?? 0}L
          </text>
          <For each={summary()!.latest.slice(0, 6)}>
            {(finding) => (
              <box flexDirection="row" gap={1}>
                <text fg={severityColor(props.api, finding.severity)} flexShrink={0}>
                  {finding.severity.slice(0, 4)}
                </text>
                <text fg={finding.verified ? theme().text : theme().textMuted} wrapMode="none">
                  {shorten(finding.title, 40)}
                </text>
              </box>
            )}
          </For>
          <text fg={theme().textMuted}>report: generate_report</text>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350,
    slots: {
      sidebar_content(_ctx, _props) {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
