/**
 * Scope-aware HTTP client used by the verification oracles and the agent.
 */

import type { AuthProfile, HttpEvidence, HttpRequestInput, HttpResult, ScopeConfig } from "./types"
import { attributionHeaders, loadScope, matchScope, requireScope, waitForRateLimit } from "./scope"
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
  profiles?: AuthProfile[]
}

export function contextFor(workspace: string): HttpContext {
  const loaded = loadScope(workspace)
  const auth = loadAuth(workspace)
  return { workspace, scope: loaded?.config, profiles: auth.profiles }
}

export async function httpRequest(ctx: HttpContext, input: HttpRequestInput): Promise<HttpResult> {
  const scope = ctx.scope ?? loadScope(ctx.workspace)?.config
  const decision = matchScope(scope, input.url)
  const evidence: HttpEvidence = {
    method: input.method ?? "GET",
    url: input.url,
    requestHeaders: redactHeaders({ ...(input.headers ?? {}) }),
    requestBody: redactText(input.body),
  }
  if (!decision.allowed && (decision.configured || requireScope())) {
    return {
      ok: false,
      error: `Scope refused: ${decision.reason}`,
      evidence,
      bodyText: "",
      headers: {},
    }
  }

  await waitForRateLimit(hostOf(input.url), scope?.rateLimit)
  const profiles = ctx.profiles ?? loadAuth(ctx.workspace).profiles
  const profile = profileFor(profiles, input.identity)
  const headers: Record<string, string> = {
    "User-Agent": "Grepleaks/1.0 (authorized security testing)",
    ...attributionHeaders(scope),
    ...(profile?.headers ?? {}),
    ...(input.headers ?? {}),
  }
  evidence.requestHeaders = redactHeaders({ ...headers })

  const started = Date.now()
  try {
    const response = await fetch(input.url, {
      method: input.method ?? "GET",
      headers,
      body: input.body,
      redirect: input.followRedirects ? "follow" : "manual",
      signal: AbortSignal.timeout(input.timeoutMs ?? 15000),
    })
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
