import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2"

export function contextMessage(messages: readonly Message[]) {
  // A successful summary resets context, but its input usage describes the old history.
  // Keep this boundary until a subsequent normal response reports fresh usage.
  return messages.findLast(
    (item): item is AssistantMessage =>
      item.role === "assistant" && (item.summary ? !!item.finish && !item.error : item.tokens.output > 0),
  )
}
