/**
 * Lightweight triage guards: document behaviour mistaken for a finding,
 * evidence completeness, and suppression protection.
 */

import type { Finding, FindingEvidence, FindingInput, Severity } from "./types"
import { severityRank } from "./types"

const HOLDING_IT_WRONG: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(writes?|creates?|saves?) (a |the )?file\b/i, reason: "a file-writing API writing a file is intended behaviour" },
  { re: /\b(logs?|prints?|echoes?) (the |a )?(value|input|request|response)\b/i, reason: "logging or echoing the value may be intended behaviour" },
  { re: /\breturns? (a )?(200|ok|success)\b/i, reason: "a success response is not by itself a vulnerability" },
  { re: /\b(accepts?|processes?) (the )?(upload|file|input) without (a )?(visible )?error\b/i, reason: "accepting input without an error is not a finding" },
  { re: /\b(server|service) responds? (to|on) port\b/i, reason: "an open port is an observation, not a vulnerability" },
  { re: /\b(version|banner) disclosure\b/i, reason: "version disclosure alone is informational unless a matching exploit is shown" },
  { re: /\bmissing (security )?headers?\b/i, reason: "missing headers is hardening unless a concrete impact is demonstrated" },
  { re: /\b(directory|path) listing\b/i, reason: "directory listing is low impact unless sensitive content is shown" },
  { re: /\b(cookie|session) (is )?not (marked )?(secure|httponly)\b/i, reason: "a cookie flag is hardening without a demonstrated theft path" },
  { re: /\bno rate limit(ing)?\b/i, reason: "missing rate limiting needs a demonstrated abuse impact" },
]

export interface TriageResult {
  ok: boolean
  warnings: string[]
  completeness: number
  holdingItWrong?: string
  suppressed: boolean
}

function evidenceFields(evidence: FindingEvidence | undefined): string[] {
  if (!evidence) return []
  return [
    evidence.request ? "request" : "",
    evidence.response ? "response" : "",
    evidence.payload ? "payload" : "",
    evidence.output ? "output" : "",
    evidence.notes ? "notes" : "",
    evidence.steps?.length ? "steps" : "",
  ].filter(Boolean)
}

export function evidenceCompleteness(input: FindingInput | Finding): number {
  let score = 0
  const evidence = input.evidence ?? {}
  if (evidence.request) score += 0.25
  if (evidence.response) score += 0.25
  if (evidence.payload) score += 0.1
  if (evidence.output) score += 0.05
  if (input.endpoint) score += 0.1
  if (input.description.length >= 80) score += 0.1
  if (input.impact.length >= 40) score += 0.1
  if (input.remediation) score += 0.05
  if ("verification" in input && input.verification?.status === "reproduced") score += 0.0
  return Math.min(1, Math.round(score * 100) / 100)
}

export function holdingItWrong(input: FindingInput | Finding): { matched: boolean; reason?: string; suppressable: boolean } {
  const text = `${input.title}\n${input.description}`
  const severity: Severity = input.severity
  for (const rule of HOLDING_IT_WRONG) {
    if (rule.re.test(text)) {
      // Never auto-suppress a high-impact claim; hold it for verification.
      const suppressable = severityRank(severity) < severityRank("high")
      return { matched: true, reason: rule.reason, suppressable }
    }
  }
  return { matched: false, suppressable: false }
}

export function isDisclosureWorthy(input: FindingInput | Finding): boolean {
  if (severityRank(input.severity) >= severityRank("high")) return true
  if ((input.cvss ?? 0) >= 7) return true
  if ("verified" in input && input.verified) return true
  return false
}

export function triage(input: FindingInput): TriageResult {
  const warnings: string[] = []
  const holding = holdingItWrong(input)
  const completeness = evidenceCompleteness(input)
  if (holding.matched && holding.reason) {
    warnings.push(`holding-it-wrong: ${holding.reason}`)
  }
  if (completeness < 0.5) {
    warnings.push(`evidence completeness is ${Math.round(completeness * 100)}% (< 50%); add request/response evidence`)
  }
  if (!input.impact || input.impact.length < 20) {
    warnings.push("impact is very short; state the concrete consequence")
  }
  if (!input.remediation) {
    warnings.push("no remediation supplied")
  }
  const suppressed = Boolean(holding.matched && holding.suppressable && completeness < 0.5)
  return {
    ok: true,
    warnings,
    completeness,
    holdingItWrong: holding.matched ? holding.reason : undefined,
    suppressed,
  }
}

export function duplicateNote(existing: Finding, incoming: FindingInput): string {
  return [
    `Existing finding ${existing.id} matched on ${existing.category} / ${existing.target}.`,
    `Merged evidence into the existing record instead of creating a duplicate.`,
    `Incoming title: ${incoming.title}`,
  ].join(" ")
}
