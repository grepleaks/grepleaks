import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { json, workspace } from "./evidence-common"
import { openStore } from "../evidence/store"

export const Parameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Finding id or unique prefix" }),
})

export const GetFindingTool = Tool.define(
  "get_finding",
  Effect.gen(function* () {
    return {
      description: "Read one stored finding by id or unique id prefix, including evidence and verification.",
      parameters: Parameters,
      execute: (params: typeof Parameters.Type, _ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<Record<string, any>>> =>
        Effect.gen(function* () {
          const dir = yield* workspace
          const finding = yield* Effect.promise(async () => (await openStore(dir)).get(params.id))
          if (!finding) {
            return {
              title: "Not found",
              metadata: { found: false },
              output: `No finding matched ${params.id}.`,
            }
          }
          return {
            title: finding.title,
            metadata: { id: finding.id, severity: finding.severity, status: finding.status, verified: finding.verified },
            output: json(finding),
          }
        }),
    }
  }),
)
