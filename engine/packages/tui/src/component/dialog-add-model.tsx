import { createSignal } from "solid-js"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { modelEndpoint } from "../util/grepleaks-model"
import { DialogModel } from "./dialog-model"

export const GREPLEAKS_PROVIDER_ID = "grepleaks"
export const GREPLEAKS_BASE_URL = "https://grepleaks.com/v1"
export const GREPLEAKS_DEFAULT_MODEL = "abliterated-model-large-v2"
export const GREPLEAKS_MODELS: Record<string, { name: string }> = {
  "abliterated-model-large-v2": { name: "Abliterated Large V2" },
  "abliterated-model-large": { name: "Abliterated Large" },
  "abliterated-model": { name: "Abliterated Model" },
}

export function useModelSetup() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const toast = useToast()
  const { theme } = useTheme()
  const [busy, setBusy] = createSignal(false)
  return async (props: { providerID?: string; modelID?: string } = {}) => {
    const managed = props.providerID === GREPLEAKS_PROVIDER_ID
    const existing = props.providerID ? sync.data.config.provider?.[props.providerID] : undefined
    const values = {
      name: managed ? "Grepleaks" : existing?.name || "",
      url: managed ? GREPLEAKS_BASE_URL : String(existing?.options?.baseURL || ""),
      model: props.modelID || (managed ? GREPLEAKS_DEFAULT_MODEL : ""),
      key: "",
    }
    const fields = managed ? (["key"] as const) : (["name", "url", "model", "key"] as const)
    for (const [index, field] of fields.entries()) {
      let error = ""
      while (true) {
        const value = await DialogPrompt.show(
          dialog,
          managed ? `Grepleaks key · ${index + 1}/${fields.length}` : `Add model · ${index + 1}/${fields.length}`,
          {
            placeholder: {
              name: "Display name",
              url: "API base URL (include /v1 if required)",
              model: "Exact model ID",
              key: managed ? "Grepleaks API key (grpl_…)" : "API key",
            }[field],
            value: values[field],
            secret: field === "key",
            get busy() {
              return busy()
            },
            busyText: "Saving configuration…",
            description: () => (
              <text fg={error ? theme.error : theme.textMuted}>
                {error ||
                  (field === "key"
                    ? managed
                      ? "Input hidden. Create a key at grepleaks.com/console. Stored privately on this machine."
                      : "Input hidden. Stored privately on this machine."
                    : "Connect an OpenAI-compatible API. Settings persist between launches.")}
              </text>
            ),
          },
        )
        if (value === null) return
        const clean = value.trim()
        if (!clean || /[\r\n\x00]/.test(clean)) {
          error = "Enter a value on one line."
          continue
        }
        if (field === "url" && !modelEndpoint(clean)) {
          error = "Use an HTTP(S) URL without credentials, query parameters or a fragment."
          continue
        }
        values[field] = field === "url" ? modelEndpoint(clean)! : clean
        break
      }
    }
    setBusy(true)
    const providerID = props.providerID || `grepleaks-custom-${crypto.randomUUID()}`
    const modelID = managed ? props.modelID || GREPLEAKS_DEFAULT_MODEL : props.modelID || values.model
    try {
      // Secrets use the engine credential store, never the public configuration or chat history.
      await sdk.client.auth.set({ providerID, auth: { type: "api", key: values.key } }, { throwOnError: true })
      await sdk.client.global.config.update(
        {
          config: {
            model: `${providerID}/${modelID}`,
            provider: {
              [providerID]: {
                npm: "@ai-sdk/openai-compatible",
                name: managed ? "Grepleaks" : values.name,
                options: { baseURL: managed ? GREPLEAKS_BASE_URL : values.url },
                models: managed ? GREPLEAKS_MODELS : { [modelID]: { name: values.name } },
              },
            },
          },
        },
        { throwOnError: true },
      )
      values.key = ""
      await sdk.client.instance.dispose({}, { throwOnError: true })
      await sync.bootstrap()
      local.model.set({ providerID, modelID }, { recent: true })
      dialog.replace(() => <DialogModel />)
    } catch {
      toast.show({ variant: "error", message: "Could not save the configuration. Check the connection and try again." })
      dialog.replace(() => <DialogModel />)
    } finally {
      setBusy(false)
    }
  }
}
