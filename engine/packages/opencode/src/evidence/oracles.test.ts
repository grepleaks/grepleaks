import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createServer, type Server } from "node:http"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { verifyFinding } from "./oracles"
import { openCollaborator } from "./oast"
import type { Finding } from "./types"

let server: Server
let port = 0
let workspace = ""

function finding(overrides: Partial<Finding> & Pick<Finding, "title" | "category" | "target">): Finding {
  return {
    id: "fnd_test",
    severity: "high",
    confidence: 0.7,
    description: "test",
    impact: "test",
    evidence: {},
    status: "candidate",
    verified: false,
    identities: [],
    tags: [],
    dedupeKey: "test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Finding
}

beforeAll(async () => {
  workspace = mkdtempSync(path.join(tmpdir(), "grepleaks-oracles-"))
  mkdirSync(path.join(workspace, ".grepleaks"), { recursive: true })
  writeFileSync(
    path.join(workspace, ".grepleaks", "scope.json"),
    JSON.stringify({ in_scope: ["127.0.0.1"], out_of_scope: [] }),
  )
  writeFileSync(
    path.join(workspace, ".grepleaks", "auth.json"),
    JSON.stringify({
      identities: [
        { label: "owner", role: "user", auth: { type: "bearer", token: "owner" } },
        { label: "other", role: "user", auth: { type: "bearer", token: "other" } },
      ],
    }),
  )

  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`)
    const q = url.searchParams.get("q") ?? ""
    if (url.pathname === "/sqli") {
      if (q.includes("'1'='2")) {
        response.writeHead(500, { "content-type": "text/plain" })
        response.end("SQL syntax error near '1'='2'")
        return
      }
      response.writeHead(200, { "content-type": "text/plain" })
      response.end("A".repeat(q.includes("'1'='1") ? 120 : 60))
      return
    }
    if (url.pathname === "/xss") {
      response.writeHead(200, { "content-type": "text/html" })
      response.end(`<html><body>${q}</body></html>`)
      return
    }
    if (url.pathname === "/traversal") {
      const file = url.searchParams.get("file") ?? ""
      response.writeHead(200, { "content-type": "text/plain" })
      response.end(file.includes("etc/passwd") ? "root:x:0:0:root:/root:/bin/bash\n" : "not found")
      return
    }
    if (url.pathname === "/generic") {
      response.writeHead(200, { "content-type": "text/plain" })
      response.end("marker")
      return
    }
    if (url.pathname === "/fetch") {
      const target = url.searchParams.get("url") ?? ""
      void fetch(target)
        .then(() => {
          response.writeHead(200, { "content-type": "text/plain" })
          response.end("fetched")
        })
        .catch(() => {
          response.writeHead(200, { "content-type": "text/plain" })
          response.end("fetch failed")
        })
      return
    }
    if (url.pathname === "/rce") {
      const cmd = url.searchParams.get("cmd") ?? ""
      const marker = cmd.includes("echo ") ? cmd.split("echo ")[1]?.trim() : undefined
      response.writeHead(200, { "content-type": "text/plain" })
      response.end(marker ?? "no output")
      return
    }
    if (url.pathname === "/idor") {
      const auth = request.headers.authorization ?? ""
      if (auth === "Bearer owner") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ account: "owner", secret: "x".repeat(200) }))
      } else {
        response.writeHead(403, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: "forbidden" }))
      }
      return
    }
    if (url.pathname === "/idor-vuln") {
      // No access control: every identity receives the owner's record.
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ account: "owner", email: "owner@example.com", secret: "x".repeat(200) }))
      return
    }
    if (url.pathname === "/idor-own-data") {
      // Access control works: each identity sees only its own record (2xx, different body).
      const auth = request.headers.authorization ?? ""
      const who = auth === "Bearer owner" ? "owner" : "other"
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ account: who, email: `${who}@example.com`, notes: who.repeat(40) }))
      return
    }
    response.writeHead(404)
    response.end("not found")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  port = typeof address === "object" && address ? address.port : 0
})

afterAll(() => {
  server?.close()
})

describe("verification oracles", () => {
  it("reproduces boolean SQL injection", async () => {
    const result = await verifyFinding(
      finding({
        title: "SQL injection",
        category: "sqli",
        target: `http://127.0.0.1:${port}/sqli`,
        endpoint: `http://127.0.0.1:${port}/sqli`,
        parameter: "q",
      }),
      { workspace },
    )
    expect(result.status).toBe("reproduced")
    expect(result.assertions.some((item) => item.kind === "boolean_length" && item.passed)).toBe(true)
  })

  it("reproduces reflected XSS in an HTML context", async () => {
    const result = await verifyFinding(
      finding({
        title: "Reflected XSS",
        category: "xss",
        target: `http://127.0.0.1:${port}/xss`,
        endpoint: `http://127.0.0.1:${port}/xss`,
        parameter: "q",
      }),
      { workspace },
    )
    expect(result.status).toBe("reproduced")
  })

  it("reproduces path traversal", async () => {
    const result = await verifyFinding(
      finding({
        title: "Path traversal",
        category: "path-traversal",
        target: `http://127.0.0.1:${port}/traversal`,
        endpoint: `http://127.0.0.1:${port}/traversal`,
        parameter: "file",
      }),
      { workspace },
    )
    expect(result.status).toBe("reproduced")
  })

  it("replays declared generic expectations", async () => {
    const result = await verifyFinding(
      finding({
        title: "Generic replay",
        category: "generic",
        target: `http://127.0.0.1:${port}/generic`,
        endpoint: `http://127.0.0.1:${port}/generic`,
        evidence: { expect: { status: 200, contains: "marker" } },
      }),
      { workspace },
    )
    expect(result.status).toBe("reproduced")
  })

  it("reproduces command injection from output", async () => {
    const result = await verifyFinding(
      finding({
        title: "Command injection",
        category: "rce",
        target: `http://127.0.0.1:${port}/rce`,
        endpoint: `http://127.0.0.1:${port}/rce`,
        parameter: "cmd",
      }),
      { workspace },
    )
    expect(result.status).toBe("reproduced")
  })

  it("reproduces SSRF with a collaborator callback", async () => {
    const collaborator = await openCollaborator(workspace)
    const result = await verifyFinding(
      finding({
        title: "SSRF",
        category: "ssrf",
        target: `http://127.0.0.1:${port}/fetch`,
        endpoint: `http://127.0.0.1:${port}/fetch`,
        parameter: "url",
      }),
      { workspace, oastUrl: collaborator.url, oastToken: collaborator.token },
    )
    expect(result.status).toBe("reproduced")
    expect(result.oastConfirmed).toBe(true)
  })

  it("reproduces cross-identity IDOR when the non-owner receives the owner's resource", async () => {
    const result = await verifyFinding(
      finding({
        title: "IDOR",
        category: "idor",
        target: `http://127.0.0.1:${port}/idor-vuln`,
        endpoint: `http://127.0.0.1:${port}/idor-vuln`,
        identities: ["owner", "other"],
      }),
      { workspace },
    )
    expect(result.status).toBe("reproduced")
  })

  it("reproduces cross-identity IDOR via an owner-specific marker", async () => {
    const result = await verifyFinding(
      finding({
        title: "IDOR",
        category: "idor",
        target: `http://127.0.0.1:${port}/idor-vuln`,
        endpoint: `http://127.0.0.1:${port}/idor-vuln`,
        identities: ["owner", "other"],
        evidence: { expect: { contains: "owner@example.com" } },
      }),
      { workspace },
    )
    expect(result.status).toBe("reproduced")
  })

  it("does not reproduce IDOR when the non-owner is denied", async () => {
    const result = await verifyFinding(
      finding({
        title: "IDOR",
        category: "idor",
        target: `http://127.0.0.1:${port}/idor`,
        endpoint: `http://127.0.0.1:${port}/idor`,
        identities: ["owner", "other"],
      }),
      { workspace },
    )
    expect(result.status).toBe("not_reproduced")
  })

  it("does not reproduce IDOR when the non-owner only sees its own data", async () => {
    const result = await verifyFinding(
      finding({
        title: "IDOR",
        category: "idor",
        target: `http://127.0.0.1:${port}/idor-own-data`,
        endpoint: `http://127.0.0.1:${port}/idor-own-data`,
        identities: ["owner", "other"],
      }),
      { workspace },
    )
    expect(result.status).toBe("not_reproduced")
  })

  it("does not reproduce IDOR when the owner marker is absent from the non-owner response", async () => {
    const result = await verifyFinding(
      finding({
        title: "IDOR",
        category: "idor",
        target: `http://127.0.0.1:${port}/idor-own-data`,
        endpoint: `http://127.0.0.1:${port}/idor-own-data`,
        identities: ["owner", "other"],
        evidence: { expect: { contains: "owner@example.com" } },
      }),
      { workspace },
    )
    expect(result.status).toBe("not_reproduced")
  })

  it("refuses an out-of-scope target", async () => {
    const result = await verifyFinding(
      finding({
        title: "Out of scope",
        category: "generic",
        target: "https://not-in-scope.example.com",
        endpoint: "https://not-in-scope.example.com",
      }),
      { workspace },
    )
    expect(result.status).toBe("error")
    expect(result.summary).toContain("Scope refused")
  })
})
