import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { json, workspace } from "./evidence-common"
import { openStore } from "../evidence/store"

export const Parameters = Schema.Struct({
  status: Schema.optional(Schema.String).annotate({ description: "Filter by status" }),
  severity: Schema.optional(Schema.String).annotate({ description: "Filter by severity" }),
  target: Schema.optional(Schema.String).annotate({ description: "Filter by target host or URL fragment" }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Maximum findings to return (default 100)" }),
})

export const ListFindingsTool = Tool.define(
  "list_findings",
  Effect.gen(function* () {
    return {
      description: "List stored security findings with an optional status, severity, or target filter.",
      parameters: Parameters,
      execute: (params: typeof Parameters.Type, _ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<Record<string, any>>> =>
        Effect.gen(function* () {
          const dir = yield* workspace
          const result = yield* Effect.promise(async () => {
            const store = await openStore(dir)
            const findings = store.list({
              status: params.status,
              severity: params.severity,
              target: params.target,
              limit: params.limit,
            })
            return { findings, summary: store.summary() }
          })
          const rows = result.findings.map((finding) => ({
            id: finding.id,
            severity: finding.severity,
            status: finding.status,
            verified: finding.verified,
            category: finding.category,
            title: finding.title,
            target: finding.target,
            endpoint: finding.endpoint,
          }))
          return {
            title: `${result.summary.total} finding(s)`,
            metadata: { total: result.summary.total, returned: rows.length },
            output:
              rows.length === 0
                ? "No findings recorded for this engagement."
                : [
                    `Findings: ${result.summary.total} total, ${result.summary.verified} verified.`,
                    `Severity: critical=${result.summary.bySeverity.critical} high=${result.summary.bySeverity.high} medium=${result.summary.bySeverity.medium} low=${result.summary.bySeverity.low} info=${result.summary.bySeverity.info}`,
                    "",
                    json(rows),
                  ].join("\n"),
          }
        }),
    }
  }),
)
