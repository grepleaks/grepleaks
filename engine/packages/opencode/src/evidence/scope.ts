/**
 * Engagement scope and rate limiting.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import type { ScopeConfig, ScopeDecision } from "./types"

export interface LoadedScope {
  config: ScopeConfig
  path: string
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean)
  return []
}

function asRateLimit(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const key of ["requests_per_second", "requestsPerSecond", "per_host", "perHost", "rps"]) {
      const candidate = record[key]
      if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) return candidate
    }
  }
  return undefined
}

function asAttribution(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (typeof record.header === "string" && typeof record.value === "string") {
    return { [record.header]: record.value }
  }
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") result[key] = item
  }
  return Object.keys(result).length ? result : undefined
}

export function parseScope(value: unknown): ScopeConfig {
  if (!value || typeof value !== "object") return {}
  const record = value as Record<string, any>
  return {
    engagement: record.engagement ?? record.name,
    client: record.client,
    start: record.start,
    end: record.end,
    tester: record.tester,
    authorization: record.authorization,
    notes: record.notes,
    inScope: asList(record.in_scope ?? record.inScope ?? record.scope),
    outOfScope: asList(record.out_of_scope ?? record.outOfScope ?? record.exclude ?? record.excludes),
    rateLimit: asRateLimit(record.rate_limit ?? record.rateLimit),
    attribution: asAttribution(record.attribution ?? record.headers),
    allowedActivities: asList(record.allowed_activities ?? record.allowedActivities),
  }
}

export function loadScope(workspace: string): LoadedScope | undefined {
  const candidates = [
    process.env.GREPLEAKS_SCOPE,
    path.join(workspace, ".grepleaks", "scope.json"),
    path.join(workspace, "scope.json"),
  ].filter((item): item is string => Boolean(item))
  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, "utf8")
      return { config: parseScope(JSON.parse(raw)), path: candidate }
    } catch {
      // Try the next location.
    }
  }
  return undefined
}

function hostOf(target: string): string {
  try {
    return new URL(target.includes("://") ? target : `http://${target}`).hostname.toLowerCase()
  } catch {
    return target.toLowerCase().split(/[/?#]/)[0] ?? target.toLowerCase()
  }
}

function portOf(target: string): string | undefined {
  try {
    return new URL(target.includes("://") ? target : `http://${target}`).port || undefined
  } catch {
    return undefined
  }
}

function ipv4ToInt(address: string): number | undefined {
  const parts = address.split(".")
  if (parts.length !== 4) return undefined
  const numbers = parts.map((part) => Number(part))
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined
  return ((numbers[0]! << 24) >>> 0) + (numbers[1]! << 16) + (numbers[2]! << 8) + numbers[3]!
}

function matchCidr(host: string, entry: string): boolean {
  const [network, bitsRaw] = entry.split("/")
  if (!network || !bitsRaw) return false
  const bits = Number(bitsRaw)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const hostInt = ipv4ToInt(host)
  const netInt = ipv4ToInt(network)
  if (hostInt === undefined || netInt === undefined) return false
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (hostInt & mask) === (netInt & mask)
}

function matchEntry(target: string, host: string, entry: string): boolean {
  const value = entry.trim()
  if (!value) return false
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const normalized = value.replace(/\/+$/, "")
    const normalizedTarget = target.replace(/\/+$/, "")
    return normalizedTarget === normalized || normalizedTarget.startsWith(`${normalized}/`)
  }
  if (/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(value)) return matchCidr(host, value)
  if (value.startsWith("*.")) {
    const suffix = value.slice(1).toLowerCase()
    return host === suffix.slice(1) || host.endsWith(suffix)
  }
  if (value.includes(":")) {
    const [entryHost, entryPort] = value.split(":")
    const port = portOf(target)
    return host === entryHost?.toLowerCase() && (!entryPort || port === entryPort)
  }
  return host === value.toLowerCase()
}

export function matchScope(config: ScopeConfig | undefined, target: string): ScopeDecision {
  if (!config) {
    return { configured: false, allowed: true, reason: "no scope file configured" }
  }
  const host = hostOf(target)
  for (const entry of config.outOfScope ?? []) {
    if (matchEntry(target, host, entry)) {
      return { configured: true, allowed: false, reason: `out of scope: ${entry}`, matched: entry, host }
    }
  }
  if (!config.inScope || config.inScope.length === 0) {
    return { configured: true, allowed: true, reason: "scope has no in_scope entries", host }
  }
  for (const entry of config.inScope) {
    if (matchEntry(target, host, entry)) {
      return { configured: true, allowed: true, reason: `in scope: ${entry}`, matched: entry, host }
    }
  }
  return { configured: true, allowed: false, reason: "target does not match any in_scope entry", host }
}

export function requireScope(): boolean {
  return process.env.GREPLEAKS_REQUIRE_SCOPE === "1" || process.env.GREPLEAKS_REQUIRE_SCOPE === "true"
}

const buckets = new Map<string, number[]>()
const queues = new Map<string, Promise<void>>()

export function waitForRateLimit(host: string, requestsPerSecond: number | undefined): Promise<void> {
  if (!requestsPerSecond || requestsPerSecond <= 0) return Promise.resolve()
  const previous = queues.get(host) ?? Promise.resolve()
  const next = previous.then(async () => {
    const windowMs = 1000
    const max = Math.max(1, Math.floor(requestsPerSecond))
    const now = Date.now()
    const recent = (buckets.get(host) ?? []).filter((at) => now - at < windowMs)
    if (recent.length >= max) {
      const wait = windowMs - (now - recent[0]!)
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, wait)))
    }
    recent.push(Date.now())
    buckets.set(host, recent)
  })
  queues.set(host, next.catch(() => undefined))
  return next
}

export function attributionHeaders(config: ScopeConfig | undefined): Record<string, string> {
  return config?.attribution ?? {}
}

export function scopeSummary(config: LoadedScope | undefined): Record<string, unknown> {
  if (!config) return { configured: false }
  return {
    configured: true,
    path: config.path,
    engagement: config.config.engagement,
    client: config.config.client,
    inScope: config.config.inScope ?? [],
    outOfScope: config.config.outOfScope ?? [],
    rateLimit: config.config.rateLimit,
    allowedActivities: config.config.allowedActivities ?? [],
    authorization: config.config.authorization,
  }
}
