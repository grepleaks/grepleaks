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
  // gateway instead of "Limit unknown". Refetches whenever the conversation
  // changes, so it drops as the session consumes credits.
  const [balance, setBalance] = createSignal<number | null>(null)
  const managed = createMemo(() => {
    const last = contextMessage(msg())
    if (!last || last.providerID !== "grepleaks") return undefined
    const provider = props.api.state.provider.find((item) => item.id === "grepleaks") as { key?: string } | undefined
    const baseURL = (props.api.state.config.provider?.["grepleaks"]?.options as { baseURL?: string } | undefined)?.baseURL
    if (!provider?.key || !baseURL) return undefined
    return { key: provider.key, baseURL: String(baseURL).replace(/\/$/, "") }
  })
  createEffect(() => {
    const m = managed()
    if (!m) {
      setBalance(null)
      return
    }
    let cancelled = false
    fetch(`${m.baseURL}/credits`, { headers: { Authorization: `Bearer ${m.key}` } })
      .then((res) => (res.ok ? res.json() : undefined))
      .then((body) => {
        if (!cancelled && body && typeof body.balance_cents === "number") setBalance(body.balance_cents)
      })
      .catch(() => {})
    onCleanup(() => {
      cancelled = true
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
