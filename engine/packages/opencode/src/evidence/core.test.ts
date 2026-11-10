import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createServer, type Server } from "node:http"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { openStore } from "./store"
import { parseScope, matchScope, matchScopeResolved, loadScope, tryLoadScope, ScopeError } from "./scope"
import { contextFor, httpRequest } from "./http"
import { evidenceCompleteness, holdingItWrong, isDisclosureWorthy, triage } from "./triage"

function workspace(): string {
  return mkdtempSync(path.join(tmpdir(), "grepleaks-evidence-"))
}

describe("findings store", () => {
  it("saves, reads, dedupes and summarizes findings", async () => {
    const dir = workspace()
    const store = await openStore(dir)
    const first = store.save({
      title: "SQL injection in login",
      category: "sqli",
      severity: "high",
      target: "https://app.example.com",
      endpoint: "https://app.example.com/login",
      parameter: "username",
      description: "The username parameter is concatenated into a SQL query.",
      impact: "Authentication bypass and data exfiltration.",
      evidence: { payload: "' OR 1=1 --" },
    })
    expect(first.deduped).toBe(false)
    expect(first.finding.id.startsWith("fnd_")).toBe(true)
    expect(store.get(first.finding.id)?.title).toBe("SQL injection in login")
    expect(store.get(first.finding.id.slice(0, 10))?.id).toBe(first.finding.id)

    const duplicate = store.save({
      title: "SQL injection in login",
      category: "sqli",
      severity: "critical",
      target: "https://app.example.com",
      endpoint: "https://app.example.com/login",
      parameter: "username",
      description: "The username parameter is concatenated into a SQL query. Confirmed with a boolean oracle.",
      impact: "Authentication bypass and data exfiltration.",
      evidence: { output: "boolean true/false length differ" },
    })
    expect(duplicate.deduped).toBe(true)
    expect(duplicate.finding.id).toBe(first.finding.id)
    expect(duplicate.finding.severity).toBe("critical")
    expect(duplicate.finding.evidence.payload).toBe("' OR 1=1 --")
    expect(duplicate.finding.evidence.output).toContain("boolean")

    const updated = store.update(first.finding.id, { remediation: "Use parameterized queries." })
    expect(updated?.remediation).toBe("Use parameterized queries.")

    store.recordVerification(first.finding.id, {
      status: "reproduced",
      method: "boolean-sqli",
      summary: "reproduced in test",
      assertions: [],
      verifiedAt: new Date().toISOString(),
    })
    const verified = store.get(first.finding.id)
    expect(verified?.verified).toBe(true)
    expect(verified?.status).toBe("confirmed")

    const summary = store.summary()
    expect(summary.total).toBe(1)
    expect(summary.bySeverity.critical).toBe(1)
    expect(summary.verified).toBe(1)
  })

  it("filters findings", async () => {
    const dir = workspace()
    const store = await openStore(dir)
    store.save({
      title: "A",
      category: "xss",
      severity: "low",
      target: "https://a.example.com",
      description: "x",
      impact: "y",
    })
    store.save({
      title: "B",
      category: "ssrf",
      severity: "high",
      target: "https://b.example.com",
      description: "x",
      impact: "y",
    })
    expect(store.list({ severity: "high" })).toHaveLength(1)
    expect(store.list({ target: "a.example.com" })[0]?.title).toBe("A")
  })

  it("writes summary.json atomically, without leftover temporary files", async () => {
    const dir = workspace()
    const store = await openStore(dir)
    for (const title of ["A", "B", "C"])
      store.save({ title, category: "xss", severity: "high", target: `https://${title}.example.com`, description: "x", impact: "y" })
    const folder = path.join(dir, ".grepleaks")
    const summary = JSON.parse(readFileSync(path.join(folder, "summary.json"), "utf8"))
    expect(summary.total).toBe(3)
    expect(summary.bySeverity.high).toBe(3)
    expect(readdirSync(folder).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })
})

describe("scope", () => {
  const scope = parseScope({
    engagement: "Acme",
    in_scope: ["example.com", "*.example.com", "10.0.0.0/8", "https://api.partner.test/api"],
    out_of_scope: ["admin.example.com"],
    rate_limit: { requests_per_second: 5 },
    attribution: { header: "X-Engagement", value: "acme" },
  })

  it("allows exact hosts", () => {
    expect(matchScope(scope, "https://example.com/login").allowed).toBe(true)
  })

  it("allows wildcard subdomains", () => {
    expect(matchScope(scope, "https://api.example.com").allowed).toBe(true)
  })

  it("lets out-of-scope win", () => {
    expect(matchScope(scope, "https://admin.example.com").allowed).toBe(false)
  })

  it("matches CIDR ranges", () => {
    expect(matchScope(scope, "http://10.2.3.4:8080").allowed).toBe(true)
    expect(matchScope(scope, "http://192.168.1.1").allowed).toBe(false)
  })

  it("matches URL prefixes", () => {
    expect(matchScope(scope, "https://api.partner.test/api/v1/users").allowed).toBe(true)
    expect(matchScope(scope, "https://api.partner.test/other").allowed).toBe(false)
  })

  it("is permissive when no scope exists", () => {
    expect(matchScope(undefined, "https://anywhere.example").allowed).toBe(true)
    expect(matchScope(undefined, "https://anywhere.example").configured).toBe(false)
  })

  it("denies everything when the scope has no in_scope entries", () => {
    const typo = parseScope({ in_scop: ["example.com"] })
    expect(matchScope(typo, "https://example.com").allowed).toBe(false)
    expect(matchScope(typo, "https://example.com").configured).toBe(true)
  })

  it("matches host:port entries against default ports", () => {
    const ports = parseScope({ in_scope: ["example.com:443"], out_of_scope: ["blocked.test:80"] })
    expect(matchScope(ports, "https://example.com/x").allowed).toBe(true)
    expect(matchScope(ports, "http://example.com/x").allowed).toBe(false)
    expect(matchScope(ports, "http://blocked.test/").reason).toContain("out of scope")
  })

  it("cannot be bypassed around an out-of-scope URL", () => {
    const urls = parseScope({
      in_scope: ["*.example.com", "https://app.example.com/api"],
      out_of_scope: ["https://www.example.com/admin", "admin.example.com"],
    })
    for (const target of [
      "https://www.example.com/admin",
      "https://www.example.com/admin?x=1",
      "https://www.example.com/admin#frag",
      "https://www.example.com/Admin",
      "https://WWW.Example.com/admin/",
      "https://www.example.com//admin",
      "https://www.example.com:443/admin",
      "http://www.example.com/admin",
      "https://www.example.com/./admin",
      "https://www.example.com/x/../admin",
      "https://www.example.com/%61dmin",
      "https://www.example.com/x/..%2fadmin",
      "https://www.example.com./admin",
      "https://admin.example.com./",
    ]) {
      expect(matchScope(urls, target).allowed).toBe(false)
    }
    expect(matchScope(urls, "https://www.example.com/administrator").allowed).toBe(true)
    expect(matchScope(urls, "https://www.example.com/public").allowed).toBe(true)
  })

  it("keeps in-scope URL prefixes on segment boundaries", () => {
    const urls = parseScope({ in_scope: ["https://app.example.com/api"] })
    expect(matchScope(urls, "https://app.example.com/api").allowed).toBe(true)
    expect(matchScope(urls, "https://app.example.com/api/v1?x=1").allowed).toBe(true)
    expect(matchScope(urls, "https://app.example.com:443/api/v1").allowed).toBe(true)
    expect(matchScope(urls, "https://app.example.com/api/../admin").allowed).toBe(false)
    expect(matchScope(urls, "https://app.example.com/api/%2e%2e/admin").allowed).toBe(false)
    expect(matchScope(urls, "https://app.example.com/apix").allowed).toBe(false)
    expect(matchScope(urls, "http://app.example.com/api").allowed).toBe(false)
    expect(matchScope(urls, "https://app.example.com:8443/api").allowed).toBe(false)
  })

  it("checks resolved addresses against CIDR entries", async () => {
    const cidr = parseScope({ in_scope: ["*.example.com", "10.0.0.0/8"], out_of_scope: ["10.9.0.0/16", "127.0.0.0/8"] })
    const resolver = (map: Record<string, string[]>) => async (host: string) => map[host] ?? []
    const dns = resolver({
      "app.example.com": ["10.1.2.3"],
      "sneaky.example.com": ["10.9.1.1"],
      "loop.example.com": ["93.184.216.34", "127.0.0.1"],
      "internal.corp": ["10.4.4.4"],
      "mixed.corp": ["10.4.4.4", "8.8.8.8"],
    })
    expect((await matchScopeResolved(cidr, "https://app.example.com", dns)).allowed).toBe(true)
    expect((await matchScopeResolved(cidr, "https://sneaky.example.com", dns)).allowed).toBe(false)
    expect((await matchScopeResolved(cidr, "https://loop.example.com", dns)).allowed).toBe(false)
    expect((await matchScopeResolved(cidr, "https://internal.corp", dns)).allowed).toBe(true)
    expect((await matchScopeResolved(cidr, "https://mixed.corp", dns)).allowed).toBe(false)
    expect((await matchScopeResolved(cidr, "https://unresolvable.example.com", dns)).allowed).toBe(false)
    expect((await matchScopeResolved(cidr, "http://10.9.0.1", dns)).allowed).toBe(false)
  })
})

describe("scoped http client", () => {
  let server: Server
  let base = ""
  const seen: Array<{ path: string; authorization?: string }> = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", base)
      seen.push({ path: url.pathname, authorization: request.headers.authorization })
      if (url.pathname === "/to-outside") {
        response.writeHead(302, { location: "http://outside.invalid/steal" })
        response.end()
        return
      }
      if (url.pathname === "/to-inside") {
        response.writeHead(302, { location: "/final" })
        response.end()
        return
      }
      if (url.pathname === "/loop") {
        response.writeHead(302, { location: "/loop" })
        response.end()
        return
      }
      response.writeHead(200, { "content-type": "text/plain" })
      response.end(`ok ${url.pathname}`)
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
  })

  afterAll(() => {
    server?.close()
  })

  function ctx(scope: object | string) {
    const dir = workspace()
    mkdirSync(path.join(dir, ".grepleaks"), { recursive: true })
    writeFileSync(path.join(dir, ".grepleaks", "scope.json"), typeof scope === "string" ? scope : JSON.stringify(scope))
    writeFileSync(
      path.join(dir, ".grepleaks", "auth.json"),
      JSON.stringify({ identities: [{ label: "owner", auth: { type: "bearer", token: "real-token" } }] }),
    )
    return { workspace: dir }
  }

  it("refuses every request when the scope file is invalid", async () => {
    const result = await httpRequest(ctx("not json"), { url: `${base}/ok` })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Scope refused")
  })

  it("scope-checks each redirect hop", async () => {
    const context = ctx({ in_scope: ["127.0.0.1"] })
    const outside = await httpRequest(context, { url: `${base}/to-outside`, followRedirects: true })
    expect(outside.ok).toBe(false)
    expect(outside.error).toContain("redirect to http://outside.invalid/steal")

    const inside = await httpRequest(context, { url: `${base}/to-inside`, followRedirects: true })
    expect(inside.ok).toBe(true)
    expect(inside.bodyText).toBe("ok /final")

    const loop = await httpRequest(context, { url: `${base}/loop`, followRedirects: true })
    expect(loop.ok).toBe(false)
    expect(loop.error).toContain("too many redirects")

    const manual = await httpRequest(context, { url: `${base}/to-outside` })
    expect(manual.ok).toBe(true)
    expect(manual.evidence.status).toBe(302)
  })

  it("does not replay redacted credentials", async () => {
    seen.length = 0
    const result = await httpRequest(ctx({ in_scope: ["127.0.0.1"] }), {
      url: `${base}/ok`,
      headers: { Authorization: "Bearer [redacted]" },
    })
    expect(result.ok).toBe(true)
    expect(seen[0]?.authorization).toBe("Bearer real-token")
  })
})

