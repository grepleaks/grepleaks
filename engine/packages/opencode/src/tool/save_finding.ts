import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { json, parseJsonObject, splitList, workspace } from "./evidence-common"
import { openStore } from "../evidence/store"
import { triage } from "../evidence/triage"
import { asSeverity } from "../evidence/types"
import { redactHeaders, redactText } from "../evidence/redact"
import type { FindingEvidence } from "../evidence/types"

export const Parameters = Schema.Struct({
  title: Schema.String.annotate({ description: "Short, specific finding title" }),
  category: Schema.String.annotate({ description: "Vulnerability class, e.g. sqli, xss, ssrf, idor, rce, path-traversal" }),
  severity: Schema.String.annotate({ description: "critical | high | medium | low | info" }),
  target: Schema.String.annotate({ description: "Target host or URL" }),
  description: Schema.String.annotate({ description: "What was observed and why it is a vulnerability" }),
  impact: Schema.String.annotate({ description: "Concrete impact if exploited" }),
  remediation: Schema.optional(Schema.String).annotate({ description: "Recommended fix" }),
  endpoint: Schema.optional(Schema.String).annotate({ description: "Vulnerable URL or endpoint" }),
  parameter: Schema.optional(Schema.String).annotate({ description: "Vulnerable parameter" }),
  method: Schema.optional(Schema.String).annotate({ description: "HTTP method" }),
  cwe: Schema.optional(Schema.String).annotate({ description: "CWE identifier, e.g. CWE-89" }),
  cvss: Schema.optional(Schema.Number).annotate({ description: "CVSS score 0-10" }),
  cvss_vector: Schema.optional(Schema.String).annotate({ description: "CVSS vector string" }),
  confidence: Schema.optional(Schema.Number).annotate({ description: "0-1 confidence" }),
  payload: Schema.optional(Schema.String).annotate({ description: "Payload that triggered the issue" }),
  request_json: Schema.optional(Schema.String).annotate({
    description: 'JSON request object: {"url":"...","method":"GET","headers":{},"body":"..."}',
  }),
  response_json: Schema.optional(Schema.String).annotate({
    description: 'JSON response object: {"status":200,"headers":{},"body":"..."}',
  }),
  expect_json: Schema.optional(Schema.String).annotate({
    description: 'JSON replay expectations: {"status":200,"contains":"marker","notContains":"error","maxLength":1000}',
  }),
  evidence_json: Schema.optional(Schema.String).annotate({ description: "Additional evidence object" }),
  tags: Schema.optional(Schema.String).annotate({ description: "Comma-separated tags" }),
  identities: Schema.optional(Schema.String).annotate({ description: "Comma-separated auth profile labels used" }),
  source: Schema.optional(Schema.String).annotate({ description: "Tool or agent that produced the lead" }),
  status: Schema.optional(Schema.String).annotate({ description: "candidate | confirmed | reported | fixed | false_positive | suppressed" }),
})

