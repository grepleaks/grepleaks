/**
 * Scope-aware HTTP client used by the verification oracles and the agent.
 */

import type { AuthProfile, HttpEvidence, HttpRequestInput, HttpResult, ScopeConfig } from "./types"
import { attributionHeaders, matchScopeResolved, requireScope, tryLoadScope, waitForRateLimit } from "./scope"
import { loadAuth, profileFor } from "./auth"
import { redactHeaders, redactText } from "./redact"

const MAX_BODY = 200_000

function hostOf(target: string): string {
  try {
    return new URL(target.includes("://") ? target : `http://${target}`).hostname.toLowerCase()
  } catch {
    return target.toLowerCase()
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

export interface HttpContext {
  workspace: string
  scope?: ScopeConfig
  /** Set when a scope file exists but is invalid; every request is refused. */
  scopeError?: string
  profiles?: AuthProfile[]
}

export function contextFor(workspace: string): HttpContext {
  const loaded = tryLoadScope(workspace)
  const auth = loadAuth(workspace)
  return { workspace, scope: loaded.loaded?.config, scopeError: loaded.error, profiles: auth.profiles }
}

const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const CREDENTIAL_HEADER = /^(authorization|proxy-authorization|cookie)$/i

/**
 * Header values that were redacted when the finding was saved must not be
 * replayed literally; dropping them lets the auth profile supply credentials.
 */
function withoutRedacted(headers: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === "string" && value.includes("[redacted]")) continue
    result[key] = value
  }
  return result
}

function refused(evidence: HttpEvidence, reason: string): HttpResult {
  return { ok: false, error: `Scope refused: ${reason}`, evidence, bodyText: "", headers: {} }
}

export async function httpRequest(ctx: HttpContext, input: HttpRequestInput): Promise<HttpResult> {
  const evidence: HttpEvidence = {
    method: input.method ?? "GET",
    url: input.url,
    requestHeaders: redactHeaders({ ...(input.headers ?? {}) }),
    requestBody: redactText(input.body),
  }
  let scope = ctx.scope
  let scopeError = ctx.scopeError
  if (!scope && !scopeError) {
    const loaded = tryLoadScope(ctx.workspace)
    scope = loaded.loaded?.config
    scopeError = loaded.error
  }
  if (scopeError) return refused(evidence, scopeError)
  const check = async (url: string) => {
    const decision = await matchScopeResolved(scope, url)
    return !decision.allowed && (decision.configured || requireScope()) ? decision.reason : undefined
  }
  const denied = await check(input.url)
  if (denied) return refused(evidence, denied)

  const profiles = ctx.profiles ?? loadAuth(ctx.workspace).profiles
  const profile = profileFor(profiles, input.identity)
  let headers: Record<string, string> = {
    "User-Agent": "Grepleaks/1.0 (authorized security testing)",
    ...attributionHeaders(scope),
    ...(profile?.headers ?? {}),
    ...withoutRedacted(input.headers),
  }
  evidence.requestHeaders = redactHeaders({ ...headers })

  const started = Date.now()
  try {
    let url = input.url
    let method = input.method ?? "GET"
    let body = input.body
    let response: Response
    for (let hop = 0; ; hop++) {
      await waitForRateLimit(hostOf(url), scope?.rateLimit)
      response = await fetch(url, {
        method,
        headers,
        body,
        // Redirects are followed manually so every hop is scope-checked.
        redirect: "manual",
        signal: AbortSignal.timeout(input.timeoutMs ?? 15000),
      })
      const location = response.headers.get("location")
      if (!input.followRedirects || !REDIRECT_STATUSES.has(response.status) || !location) break
      if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects (max ${MAX_REDIRECTS})`)
      const next = new URL(location, url).toString()
      const redirectDenied = await check(next)
      if (redirectDenied) {
        evidence.status = response.status
        evidence.responseHeaders = redactHeaders(headersToObject(response.headers))
        evidence.durationMs = Date.now() - started
        return refused(evidence, `redirect to ${next}: ${redirectDenied}`)
      }
      await response.body?.cancel().catch(() => undefined)
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        if (method !== "HEAD") method = "GET"
        body = undefined
      }
      if (new URL(next).origin !== new URL(url).origin) {
        headers = Object.fromEntries(Object.entries(headers).filter(([key]) => !CREDENTIAL_HEADER.test(key)))
      }
      url = next
    }
    const raw = await response.text()
    const bodyText = raw.length > MAX_BODY ? raw.slice(0, MAX_BODY) : raw
    evidence.status = response.status
    evidence.responseHeaders = redactHeaders(headersToObject(response.headers))
    evidence.responseBody = redactText(bodyText)
    evidence.durationMs = Date.now() - started
    return {
      ok: true,
      evidence,
      bodyText,
      headers: evidence.responseHeaders ?? {},
    }
  } catch (error) {
    evidence.durationMs = Date.now() - started
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      evidence,
      bodyText: "",
      headers: {},
    }
  }
}

export function truncate(value: string | undefined, limit = 4000): string | undefined {
  if (!value) return value
  return value.length > limit ? `${value.slice(0, limit)}\n… (${value.length - limit} more characters)` : value
}
