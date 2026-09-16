import { expect, test } from "bun:test"
import { configuredModels, modelEndpoint } from "../../src/util/grepleaks-model"

test("only explicitly configured models appear, including unavailable connections", () => {
  expect(configuredModels({}, [{ id: "opencode", models: {} }])).toEqual([])
  const models = configuredModels({ provider: { personal: { models: { "exact/model": { name: "My model" } } } } }, [])
  expect(models).toEqual([
    { providerID: "personal", modelID: "exact/model", name: "My model", providerName: "personal", available: false },
  ])
})

test("provider URLs reject embedded credentials and preserve required API paths", () => {
  for (const value of [
    "yes",
    "file:///tmp/key",
    "https://user:secret@example.com/v1",
    "https://example.com/v1?key=secret",
    "https://example.com/#secret",
  ])
    expect(modelEndpoint(value)).toBeUndefined()
  expect(modelEndpoint(" https://example.com/api/v1/ ")).toBe("https://example.com/api/v1")
  expect(modelEndpoint("http://localhost:1234/v1")).toBe("http://localhost:1234/v1")
})
