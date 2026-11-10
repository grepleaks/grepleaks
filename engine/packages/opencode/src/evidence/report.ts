/**
 * Deterministic report rendering from the local findings store.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { Engagement, Finding, Severity } from "./types"
import { severityRank } from "./types"
import { scopeSummary, tryLoadScope } from "./scope"
import { openStore } from "./store"
import { redactHeaders, redactText } from "./redact"

export type ReportFormat = "markdown" | "html" | "json" | "sarif"

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function truncate(value: string | undefined, limit = 3000): string {
  if (!value) return ""
  return value.length > limit ? `${value.slice(0, limit)}\n… (${value.length - limit} more characters)` : value
}

function headerLines(headers: Record<string, string> | undefined): string {
  return Object.entries(redactHeaders(headers) ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")
}

function loadEngagement(workspace: string): Engagement {
  const scope = tryLoadScope(workspace).loaded
  if (scope) {
    return {
      name: scope.config.engagement ?? path.basename(workspace),
      client: scope.config.client,
      start: scope.config.start,
      end: scope.config.end,
      tester: scope.config.tester,
      authorization: scope.config.authorization,
      notes: scope.config.notes,
    }
  }
  for (const candidate of [path.join(workspace, ".grepleaks", "engagement.json"), path.join(workspace, "engagement.json")]) {
    try {
      const raw = JSON.parse(readFileSync(candidate, "utf8"))
      return {
        name: raw.name ?? raw.engagement ?? path.basename(workspace),
        client: raw.client,
        start: raw.start,
        end: raw.end,
        tester: raw.tester,
        authorization: raw.authorization,
        notes: raw.notes,
      }
    } catch {
      // Try the next location.
    }
  }
  return { name: path.basename(workspace) || "Engagement" }
}

function counts(findings: Finding[]): Record<Severity, number> {
  const result: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const finding of findings) result[finding.severity] += 1
  return result
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.createdAt.localeCompare(b.createdAt))
}

function findingMarkdown(finding: Finding): string {
  const lines: string[] = []
  lines.push(`### ${finding.id} — ${finding.title}`)
  lines.push("")
  lines.push(`- **Severity:** ${finding.severity}`)
  if (finding.cvss !== undefined) lines.push(`- **CVSS:** ${finding.cvss}${finding.cvssVector ? ` (${finding.cvssVector})` : ""}`)
  if (finding.cwe) lines.push(`- **CWE:** ${finding.cwe}`)
  lines.push(`- **Category:** ${finding.category}`)
  lines.push(`- **Target:** ${finding.target}`)
  if (finding.endpoint) lines.push(`- **Endpoint:** ${finding.method ?? "GET"} ${finding.endpoint}`)
  if (finding.parameter) lines.push(`- **Parameter:** ${finding.parameter}`)
  lines.push(`- **Status:** ${finding.status}${finding.verified ? " (verified)" : ""}`)
  lines.push(`- **Confidence:** ${Math.round(finding.confidence * 100)}%`)
  lines.push("")
  lines.push("**Description**")
  lines.push("")
  lines.push(finding.description)
  lines.push("")
  lines.push("**Impact**")
  lines.push("")
  lines.push(finding.impact)
  if (finding.remediation) {
    lines.push("")
    lines.push("**Remediation**")
    lines.push("")
    lines.push(finding.remediation)
  }
  if (finding.evidence.payload) {
    lines.push("")
    lines.push("**Payload**")
    lines.push("")
    lines.push("```")
    lines.push(finding.evidence.payload)
    lines.push("```")
  }
  if (finding.evidence.request) {
    lines.push("")
    lines.push("**Request**")
    lines.push("")
    lines.push("```http")
    lines.push(`${finding.evidence.request.method ?? "GET"} ${redactText(finding.evidence.request.url)}`)
    for (const [key, value] of Object.entries(redactHeaders(finding.evidence.request.requestHeaders) ?? {})) {
      lines.push(`${key}: ${value}`)
    }
    if (finding.evidence.request.requestBody) {
      lines.push("")
      lines.push(truncate(redactText(finding.evidence.request.requestBody), 1500))
    }
    lines.push("```")
  }
  if (finding.evidence.response) {
    lines.push("")
    lines.push("**Response**")
    lines.push("")
    lines.push("```http")
    lines.push(`HTTP ${finding.evidence.response.status ?? "?"}`)
    lines.push("")
    lines.push(truncate(redactText(finding.evidence.response.responseBody), 2000))
    lines.push("```")
  }
  if (finding.verification) {
    lines.push("")
    lines.push(`**Verification:** ${finding.verification.status} — ${finding.verification.summary}`)
    for (const assertion of finding.verification.assertions) {
      lines.push(`- ${assertion.passed ? "PASS" : "FAIL"} \`${assertion.kind}\` — expected ${JSON.stringify(assertion.expected)}, actual ${JSON.stringify(assertion.actual)}`)
    }
  }
  if (finding.tags.length) {
    lines.push("")
    lines.push(`**Tags:** ${finding.tags.join(", ")}`)
  }
  return lines.join("\n")
}

export function renderMarkdown(engagement: Engagement, scope: Record<string, unknown>, findings: Finding[]): string {
  const summary = counts(findings)
  const lines: string[] = []
  lines.push(`# ${engagement.name} — Security assessment`)
  lines.push("")
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push("")
  if (engagement.client) lines.push(`- **Client:** ${engagement.client}`)
  if (engagement.tester) lines.push(`- **Tester:** ${engagement.tester}`)
  if (engagement.start || engagement.end) lines.push(`- **Window:** ${engagement.start ?? "?"} → ${engagement.end ?? "?"}`)
  if (engagement.authorization) lines.push(`- **Authorization:** ${engagement.authorization}`)
  lines.push("")
  lines.push("## Executive summary")
  lines.push("")
  lines.push(`The assessment recorded **${findings.length}** finding(s): **${summary.critical} critical**, **${summary.high} high**, **${summary.medium} medium**, **${summary.low} low**, **${summary.info} informational**.`)
  lines.push("")
  lines.push("Only findings marked `verified` have a deterministic reproduction record. Unverified entries are leads and must be confirmed before disclosure.")
  lines.push("")
  lines.push("## Scope")
  lines.push("")
  if (scope.configured === false) {
    lines.push("No scope file was configured for this engagement.")
  } else if (typeof scope.error === "string") {
    lines.push(`Scope file is invalid: ${scope.error}`)
  } else {
    const inScope = Array.isArray(scope.inScope) ? scope.inScope : []
    const outOfScope = Array.isArray(scope.outOfScope) ? scope.outOfScope : []
    lines.push("**In scope:**")
    lines.push("")
    for (const item of inScope) lines.push(`- \`${item}\``)
    if (inScope.length === 0) lines.push("- (not specified)")
    if (outOfScope.length) {
      lines.push("")
      lines.push("**Out of scope:**")
      lines.push("")
      for (const item of outOfScope) lines.push(`- \`${item}\``)
    }
    if (scope.rateLimit) lines.push(`\nRate limit: ${scope.rateLimit} req/s per host.`)
  }
  lines.push("")
  lines.push("## Findings")
  lines.push("")
  if (findings.length === 0) {
    lines.push("No findings recorded.")
  } else {
    for (const finding of sortFindings(findings)) {
      lines.push(findingMarkdown(finding))
      lines.push("")
      lines.push("---")
      lines.push("")
    }
  }
  lines.push("## Methodology and limitations")
  lines.push("")
  lines.push("- The agent used the tools available in the engagement container. Tool versions and evidence are retained in the finding records when supplied.")
  lines.push("- A `reproduced` verification is category-specific and does not prove every exploit precondition. Review the assertions and evidence.")
  lines.push("- Absence of a finding is not proof of absence of vulnerabilities.")
  lines.push("- Suppressed and false-positive findings are retained in the local store but excluded from this report.")
  lines.push("")
  return lines.join("\n")
}

export function renderHtml(engagement: Engagement, scope: Record<string, unknown>, findings: Finding[]): string {
  const summary = counts(findings)
  const rows = sortFindings(findings)
    .map(
      (finding) => `<section class="finding">
  <h2><span class="sev ${finding.severity}">${escapeHtml(finding.severity)}</span> ${escapeHtml(finding.id)} — ${escapeHtml(finding.title)}</h2>
  <table>
    <tr><th>Category</th><td>${escapeHtml(finding.category)}</td></tr>
    <tr><th>Target</th><td>${escapeHtml(finding.target)}</td></tr>
    ${finding.endpoint ? `<tr><th>Endpoint</th><td>${escapeHtml(finding.method ?? "GET")} ${escapeHtml(finding.endpoint)}</td></tr>` : ""}
    ${finding.parameter ? `<tr><th>Parameter</th><td>${escapeHtml(finding.parameter)}</td></tr>` : ""}
    ${finding.cwe ? `<tr><th>CWE</th><td>${escapeHtml(finding.cwe)}</td></tr>` : ""}
    ${finding.cvss !== undefined ? `<tr><th>CVSS</th><td>${finding.cvss}${finding.cvssVector ? ` (${escapeHtml(finding.cvssVector)})` : ""}</td></tr>` : ""}
    <tr><th>Status</th><td>${escapeHtml(finding.status)}${finding.verified ? " (verified)" : ""}</td></tr>
  </table>
  <h3>Description</h3><p>${escapeHtml(finding.description)}</p>
  <h3>Impact</h3><p>${escapeHtml(finding.impact)}</p>
  ${finding.remediation ? `<h3>Remediation</h3><p>${escapeHtml(finding.remediation)}</p>` : ""}
  ${finding.evidence.payload ? `<h3>Payload</h3><pre>${escapeHtml(finding.evidence.payload)}</pre>` : ""}
  ${finding.evidence.request ? `<h3>Request</h3><pre>${escapeHtml(`${finding.evidence.request.method ?? "GET"} ${redactText(finding.evidence.request.url)}\n${headerLines(finding.evidence.request.requestHeaders)}\n\n${redactText(finding.evidence.request.requestBody) ?? ""}`)}</pre>` : ""}
  ${finding.evidence.response ? `<h3>Response</h3><pre>${escapeHtml(`HTTP ${finding.evidence.response.status ?? "?"}\n\n${redactText(truncate(finding.evidence.response.responseBody)) ?? ""}`)}</pre>` : ""}
  ${finding.verification ? `<h3>Verification</h3><p>${escapeHtml(finding.verification.status)} — ${escapeHtml(finding.verification.summary)}</p>` : ""}
</section>`,
    )
    .join("\n")
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(engagement.name)} — Security assessment</title>
<style>
:root{--bg:#0b1114;--surface:#111a1f;--line:#273338;--text:#edf2f3;--muted:#97a6ad;--cyan:#00d3e9;--crit:#ff5d5d;--high:#ff9f43;--med:#f7d154;--low:#5fd38d;--info:#8ab4f8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:48px 28px 96px}h1{font-size:34px;letter-spacing:-.02em}h2{font-size:20px;border-top:1px solid var(--line);padding-top:20px;margin-top:36px}
h3{font-size:15px;color:var(--muted);margin:20px 0 6px}p{margin:0 0 10px}.meta{color:var(--muted)}
.summary{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}.card{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:14px 18px;min-width:120px}
.card b{display:block;font-size:24px;color:var(--cyan)}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:600;width:150px}pre{background:#0e161a;border:1px solid var(--line);border-radius:6px;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px}
.sev{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#041416}
.sev.critical{background:var(--crit)}.sev.high{background:var(--high)}.sev.medium{background:var(--med)}.sev.low{background:var(--low)}.sev.info{background:var(--info)}
.finding{margin:28px 0}.footer{color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:16px;margin-top:40px}
@media print{body{background:#fff;color:#111}main{max-width:none;padding:0}.card{border-color:#ccc}pre{background:#f6f6f6;border-color:#ccc}h2{border-color:#ccc}}
</style></head>
<body><main>
<h1>${escapeHtml(engagement.name)} — Security assessment</h1>
<p class="meta">Generated ${escapeHtml(new Date().toISOString())}${engagement.client ? ` · Client: ${escapeHtml(engagement.client)}` : ""}${engagement.tester ? ` · Tester: ${escapeHtml(engagement.tester)}` : ""}</p>
<div class="summary">
  <div class="card"><b>${summary.critical}</b>Critical</div>
  <div class="card"><b>${summary.high}</b>High</div>
  <div class="card"><b>${summary.medium}</b>Medium</div>
  <div class="card"><b>${summary.low}</b>Low</div>
  <div class="card"><b>${summary.info}</b>Info</div>
</div>
<h2>Scope</h2>
<p class="meta">${escapeHtml(JSON.stringify(scope))}</p>
<h2>Findings</h2>
${rows || "<p>No findings recorded.</p>"}
<div class="footer">Only findings marked verified have a deterministic reproduction record. Unverified entries are leads. Absence of a finding is not proof of absence.</div>
</main></body></html>`
}

function severityToSarif(severity: Severity): "error" | "warning" | "note" {
  if (severity === "critical" || severity === "high") return "error"
  if (severity === "medium") return "warning"
  return "note"
}

export function renderSarif(findings: Finding[]): string {
  const rules = Array.from(new Set(findings.map((finding) => finding.category))).map((category) => ({
    id: category,
    name: category,
    shortDescription: { text: category },
  }))
  const results = findings.map((finding) => ({
    ruleId: finding.category,
    level: severityToSarif(finding.severity),
    message: {
      text: `${finding.title}\n\n${finding.description}\n\nImpact: ${finding.impact}${finding.remediation ? `\n\nRemediation: ${finding.remediation}` : ""}`,
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: redactText(finding.endpoint ?? finding.target) ?? finding.target },
          region: { startLine: 1 },
        },
      },
    ],
    properties: {
      id: finding.id,
      severity: finding.severity,
      status: finding.status,
      verified: finding.verified,
      confidence: finding.confidence,
      cwe: finding.cwe,
      cvss: finding.cvss,
    },
  }))
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "Grepleaks",
              informationUri: "https://grepleaks.com",
              rules,
            },
          },
          results,
        },
      ],
    },
    null,
    2,
  )
}

export async function generateReport(options: {
  workspace: string
  format?: ReportFormat
  path?: string
  title?: string
}): Promise<{ path: string; format: ReportFormat; total: number; counts: Record<Severity, number> }> {
  const store = await openStore(options.workspace)
  const findings = store.list({ limit: 500 }).filter(
    (finding) => finding.status !== "false_positive" && finding.status !== "suppressed",
  )
  const loadedScope = tryLoadScope(options.workspace)
  const scope = loadedScope.error
    ? { configured: true, error: loadedScope.error }
    : scopeSummary(loadedScope.loaded)
  const engagement = loadEngagement(options.workspace)
  if (options.title) engagement.name = options.title
  const format = options.format ?? "markdown"
  const content =
    format === "json"
      ? JSON.stringify({ engagement, scope, generatedAt: new Date().toISOString(), findings }, null, 2)
      : format === "sarif"
        ? renderSarif(findings)
        : format === "html"
          ? renderHtml(engagement, scope, findings)
          : renderMarkdown(engagement, scope, findings)
  const extension = format === "markdown" ? "md" : format === "html" ? "html" : format === "json" ? "json" : "sarif"
  const root = path.resolve(options.workspace)
  const target = options.path
    ? path.resolve(root, options.path)
    : path.join(root, ".grepleaks", "reports", `grepleaks-${nowStamp()}.${extension}`)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Report path must stay inside the engagement workspace")
  }
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  writeFileSync(target, content, { mode: 0o600 })
  return { path: target, format, total: findings.length, counts: counts(findings) }
}
