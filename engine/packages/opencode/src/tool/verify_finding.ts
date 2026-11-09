import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { json, workspace } from "./evidence-common"
import { openStore } from "../evidence/store"
import { verifyFinding, verificationOutput } from "../evidence/oracles"
import { openCollaborator } from "../evidence/oast"

export const Parameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Finding id or unique prefix" }),
  category: Schema.optional(Schema.String).annotate({ description: "Override the oracle category" }),
  payload: Schema.optional(Schema.String).annotate({ description: "Override the payload" }),
  identity: Schema.optional(Schema.String).annotate({ description: "Auth profile label or role to use" }),
  oast_url: Schema.optional(Schema.String).annotate({ description: "Collaborator URL from the collaborator tool" }),
  oast_token: Schema.optional(Schema.String).annotate({ description: "Collaborator token from the collaborator tool" }),
  timeout_ms: Schema.optional(Schema.Number).annotate({ description: "Per-request timeout in milliseconds" }),
})

export const VerifyFindingTool = Tool.define(
  "verify_finding",
  Effect.gen(function* () {
    return {
      description: [
        "Reproduce a stored finding with a deterministic category oracle.",
        "Categories: sqli, xss, ssrf, rce, path-traversal, idor, or generic replay.",
        "This sends traffic to the target and is scope-checked. A reproduced verdict updates the finding to confirmed.",
      ].join(" "),
      parameters: Parameters,
      execute: (params: typeof Parameters.Type, ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<Record<string, any>>> =>
        Effect.gen(function* () {
          const dir = yield* workspace
          const store = yield* Effect.promise(() => openStore(dir))
          const finding = store.get(params.id)
          if (!finding) {
            return { title: "Not found", metadata: { found: false }, output: `No finding matched ${params.id}.` }
          }
          yield* ctx.ask({
            permission: "verify_finding",
            patterns: [finding.target],
            always: [],
            metadata: { finding: finding.id, target: finding.target, category: params.category ?? finding.category },
          })

          const result = yield* Effect.promise(async () => {
            let oastUrl = params.oast_url
            let oastToken = params.oast_token
            const category = (params.category ?? finding.category).toLowerCase()
            if (!oastUrl && /ssrf|rce|command/.test(category)) {
              const collaborator = await openCollaborator(dir)
              oastUrl = collaborator.url
              oastToken = collaborator.token
            }
            const verification = await verifyFinding(finding, {
              workspace: dir,
              category: params.category,
              payload: params.payload,
              identity: params.identity,
              oastUrl,
              oastToken,
              timeoutMs: params.timeout_ms,
            })
            const updated = store.recordVerification(finding.id, verification)
            return { verification, updated }
          })

          return {
            title: `${result.verification.status} · ${finding.id}`,
            metadata: {
              id: finding.id,
              status: result.verification.status,
              method: result.verification.method,
              verified: result.verification.status === "reproduced",
            },
            output: [
              verificationOutput(result.verification),
              "",
              `Finding status: ${result.updated?.status ?? "unknown"}${result.updated?.verified ? " (verified)" : ""}`,
            ].join("\n"),
          }
        }),
    }
  }),
)
