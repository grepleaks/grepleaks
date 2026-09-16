import { tool, type Plugin } from "@opencode-ai/plugin"

export const GrepleaksHost: Plugin = async () => {
  const token = process.env.GREPLEAKS_HOST_TOKEN
  if (!token) return {}
  const call = async (route: string, data: unknown, abort: AbortSignal) => {
    const response = await fetch(`http://127.0.0.1:8788${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
      signal: AbortSignal.any([abort, AbortSignal.timeout(130_000)]),
      redirect: "error",
    })
    if (!response.ok)
      throw new Error(`Host bridge returned ${response.status}; check companion connection before retrying`)
    return JSON.stringify(await response.json())
  }
  return {
    tool: {
      host_info: tool({
        description:
          "Identify the real host OS, workspace and shared artifact exchange. For host files/apps, use host_stage then analyze the copy with container tools.",
        args: {},
        execute: (_args, context) => call("/info", {}, context.abort),
      }),
      host_stage: tool({
        description:
          "Copy a selected host file or application bundle (including .app directories) into the shared Docker analysis area after approval. Preserves the original and symlinks without following them. Use this before static analysis of host apps; then use bash/read and Linux tools on the returned container_path. This does not make macOS or Windows binaries executable on Linux.",
        args: {
          path: tool.schema.string().min(1).max(4096),
        },
        async execute(args, context) {
          const info = JSON.parse(await call("/info", {}, context.abort))
          if (
            !info.connected ||
            !["python", "stage_script", "exchange", "workspace"].every((key) => typeof info.host?.[key] === "string")
          )
            throw new Error("Artifact transfer is unavailable; restart using the updated Grepleaks launcher")
          await context.ask({
            permission: "host_stage",
            patterns: [args.path],
            always: [],
            metadata: {
              source: args.path,
              destination: info.host.exchange,
              operation: "Copy for container analysis; preserve original",
            },
          })
          return call(
            "/request",
            {
              argv: [info.host.python, info.host.stage_script, args.path, info.host.exchange],
              cwd: info.host.workspace,
              timeout: 120,
            },
            context.abort,
          )
        },
      }),
      host_run: tool({
        description:
          "Run a command on the REAL HOST after user approval. Use host_info first. Commands execute with the user's privileges, outside Docker. Prefer container tools unless host access is needed. Pass argv directly; shell syntax needs an explicit platform-appropriate shell. Never install or remove host tools as container cleanup.",
        args: {
          argv: tool.schema.array(tool.schema.string().max(4096)).min(1).max(128),
          cwd: tool.schema.string().max(4096).optional(),
          timeout: tool.schema.number().min(1).max(120).default(60),
        },
        async execute(args, context) {
          const info = JSON.parse(await call("/info", {}, context.abort))
          if (!info.connected || typeof info.host?.workspace !== "string")
            throw new Error("Host companion is not connected")
          const command = { ...args, cwd: args.cwd ?? info.host.workspace }
          await context.ask({
            permission: "host_run",
            patterns: [JSON.stringify(command)],
            always: [],
            metadata: {
              location: "HOST — outside Docker",
              os: info.host.os,
              argv: command.argv,
              cwd: command.cwd,
              timeout: command.timeout,
            },
          })
          return call("/request", command, context.abort)
        },
      }),
    },
  }
}