describe("triage", () => {
  it("flags document behaviour", () => {
    const result = holdingItWrong({
      title: "File write",
      category: "info",
      severity: "low",
      target: "x",
      description: "The API writes a file to disk.",
      impact: "none",
    })
    expect(result.matched).toBe(true)
    expect(result.suppressable).toBe(true)
  })

  it("protects high-impact claims from auto-suppression", () => {
    const result = holdingItWrong({
      title: "File write leads to RCE",
      category: "rce",
      severity: "critical",
      target: "x",
      description: "The API writes a file to disk with attacker-controlled content.",
      impact: "Remote code execution.",
    })
    expect(result.matched).toBe(true)
    expect(result.suppressable).toBe(false)
  })

  it("scores evidence completeness", () => {
    const low = evidenceCompleteness({
      title: "A",
      category: "x",
      severity: "low",
      target: "x",
      description: "short",
      impact: "short",
    })
    const high = evidenceCompleteness({
      title: "A",
      category: "x",
      severity: "low",
      target: "x",
      endpoint: "https://x",
      description: "x".repeat(100),
      impact: "y".repeat(60),
      remediation: "fix",
      evidence: {
        request: { url: "https://x" },
        response: { url: "https://x", status: 200 },
        payload: "p",
      },
    })
    expect(low).toBeLessThan(0.5)
    expect(high).toBeGreaterThan(0.9)
  })

  it("treats verified or high severity as disclosure-worthy", () => {
    expect(
      isDisclosureWorthy({
        title: "A",
        category: "x",
        severity: "high",
        target: "x",
        description: "x",
        impact: "y",
      }),
    ).toBe(true)
  })

  it("returns warnings for thin findings", () => {
    const result = triage({
      title: "A",
      category: "x",
      severity: "low",
      target: "x",
      description: "short",
      impact: "short",
    })
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

describe("scope loading fails closed", () => {
  function withScopeFile(content: string): string {
    const dir = workspace()
    mkdirSync(path.join(dir, ".grepleaks"), { recursive: true })
    writeFileSync(path.join(dir, ".grepleaks", "scope.json"), content)
    return dir
  }

  it("throws on an empty or non-object scope file", () => {
    expect(() => loadScope(withScopeFile(""))).toThrow(ScopeError)
    expect(() => loadScope(withScopeFile("[]"))).toThrow(ScopeError)
    expect(() => loadScope(withScopeFile("null"))).toThrow(ScopeError)
  })

  it("throws when GREPLEAKS_SCOPE points at a missing file", () => {
    const previous = process.env.GREPLEAKS_SCOPE
    process.env.GREPLEAKS_SCOPE = path.join(workspace(), "missing-scope.json")
    try {
      expect(() => loadScope(workspace())).toThrow(ScopeError)
    } finally {
      if (previous === undefined) delete process.env.GREPLEAKS_SCOPE
      else process.env.GREPLEAKS_SCOPE = previous
    }
  })
})
