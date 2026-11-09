import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { json, workspace } from "./evidence-common"
import { generateReport } from "../evidence/report"

export const Parameters = Schema.Struct({
  format: Schema.optional(Schema.String).annotate({ description: "markdown | html | json | sarif (default markdown)" }),
  path: Schema.optional(Schema.String).annotate({ description: "Output path relative to the engagement workspace" }),
  title: Schema.optional(Schema.String).annotate({ description: "Override the engagement title" }),
})

export const GenerateReportTool = Tool.define(
  "generate_report",
  Effect.gen(function* () {
    return {
      description: [
        "Render the stored findings into a deterministic report.",
        "Formats: markdown (default), html (print-ready), json, sarif.",
        "The report includes scope, executive summary, findings, evidence and verification records.",
      ].join(" "),
      parameters: Parameters,
      execute: (params: typeof Parameters.Type, _ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<Record<string, any>>> =>
        Effect.gen(function* () {
          const dir = yield* workspace
          const format = (params.format ?? "markdown").toLowerCase()
          if (!["markdown", "html", "json", "sarif"].includes(format)) {
            return {
              title: "Invalid format",
              metadata: { ok: false },
              output: "format must be markdown, html, json or sarif.",
            }
          }
          const result = yield* Effect.promise(() =>
            generateReport({
              workspace: dir,
              format: format as any,
              path: params.path,
              title: params.title,
            }),
          )
          return {
            title: `Report · ${result.total} finding(s)`,
            metadata: { path: result.path, format: result.format, total: result.total, counts: result.counts },
            output: [
              `Wrote ${result.format} report: ${result.path}`,
              `Findings: ${result.total}.`,
              json({ counts: result.counts }),
            ].join("\n"),
          }
        }),
    }
  }),
)
