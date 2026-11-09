import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"

export const workspace = Effect.map(InstanceState.context, (ctx) => process.env.GREPLEAKS_WORKSPACE || ctx.directory)

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function parseJsonObject(value: string | undefined, label: string): { ok: true; value: any } | { ok: false; error: string } {
  if (!value) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch {
    return { ok: false, error: `${label} must be valid JSON` }
  }
}

export function splitList(value: string | undefined): string[] {
  if (!value) return []
  return value.split(",").map((item) => item.trim()).filter(Boolean)
}
