import { describe, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { openStore } from "./store"
import { parseScope, matchScope } from "./scope"
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
