import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { json, workspace } from "./evidence-common"
import { authStatus, loadAuth } from "../evidence/auth"

export const Parameters = Schema.Struct({})

export const AuthStatusTool = Tool.define(
  "auth_status",
  Effect.gen(function* () {
    return {
      description: "Show the configured target authentication profiles without revealing secrets.",
      parameters: Parameters,
      execute: (_params: typeof Parameters.Type, _ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<Record<string, any>>> =>
        Effect.gen(function* () {
          const dir = yield* workspace
          const loaded = loadAuth(dir)
          return {
            title: `${loaded.profiles.length} auth profile(s)`,
            metadata: { profiles: loaded.profiles.length, path: loaded.path },
            output: json({ ...authStatus(loaded.profiles), path: loaded.path }),
          }
        }),
    }
  }),
)
