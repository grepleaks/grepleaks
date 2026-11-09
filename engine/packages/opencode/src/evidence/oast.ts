/**
 * Out-of-band collaborator (HTTP). Used to prove blind SSRF/RCE/XXE-style
 * callbacks. DNS callbacks are not implemented yet; HTTP is the P0 scope.
 */

import { createServer, type Server } from "node:http"
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import path from "node:path"

export interface OastHit {
  token: string
  at: string
  method: string
  path: string
  remote?: string
  headers?: Record<string, string | string[] | undefined>
  body?: string
}

interface Collaborator {
  token: string
  workspace: string
  url: string
  localUrl: string
  public: boolean
  createdAt: string
  hits: OastHit[]
}

interface Runtime {
  server?: Server
  port?: number
  collaborators: Map<string, Collaborator>
}

const runtime: Runtime = { collaborators: new Map() }

function hitsFile(workspace: string): string {
  return path.join(workspace, ".grepleaks", "oast", "hits.jsonl")
}

function record(workspace: string, hit: OastHit): void {
  const file = hitsFile(workspace)
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  appendFileSync(file, `${JSON.stringify(hit)}\n`, { mode: 0o600 })
}

function ensureServer(workspace: string): Promise<number> {
  if (runtime.server && runtime.port) return Promise.resolve(runtime.port)
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      const segments = url.pathname.split("/").filter(Boolean)
      const token = segments[0] ?? ""
      const collaborator = runtime.collaborators.get(token)
      const chunks: Buffer[] = []
      request.on("data", (chunk) => {
        if (chunks.reduce((total, item) => total + item.length, 0) < 64_000) chunks.push(Buffer.from(chunk))
      })
      request.on("end", () => {
        const hit: OastHit = {
          token,
          at: new Date().toISOString(),
          method: request.method ?? "GET",
          path: url.pathname + url.search,
          remote: request.socket.remoteAddress,
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8").slice(0, 8000),
        }
        if (collaborator) {
          collaborator.hits.push(hit)
          record(collaborator.workspace, hit)
        } else {
          record(workspace, hit)
        }
        response.writeHead(200, { "content-type": "text/plain" })
        response.end("ok")
      })
    })
    server.on("error", reject)
    server.listen(0, "0.0.0.0", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine collaborator port"))
        return
      }
      runtime.server = server
      runtime.port = address.port
      server.unref?.()
      resolve(address.port)
    })
  })
}

export async function openCollaborator(
  workspace: string,
  options: { publicBase?: string } = {},
): Promise<Collaborator> {
  const port = await ensureServer(workspace)
  const token = randomBytes(8).toString("hex")
  const publicBase = options.publicBase ?? process.env.GREPLEAKS_OAST_URL
  const localUrl = `http://127.0.0.1:${port}/${token}`
  const url = publicBase
    ? publicBase.includes("{token}")
      ? publicBase.replace("{token}", token)
      : `${publicBase.replace(/\/+$/, "")}/${token}`
    : localUrl
  const collaborator: Collaborator = {
    token,
    workspace,
    url,
    localUrl,
    public: Boolean(publicBase),
    createdAt: new Date().toISOString(),
    hits: [],
  }
  runtime.collaborators.set(token, collaborator)
  const meta = path.join(workspace, ".grepleaks", "oast", `${token}.json`)
  mkdirSync(path.dirname(meta), { recursive: true, mode: 0o700 })
  appendFileSync(meta, JSON.stringify({ token, url, localUrl, public: collaborator.public, createdAt: collaborator.createdAt }), {
    mode: 0o600,
  })
  return collaborator
}

export function pollCollaborator(workspace: string, token: string): OastHit[] {
  const memory = runtime.collaborators.get(token)?.hits ?? []
  const persisted: OastHit[] = []
  try {
    const content = readFileSync(hitsFile(workspace), "utf8")
    for (const line of content.split("\n")) {
      if (!line.trim()) continue
      try {
        const hit = JSON.parse(line) as OastHit
        if (hit.token === token) persisted.push(hit)
      } catch {
        // Ignore a partial trailing line.
      }
    }
  } catch {
    // No hits yet.
  }
  const seen = new Set<string>()
  return [...persisted, ...memory].filter((hit) => {
    const key = `${hit.at}|${hit.method}|${hit.path}|${hit.body ?? ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function closeCollaborator(token: string): boolean {
  return runtime.collaborators.delete(token)
}

export function collaboratorUrl(token: string): string | undefined {
  return runtime.collaborators.get(token)?.url
}
