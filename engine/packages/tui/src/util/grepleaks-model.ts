import type { Config, Provider } from "@opencode-ai/sdk/v2"

export function modelEndpoint(value: string) {
  try {
    const url = new URL(value.trim())
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined
    return url.toString().replace(/\/$/, "")
  } catch {
    return undefined
  }
}

export function configuredModels(
  config: Config,
  providers: (Pick<Provider, "id" | "models"> & Partial<Pick<Provider, "key" | "options">>)[],
) {
  return Object.entries(config.provider ?? {}).flatMap(([providerID, definition]) =>
    Object.entries(definition.models ?? {}).map(([modelID, model]) => ({
      providerID,
      modelID,
      name: model.name || modelID,
      providerName: definition.name || providerID,
      available: providers.some(
        (provider) =>
          provider.id === providerID &&
          !!provider.models[modelID] &&
          (providerID !== "grepleaks" || !!provider.key || !!provider.options?.apiKey),
      ),
    })),
  )
}
