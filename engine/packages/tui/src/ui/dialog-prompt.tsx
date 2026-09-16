import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { Show, createEffect, createSignal, onMount, type JSX } from "solid-js"
import { Spinner } from "../component/spinner"
import { useTuiConfig } from "../config"
import { useBindings, useCommandShortcut } from "../keymap"

export type DialogPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  busy?: boolean
  busyText?: string
  secret?: boolean
  onConfirm?: (value: string) => void
  onCancel?: () => void
}

export function DialogPrompt(props: DialogPromptProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const submitShortcut = useCommandShortcut("dialog.prompt.submit")
  const [textareaTarget, setTextareaTarget] = createSignal<TextareaRenderable>()
  const [secret, setSecret] = createSignal(props.secret ? (props.value ?? "") : "")
  let textarea: TextareaRenderable

  function confirm() {
    if (props.busy) return
    props.onConfirm?.(props.secret ? secret() : textarea.plainText)
  }

  useBindings(() => ({
    target: textareaTarget,
    enabled: textareaTarget() !== undefined && !props.busy,
    // Dialog form semantics must win over the global managed textarea input layer.
    priority: 1,
    commands: [
      {
        name: "dialog.prompt.submit",
        title: "Submit dialog prompt",
        category: "Dialog",
        run: confirm,
      },
    ],
    bindings: tuiConfig.keybinds.gather("dialog.prompt", ["dialog.prompt.submit"]),
  }))

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      if (props.busy) return
      textarea.focus()
    }, 1)
    textarea.gotoLineEnd()
  })

  createEffect(() => {
    if (!textarea || textarea.isDestroyed) return
    const traits = props.busy
      ? {
          suspend: true,
          status: "BUSY",
        }
      : {}
    textarea.traits = traits
    if (props.busy) {
      textarea.blur()
      return
    }
    textarea.focus()
  })

  createEffect(() => {
    if (!props.secret || !textareaTarget()) return
    textarea.setText("•".repeat(secret().length))
    textarea.gotoLineEnd()
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        {props.description?.()}
        <textarea
          selectable={!props.secret}
          onKeyDown={(event) => {
            if (!props.secret || props.busy || event.name === "return" || event.name === "escape") return
            event.preventDefault()
            if (event.name === "backspace") return setSecret((value) => value.slice(0, -1))
            if (event.ctrl && (event.name === "u" || event.name === "w")) return setSecret("")
            if (!event.ctrl && !event.meta && event.sequence && /^[^\x00-\x1f\x7f]+$/.test(event.sequence))
              setSecret((value) => value + event.sequence)
          }}
          onPaste={(event) => {
            if (!props.secret) return
            event.preventDefault()
            if (!props.busy) setSecret((value) => value + new TextDecoder().decode(event.bytes).replace(/[\r\n]/g, ""))
          }}
          height={3}
          ref={(val: TextareaRenderable) => {
            textarea = val
            setTextareaTarget(val)
          }}
          initialValue={props.secret ? undefined : props.value}
          placeholder={props.placeholder ?? "Enter text"}
          placeholderColor={theme.textMuted}
          textColor={props.busy ? theme.textMuted : theme.text}
          focusedTextColor={props.busy ? theme.textMuted : theme.text}
          cursorColor={props.busy ? theme.backgroundElement : theme.text}
          cursorStyle={tuiConfig.cursor}
        />
        <Show when={props.busy}>
          <Spinner color={theme.textMuted}>{props.busyText ?? "Working…"}</Spinner>
        </Show>
      </box>
      <box paddingBottom={1} gap={1} flexDirection="row">
        <Show when={!props.busy} fallback={<text fg={theme.textMuted}>processing…</text>}>
          <Show when={submitShortcut()}>
            <text fg={theme.text}>
              {submitShortcut()} <span style={{ fg: theme.textMuted }}>submit</span>
            </text>
          </Show>
        </Show>
      </box>
    </box>
  )
}

DialogPrompt.show = (dialog: DialogContext, title: string, options?: Omit<DialogPromptProps, "title">) => {
  return new Promise<string | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogPrompt title={title} {...options} onConfirm={(value) => resolve(value)} onCancel={() => resolve(null)} />
      ),
      () => resolve(null),
    )
  })
}
