import { createMemo } from "solid-js"
import { sortBy } from "remeda"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useModelSetup } from "./dialog-add-model"
import { configuredModels } from "../util/grepleaks-model"

export function DialogModel(_props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()
  const addModel = useModelSetup()
  const models = createMemo(() => configuredModels(sync.data.config, sync.data.provider))
  const options = createMemo(() => {
    const grepleaks = models().find((model) => model.providerID === "grepleaks")
    return [
      {
        title: "+ Add model",
        value: "add",
        description: "Connect your own API",
        onSelect: () => addModel(),
      },
      {
        title: "Grepleaks key",
        value: "grepleaks",
        description: grepleaks?.available ? "Managed unrestricted models" : "Add your Grepleaks key",
        onSelect: () => {
          if (!grepleaks?.available) return addModel({ providerID: "grepleaks" })
          return select(grepleaks.providerID, grepleaks.modelID)
        },
      },
      ...models()
        .filter((model) => model.providerID !== "grepleaks")
        .map((model) => ({
          title: model.name,
          value: `${model.providerID}/${model.modelID}`,
          description: model.modelID,
          footer: model.available ? undefined : "Configure",
          onSelect: () =>
            model.available
              ? select(model.providerID, model.modelID)
              : addModel({ providerID: model.providerID, modelID: model.modelID }),
        })),
    ]
  })

  async function select(providerID: string, modelID: string) {
    try {
      await sdk.client.global.config.update({ config: { model: `${providerID}/${modelID}` } }, { throwOnError: true })
      local.model.set({ providerID, modelID }, { recent: true })
      dialog.clear()
    } catch {
      toast.show({ variant: "error", message: "Could not save the selected model. Try again." })
    }
  }

  return (
    <DialogSelect
      title="Models"
      options={options()}
      flat
      actions={[
        {
          command: "model.dialog.provider",
          title: "Configure",
          onTrigger(option) {
            if (option.value === "add") return addModel()
            if (option.value === "grepleaks") return addModel({ providerID: "grepleaks" })
            const model = models().find((item) => `${item.providerID}/${item.modelID}` === option.value)
            addModel({ providerID: model?.providerID, modelID: model?.modelID })
          },
        },
      ]}
    />
  )
}

export function sortModelOptions<T extends { footer?: string; releaseDate: string | number; title: string }>(
  options: T[],
  newestFirst: boolean,
) {
  if (newestFirst) return sortBy(options, [(option) => option.releaseDate, "desc"], (option) => option.title)
  return sortBy(
    options,
    (option) => option.footer !== "Free",
    [(option) => option.releaseDate, "desc"],
    (option) => option.title,
  )
}
