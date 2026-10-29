import path from "path"
import { realpath } from "node:fs/promises"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import type * as Tool from "./tool"
import { FSUtil } from "@opencode-ai/core/fs-util"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

async function canonical(value: string): Promise<string> {
  try {
    return await realpath(value)
  } catch {
    try {
      return path.join(await realpath(path.dirname(value)), path.basename(value))
    } catch {
      return value
    }
  }
}

export const assertExternalDirectoryEffect = Effect.fn("Tool.assertExternalDirectory")(function* (
  ctx: Tool.Context,
  target?: string,
  options?: Options,
) {
  if (!target) return false

  if (options?.bypass) return false

  const ins = yield* InstanceState.context
  const lexical = process.platform === "win32" ? FSUtil.normalizePath(target) : target
  // Resolve symlinks before deciding whether the target is external. The
  // lexical path is not enough: a link inside the workspace can point at a
  // credential store, and a staged artifact can carry such a link.
  const full = yield* Effect.promise(() => canonical(lexical))
  const directory = yield* Effect.promise(() => canonical(ins.directory))
  const worktree = ins.worktree === "/" ? "/" : yield* Effect.promise(() => canonical(ins.worktree))
  if (FSUtil.contains(directory, full) || (worktree !== "/" && FSUtil.contains(worktree, full))) return false

  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? full : path.dirname(full)
  const glob =
    process.platform === "win32"
      ? FSUtil.normalizePathPattern(path.join(dir, "*"))
      : path.join(dir, "*").replaceAll("\\", "/")

  yield* ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: full,
      parentDir: dir,
    },
  })
  return true
})
