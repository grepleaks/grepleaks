/**
 * Grepleaks evidence model.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "info"

export type FindingStatus =
  | "candidate"
  | "confirmed"
  | "reported"
  | "fixed"
  | "false_positive"
  | "suppressed"

export type VerificationStatus = "reproduced" | "not_reproduced" | "inconclusive" | "error" | "skipped"

export interface HttpEvidence {
  method?: string
  url: string
  status?: number
  requestHeaders?: Record<string, string>
  requestBody?: string
  responseHeaders?: Record<string, string>
  responseBody?: string
  durationMs?: number
}

export interface Assertion {
  kind: string
  expected: unknown
  actual: unknown
  passed: boolean
  detail?: string
}

export interface Verification {
  status: VerificationStatus
  method: string
  summary: string
  assertions: Assertion[]
  evidence?: HttpEvidence[]
  oastConfirmed?: boolean
  verifiedAt: string
}

export interface FindingEvidence {
  request?: HttpEvidence
  response?: HttpEvidence
  payload?: string
  output?: string
  files?: string[]
  notes?: string
  /** Declarative expectations used by the generic replay oracle. */
  expect?: {
    status?: number
    contains?: string
    notContains?: string
    maxLength?: number
  }
  steps?: string[]
}

export interface FindingInput {
  title: string
  category: string
  severity: Severity
  target: string
  description: string
  impact: string
  remediation?: string
  endpoint?: string
  parameter?: string
  method?: string
  cwe?: string
  cvss?: number
  cvssVector?: string
  confidence?: number
  evidence?: FindingEvidence
  identities?: string[]
  tags?: string[]
  source?: string
  status?: FindingStatus
}

export interface Finding extends Required<Omit<FindingInput, "remediation" | "endpoint" | "parameter" | "method" | "cwe" | "cvss" | "cvssVector" | "source" | "status">> {
  id: string
  remediation?: string
  endpoint?: string
  parameter?: string
  method?: string
  cwe?: string
  cvss?: number
  cvssVector?: string
  source?: string
  status: FindingStatus
  verified: boolean
  verification?: Verification
  dedupeKey: string
  createdAt: string
  updatedAt: string
}

export interface Engagement {
  name: string
  client?: string
  start?: string
  end?: string
  tester?: string
  authorization?: string
  notes?: string
}

export interface ScopeConfig {
  engagement?: string
  client?: string
  start?: string
  end?: string
  tester?: string
  authorization?: string
  notes?: string
  inScope?: string[]
  outOfScope?: string[]
  rateLimit?: number
  attribution?: Record<string, string>
  allowedActivities?: string[]
}

export interface ScopeDecision {
  configured: boolean
  allowed: boolean
  reason: string
  matched?: string
  host?: string
}

export interface AuthProfile {
  label: string
  role?: string
  type: "bearer" | "cookie" | "basic" | "header" | "none"
  headers: Record<string, string>
  secret?: string
}

export interface HttpRequestInput {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  identity?: string
  timeoutMs?: number
  followRedirects?: boolean
}

export interface HttpResult {
  ok: boolean
  error?: string
  evidence: HttpEvidence
  bodyText: string
  headers: Record<string, string>
}

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"]

export function severityRank(value: Severity): number {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[value] ?? 0
}

export function asSeverity(value: string | undefined): Severity {
  return SEVERITIES.includes(value as Severity) ? (value as Severity) : "medium"
}
