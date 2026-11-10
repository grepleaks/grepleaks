/**
 * Engagement scope and rate limiting.
 */

import { readFileSync } from "node:fs"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
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

export class ScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ScopeError"
  }
}

/**
 * Loads the first scope file that exists. A file that exists but cannot be read
 * or parsed throws a ScopeError instead of silently falling back to "no scope"
 * (which would allow every target). An explicit GREPLEAKS_SCOPE path that does
 * not exist is also an error rather than a silent fallback.
 */
export function loadScope(workspace: string): LoadedScope | undefined {
  const explicit = process.env.GREPLEAKS_SCOPE
  const candidates = [
    explicit,
    path.join(workspace, ".grepleaks", "scope.json"),
    path.join(workspace, "scope.json"),
  ].filter((item): item is string => Boolean(item))
  for (const candidate of candidates) {
    let raw: string
    try {
      raw = readFileSync(candidate, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        if (explicit && candidate === explicit) throw new ScopeError(`Scope file ${candidate} (GREPLEAKS_SCOPE) does not exist`)
        continue
      }
      throw new ScopeError(`Scope file ${candidate} could not be read: ${error instanceof Error ? error.message : String(error)}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new ScopeError(`Scope file ${candidate} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ScopeError(`Scope file ${candidate} must contain a JSON object`)
    }
    return { config: parseScope(parsed), path: candidate }
  }
  return undefined
}

/** loadScope variant that reports a broken scope file instead of throwing. */
export function tryLoadScope(workspace: string): { loaded?: LoadedScope; error?: string } {
  try {
    return { loaded: loadScope(workspace) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443", "ws:": "80", "wss:": "443" }

function parseTarget(target: string): URL | undefined {
  try {
    return new URL(target.includes("://") ? target : `http://${target}`)
  } catch {
    return undefined
  }
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.+$/, "")
}

function hostOf(target: string): string {
  const parsed = parseTarget(target)
  if (parsed) return normalizeHost(parsed.hostname)
  return normalizeHost(target.split(/[/?#]/)[0] ?? target)
}

/** Effective port: explicit port, or the scheme's default port. */
function effectivePort(url: URL): string {
  return url.port || DEFAULT_PORTS[url.protocol] || ""
}

function portOf(target: string): string | undefined {
  const parsed = parseTarget(target)
  return parsed ? effectivePort(parsed) || undefined : undefined
}

/**
 * Path segments after percent-decoding, collapsing duplicate slashes and
 * resolving dot segments. Query and fragment are ignored.
 */
function pathSegments(url: URL, lowercase: boolean): string[] {
  const segments: string[] = []
  for (const rawSegment of url.pathname.split("/")) {
    let decoded = rawSegment
    try {
      decoded = decodeURIComponent(rawSegment)
    } catch {
      // Malformed escapes are compared verbatim.
    }
    // A decoded "%2F" or "\" acts as a separator.
    for (const part of decoded.split(/[/\\]/)) {
      if (!part || part === ".") continue
      if (part === "..") {
        segments.pop()
        continue
      }
      segments.push(lowercase ? part.toLowerCase() : part)
    }
  }
  return segments
}

/**
 * URL entries match on origin (protocol, host, effective port) and then on path
 * segment boundaries. For out-of-scope entries (lenient = true) protocol and
 * port are ignored and the path is compared case-insensitively, so cosmetic
 * variants of an excluded URL cannot slip through.
 */
function matchUrlEntry(target: string, entry: string, lenient: boolean): boolean {
  const entryUrl = parseTarget(entry)
  const targetUrl = parseTarget(target)
  if (!entryUrl || !targetUrl) return false
  if (normalizeHost(entryUrl.hostname) !== normalizeHost(targetUrl.hostname)) return false
  if (!lenient) {
    if (entryUrl.protocol !== targetUrl.protocol) return false
    if (effectivePort(entryUrl) !== effectivePort(targetUrl)) return false
  }
  const entrySegments = pathSegments(entryUrl, lenient)
  const targetSegments = pathSegments(targetUrl, lenient)
  if (entrySegments.length > targetSegments.length) return false
  return entrySegments.every((segment, index) => targetSegments[index] === segment)
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
  const hostInt = ipv4ToInt(host.replace(/^::ffff:/i, ""))
  const netInt = ipv4ToInt(network)
  if (hostInt === undefined || netInt === undefined) return false
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (hostInt & mask) === (netInt & mask)
}

const CIDR_ENTRY = /^\d+\.\d+\.\d+\.\d+\/\d+$/

function isCidrEntry(entry: string): boolean {
  return CIDR_ENTRY.test(entry.trim())
}

function matchEntry(target: string, host: string, entry: string, lenient: boolean): boolean {
  const value = entry.trim()
  if (!value) return false
  if (/^https?:\/\//i.test(value)) return matchUrlEntry(target, value, lenient)
  if (CIDR_ENTRY.test(value)) return matchCidr(host, value)
  if (value.startsWith("*.")) {
    const suffix = normalizeHost(value.slice(1))
    return host === suffix.slice(1) || host.endsWith(suffix)
  }
  if (value.includes(":")) {
    const [entryHost, entryPort] = value.split(":")
    const port = portOf(target)
    return host === normalizeHost(entryHost ?? "") && (!entryPort || port === entryPort)
  }
  return host === normalizeHost(value)
}

export function matchScope(config: ScopeConfig | undefined, target: string): ScopeDecision {
  if (!config) {
    return { configured: false, allowed: true, reason: "no scope file configured" }
  }
  const host = hostOf(target)
  for (const entry of config.outOfScope ?? []) {
    if (matchEntry(target, host, entry, true)) {
      return { configured: true, allowed: false, reason: `out of scope: ${entry}`, matched: entry, host }
    }
  }
  if (!config.inScope || config.inScope.length === 0) {
    return { configured: true, allowed: false, reason: "scope file has no in_scope entries; refusing all targets", host }
  }
  for (const entry of config.inScope) {
    if (matchEntry(target, host, entry, false)) {
      return { configured: true, allowed: true, reason: `in scope: ${entry}`, matched: entry, host }
    }
  }
  return { configured: true, allowed: false, reason: "target does not match any in_scope entry", host }
}

export type Resolver = (host: string) => Promise<string[]>

const defaultResolver: Resolver = async (host) => {
  const addresses = await lookup(host, { all: true, verbatim: true })
  return addresses.map((item) => item.address)
}

/**
 * matchScope plus DNS: when the scope contains CIDR entries, the target
 * hostname is resolved and every resolved address is checked against them.
 * Any address in an out-of-scope CIDR denies; a hostname that matched no
 * in-scope entry is allowed only if every address falls in an in-scope CIDR.
 *
 * Residual risk: the HTTP client resolves the name again when it connects, so
 * a DNS-rebinding target could answer differently between this check and the
 * connection. Full protection would require pinning the checked IP.
 */
export async function matchScopeResolved(
  config: ScopeConfig | undefined,
  target: string,
  resolve: Resolver = defaultResolver,
): Promise<ScopeDecision> {
  const decision = matchScope(config, target)
  if (!config || (!decision.allowed && decision.matched)) return decision
  if (!config.inScope?.length) return decision
  const outCidrs = (config.outOfScope ?? []).filter(isCidrEntry)
  const inCidrs = config.inScope.filter(isCidrEntry)
  if (!outCidrs.length && !inCidrs.length) return decision
  const host = decision.host ?? hostOf(target)
  if (isIP(host.replace(/^\[|\]$/g, ""))) return decision
  if (decision.allowed && !outCidrs.length) return decision
  if (!decision.allowed && !inCidrs.length) return decision

  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch (error) {
    return {
      configured: true,
      allowed: false,
      reason: `could not resolve ${host} to check CIDR scope: ${error instanceof Error ? error.message : String(error)}`,
      host,
    }
  }
  if (!addresses.length) {
    return { configured: true, allowed: false, reason: `could not resolve ${host} to check CIDR scope`, host }
  }
  for (const address of addresses) {
    const hit = outCidrs.find((entry) => matchCidr(address, entry))
    if (hit) {
      return { configured: true, allowed: false, reason: `out of scope: ${hit} (${host} resolves to ${address})`, matched: hit, host }
    }
  }
  if (decision.allowed) return decision
  const matched: string[] = []
  for (const address of addresses) {
    const hit = inCidrs.find((entry) => matchCidr(address, entry))
    if (!hit) return decision
    matched.push(hit)
  }
  return {
    configured: true,
    allowed: true,
    reason: `in scope: ${matched[0]} (${host} resolves to ${addresses.join(", ")})`,
    matched: matched[0],
    host,
  }
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
