import { contextMessage } from "../../util/context-message"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const cost = createMemo(() => session()?.cost ?? 0)

  // For the managed Grepleaks models, show the live credit balance from the
  // gateway instead of "Limit unknown". Refetched once per completed assistant
  // message (not on every streamed update), so it drops as credits are used.
  const [balance, setBalance] = createSignal<number | null>(null)
  // A string, not an object: memo equality then skips refetches while the
  // provider settings are unchanged.
  const managed = createMemo(() => {
    const last = contextMessage(msg())
    if (!last || last.providerID !== "grepleaks") return undefined
    const provider = props.api.state.provider.find((item) => item.id === "grepleaks") as { key?: string } | undefined
    const baseURL = (props.api.state.config.provider?.["grepleaks"]?.options as { baseURL?: string } | undefined)?.baseURL
    if (!provider?.key || !baseURL) return undefined
    return `${String(baseURL).replace(/\/$/, "")}\n${provider.key}`
  })
  const completed = createMemo(
    () => msg().filter((m) => m.role === "assistant" && (m.time as { completed?: number }).completed).length,
  )
  createEffect(() => {
    const m = managed()
    completed()
    if (!m) {
      setBalance(null)
      return
    }
    const [baseURL, key] = m.split("\n")
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    fetch(`${baseURL}/credits`, { headers: { Authorization: `Bearer ${key}` }, signal: controller.signal })
      .then((res) => (res.ok ? res.json() : undefined))
      .then((body) => {
        if (body && typeof body.balance_cents === "number") setBalance(body.balance_cents)
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout))
    onCleanup(() => {
      clearTimeout(timeout)
      controller.abort()
    })
  })

  const state = createMemo(() => {
    const last = contextMessage(msg())
    if (last?.summary) return { tokens: null, percent: null }
    if (!last) {
      return {
        tokens: 0,
        percent: null,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>
        {state().tokens === null ? "Compacted · awaiting usage" : `${state().tokens?.toLocaleString()} tokens`}
      </text>
      <text fg={theme().textMuted}>
        {balance() !== null
          ? `${money.format((balance() ?? 0) / 100)} credits`
          : state().tokens === null
            ? money.format(cost())
            : `${state().percent === null ? "Limit unknown" : `${state().percent}% used`} · ${money.format(cost())}`}
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