export const SaveFindingTool = Tool.define(
  "save_finding",
  Effect.gen(function* () {
    return {
      description: [
        "Save a structured security finding to the engagement store.",
        "Use this after you have observed something concrete. Include request/response evidence when possible.",
        "The finding is saved as a candidate; run verify_finding to reproduce it before treating it as confirmed.",
      ].join(" "),
      parameters: Parameters,
      execute: (params: typeof Parameters.Type, _ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<Record<string, any>>> =>
        Effect.gen(function* () {
          const dir = yield* workspace
          const result = yield* Effect.promise(async () => {
            const request = parseJsonObject(params.request_json, "request_json")
            if (!request.ok) return { ok: false as const, error: request.error }
            const response = parseJsonObject(params.response_json, "response_json")
            if (!response.ok) return { ok: false as const, error: response.error }
            const expect = parseJsonObject(params.expect_json, "expect_json")
            if (!expect.ok) return { ok: false as const, error: expect.error }
            const extra = parseJsonObject(params.evidence_json, "evidence_json")
            if (!extra.ok) return { ok: false as const, error: extra.error }
            if (!params.title.trim() || !params.description.trim() || !params.impact.trim() || !params.target.trim()) {
              return { ok: false as const, error: "title, target, description and impact are required" }
            }
            const statuses = ["candidate", "confirmed", "reported", "fixed", "false_positive", "suppressed"]
            const requestedStatus = statuses.includes(params.status ?? "") ? (params.status as string) : "candidate"
            const status = requestedStatus === "confirmed" ? "candidate" : requestedStatus
            const statusWarning =
              requestedStatus === "confirmed"
                ? ["confirmed is reserved for verify_finding; saved as candidate"]
                : []
            const cvss = params.cvss === undefined ? undefined : Math.max(0, Math.min(10, params.cvss))
            const confidence = params.confidence === undefined ? undefined : Math.max(0, Math.min(1, params.confidence))

            const evidence: FindingEvidence = {
              ...(extra.value && typeof extra.value === "object" ? extra.value : {}),
              payload: params.payload ?? extra.value?.payload,
              expect: expect.value ?? extra.value?.expect,
            }
            if (request.value) {
              const requestUrl = request.value.url ?? params.endpoint ?? params.target
              evidence.request = {
                url: requestUrl,
                method: request.value.method ?? params.method ?? "GET",
                requestHeaders: redactHeaders(request.value.headers ?? request.value.requestHeaders),
                requestBody: redactText(request.value.body ?? request.value.requestBody),
              }
            }
            if (response.value) {
              evidence.response = {
                url: evidence.request?.url ?? params.endpoint ?? params.target,
                status: response.value.status,
                responseHeaders: redactHeaders(response.value.headers ?? response.value.responseHeaders),
                responseBody: redactText(response.value.body ?? response.value.responseBody),
              }
            }

            const store = await openStore(dir)
            const input = {
              title: params.title,
              category: params.category,
              severity: asSeverity(params.severity),
              target: params.target,
              description: params.description,
              impact: params.impact,
              remediation: params.remediation,
              endpoint: params.endpoint,
              parameter: params.parameter,
              method: params.method,
              cwe: params.cwe,
              cvss,
              cvssVector: params.cvss_vector,
              confidence,
              evidence,
              identities: splitList(params.identities),
              tags: splitList(params.tags),
              source: params.source,
              status: status as any,
            }
            const redactedHeaders = Object.entries(evidence.request?.requestHeaders ?? {})
              .filter(([, value]) => value.includes("[redacted]"))
              .map(([key]) => key)
            const redactionWarning = redactedHeaders.length
              ? [
                  `credential headers redacted (${redactedHeaders.join(", ")}); replays drop them and use the auth profile, so pass identities/identity if the request needs a specific login`,
                ]
              : []
            const guards = triage(input)
            const saved = store.save(input)
            return {
              ok: true as const,
              id: saved.finding.id,
              deduped: saved.deduped,
              status: saved.finding.status,
              severity: saved.finding.severity,
              completeness: guards.completeness,
              warnings: [...guards.warnings, ...statusWarning, ...redactionWarning],
              holdingItWrong: guards.holdingItWrong,
              summary: store.summary(),
            }
          })
          if (!result.ok) {
            return {
              title: "save_finding failed",
              metadata: { ok: false },
              output: json(result),
            }
          }
          return {
            title: `${result.deduped ? "Merged" : "Saved"} ${result.id}`,
            metadata: {
              id: result.id,
              deduped: result.deduped,
              severity: result.severity,
              completeness: result.completeness,
              warnings: result.warnings.length,
            },
            output: [
              `${result.deduped ? "Merged into existing" : "Saved"} finding ${result.id} (${result.severity}).`,
              `Evidence completeness: ${Math.round(result.completeness * 100)}%.`,
              result.warnings.length ? "Triage warnings:\n" + result.warnings.map((item) => `- ${item}`).join("\n") : "No triage warnings.",
              "",
              json({ id: result.id, deduped: result.deduped, summary: result.summary, warnings: result.warnings }),
            ].join("\n"),
          }
        }),
    }
  }),
)
