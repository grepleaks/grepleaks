/**
 * Target authentication profiles. Secrets stay in the profile and are only
 * materialized as request headers at call time.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import type { AuthProfile } from "./types"

function headersFor(value: any): { type: AuthProfile["type"]; headers: Record<string, string>; secret?: string } {
  if (!value || typeof value !== "object") return { type: "none", headers: {} }
  switch (value.type) {
    case "bearer":
      return { type: "bearer", headers: { Authorization: `Bearer ${value.token ?? value.value ?? ""}` }, secret: value.token ?? value.value }
    case "cookie":
      return { type: "cookie", headers: { Cookie: value.value ?? value.cookie ?? "" }, secret: value.value ?? value.cookie }
    case "basic": {
      const raw = `${value.username ?? ""}:${value.password ?? ""}`
      return {
        type: "basic",
        headers: { Authorization: `Basic ${Buffer.from(raw, "utf8").toString("base64")}` },
        secret: value.password,
      }
    }
    case "header":
      return { type: "header", headers: { [value.name ?? "X-API-Key"]: value.value ?? "" }, secret: value.value }
    default:
      return { type: "none", headers: {} }
  }
}

export function parseAuth(value: unknown): AuthProfile[] {
  const profiles: AuthProfile[] = []
  const push = (label: string, role: string | undefined, auth: unknown) => {
    const built = headersFor(auth)
    profiles.push({ label, role, ...built })
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (item && typeof item === "object" && "auth" in item) {
        push(item.label ?? `identity-${index + 1}`, item.role, (item as any).auth)
      } else {
        push(`identity-${index + 1}`, (item as any)?.role, item)
      }
    })
    return profiles
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, any>
    if (Array.isArray(record.identities)) return parseAuth(record.identities)
    if (record.auth) {
      push(record.label ?? "default", record.role, record.auth)
      return profiles
    }
    if (record.type) {
      push(record.label ?? "default", record.role, record)
      return profiles
    }
  }
  return profiles
}

export function loadAuth(workspace: string): { profiles: AuthProfile[]; path?: string } {
  const candidates = [
    process.env.GREPLEAKS_AUTH,
    path.join(workspace, ".grepleaks", "auth.json"),
    path.join(workspace, "auth.json"),
  ].filter((item): item is string => Boolean(item))
  for (const candidate of candidates) {
    try {
      return { profiles: parseAuth(JSON.parse(readFileSync(candidate, "utf8"))), path: candidate }
    } catch {
      // Try the next location.
    }
  }
  return { profiles: [] }
}

export function profileFor(profiles: AuthProfile[], identity?: string): AuthProfile | undefined {
  if (profiles.length === 0) return undefined
  if (!identity) return profiles[0]
  return profiles.find((profile) => profile.label === identity || profile.role === identity)
}

export function authStatus(profiles: AuthProfile[]): Record<string, unknown> {
  return {
    configured: profiles.length > 0,
    profiles: profiles.map((profile) => ({
      label: profile.label,
      role: profile.role,
      type: profile.type,
      headers: Object.keys(profile.headers),
      secretConfigured: Boolean(profile.secret),
    })),
  }
}
