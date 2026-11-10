import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { json, workspace } from "./evidence-common"
import { matchScopeResolved, scopeSummary, tryLoadScope } from "../evidence/scope"

export const Parameters = Schema.Struct({
  target: Schema.optional(Schema.String).annotate({ description: "Host or URL to check against the scope" }),
})

export const ScopeCheckTool = Tool.define(
  "scope_check",
  Effect.gen(function* () {
    return {
      description: [
        "Check whether a target is in the configured engagement scope and show the scope summary.",
        "Call this before testing a new host. An out-of-scope target must not be tested.",
      ].join(" "),
      parameters: Parameters,
      execute: (params: typeof Parameters.Type, _ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<Record<string, any>>> =>
        Effect.gen(function* () {
          const dir = yield* workspace
          const { loaded, error } = tryLoadScope(dir)
          if (error) {
            return {
              title: params.target ? `DENIED · ${params.target}` : "Scope file invalid",
              metadata: { configured: true, allowed: params.target ? false : undefined, host: undefined },
              output: [
                `${params.target ? "DENIED: " : ""}${error}`,
                "Every target is refused until the scope file is fixed.",
              ].join("\n"),
            }
          }
          const summary = scopeSummary(loaded)
          const decision = params.target
            ? yield* Effect.promise(() => matchScopeResolved(loaded?.config, params.target!))
            : undefined
          return {
            title: decision ? `${decision.allowed ? "ALLOWED" : "DENIED"} · ${params.target}` : "Scope summary",
            metadata: {
              configured: Boolean(loaded),
              allowed: decision?.allowed,
              host: decision?.host,
            },
            output: [
              decision
                ? `${decision.allowed ? "ALLOWED" : "DENIED"}: ${decision.reason}`
                : loaded
                  ? "Scope is configured."
                  : "No scope file configured. Create .grepleaks/scope.json or pass --scope.",
              "",
              json({ summary, decision }),
            ].join("\n"),
          }
        }),
    }
  }),
)
