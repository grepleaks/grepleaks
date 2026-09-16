import { expect, test } from "bun:test"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { contextMessage } from "../../src/util/context-message"

function message(patch: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: "message",
    sessionID: "session",
    role: "assistant",
    time: { created: 0 },
    parentID: "user",
    modelID: "model",
    providerID: "provider",
    mode: "build",
    agent: "build",
    path: { cwd: "/workspace", root: "/workspace" },
    cost: 0,
    tokens: { input: 131208, output: 2119, reasoning: 0, cache: { read: 0, write: 0 } },
    ...patch,
  }
}

test("completed compaction remains the boundary while the next response has no usage", () => {
  const summary = message({ summary: true, finish: "stop" })
  const pending = message({ tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })
  expect(contextMessage([message(), summary, pending])).toBe(summary)
})

test("fresh normal response replaces compaction usage", () => {
  const fresh = message({ tokens: { input: 15000, output: 200, reasoning: 0, cache: { read: 0, write: 0 } } })
  expect(contextMessage([message({ summary: true, finish: "stop" }), fresh])).toBe(fresh)
})

test("failed or unfinished summaries do not reset the context", () => {
  const previous = message()
  expect(contextMessage([previous, message({ summary: true })])).toBe(previous)
  expect(
    contextMessage([
      previous,
      message({ summary: true, finish: "error", error: { name: "UnknownError", data: { message: "failed" } } }),
    ]),
  ).toBe(previous)
})

test("empty sessions have no measured context", () => {
  expect(contextMessage([])).toBeUndefined()
})
