import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { json, workspace } from "./evidence-common"
import { closeCollaborator, openCollaborator, pollCollaborator } from "../evidence/oast"

export const Parameters = Schema.Struct({
  action: Schema.String.annotate({ description: "open | poll | close" }),
  token: Schema.optional(Schema.String).annotate({ description: "Collaborator token for poll/close" }),
  public_base: Schema.optional(Schema.String).annotate({
    description: "Public base URL reachable by the target (e.g. https://oob.example.com). Defaults to GREPLEAKS_OAST_URL or local.",
  }),
})

export const CollaboratorTool = Tool.define(
  "collaborator",
  Effect.gen(function* () {
    return {
      description: [
        "Open, poll or close an out-of-band HTTP collaborator for blind SSRF/RCE/XXE-style proofs.",
        "open returns a unique URL. Inject it into the target, then poll for hits.",
        "The local URL is only reachable by the target if it can route to this container; set public_base or GREPLEAKS_OAST_URL for an externally reachable endpoint.",
      ].join(" "),
      parameters: Parameters,
      execute: (params: typeof Parameters.Type, _ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<Record<string, any>>> =>
        Effect.gen(function* () {
          const dir = yield* workspace
          const action = params.action.toLowerCase()
          const result = yield* Effect.promise(async () => {
            if (action === "open") {
              return { ok: true as const, collaborator: await openCollaborator(dir, { publicBase: params.public_base }) }
            }
            if (action === "poll") {
              if (!params.token) return { ok: false as const, error: "token is required for poll" }
              const hits = pollCollaborator(dir, params.token)
              return { ok: true as const, token: params.token, hits }
            }
            if (action === "close") {
              if (!params.token) return { ok: false as const, error: "token is required for close" }
              return { ok: true as const, closed: closeCollaborator(params.token) }
            }
            return { ok: false as const, error: "action must be open, poll or close" }
          })
          if (!result.ok) {
            return { title: "collaborator error", metadata: { ok: false }, output: result.error }
          }
          if ("collaborator" in result && result.collaborator) {
            return {
              title: `Collaborator ${result.collaborator.token}`,
              metadata: {
                token: result.collaborator.token,
                url: result.collaborator.url,
                localUrl: result.collaborator.localUrl,
                public: result.collaborator.public,
              },
              output: [
                `URL: ${result.collaborator.url}`,
                result.collaborator.public
                  ? "This URL is publicly routable."
                  : "This URL is local to the container. The target must be able to reach it (host bridge or public tunnel).",
                `Token: ${result.collaborator.token}`,
                "Inject the URL into the target, then call collaborator with action=poll.",
              ].join("\n"),
            }
          }
          if ("hits" in result) {
            const hits = result.hits ?? []
            return {
              title: `${hits.length} callback(s)`,
              metadata: { token: result.token, hits: hits.length },
              output: hits.length ? json(hits) : "No callbacks recorded yet.",
            }
          }
          return { title: "Collaborator closed", metadata: { closed: true }, output: "Collaborator closed." }
        }),
    }
  }),
)
