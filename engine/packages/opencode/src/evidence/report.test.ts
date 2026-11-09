import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { generateReport } from "./report"
import { openStore } from "./store"

function workspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "grepleaks-report-"))
  mkdirSync(path.join(dir, ".grepleaks"), { recursive: true })
  writeFileSync(
    path.join(dir, ".grepleaks", "scope.json"),
    JSON.stringify({
      engagement: "Acme Q4",
      client: "Acme",
      tester: "Grepleaks",
      in_scope: ["app.example.com"],
      out_of_scope: ["admin.example.com"],
    }),
  )
  return dir
}

describe("report rendering", () => {
  it("renders markdown, html, json and sarif reports", async () => {
    const dir = workspace()
    const store = await openStore(dir)
    store.save({
      title: "SQL injection in login",
      category: "sqli",
      severity: "critical",
      target: "https://app.example.com",
      endpoint: "https://app.example.com/login",
      parameter: "username",
      description: "The username parameter is concatenated into a SQL query.",
      impact: "Authentication bypass.",
      remediation: "Use parameterized queries.",
      cwe: "CWE-89",
      cvss: 9.8,
      evidence: {
        payload: "' OR 1=1 --",
        request: {
          url: "https://app.example.com/login",
          method: "POST",
          requestHeaders: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
          requestBody: "username={{payload}}&token=secret",
        },
      },
    })
    store.save({
      title: "Missing security headers",
      category: "hardening",
      severity: "info",
      target: "https://app.example.com",
      description: "The response does not set a CSP.",
      impact: "Defence in depth is reduced.",
    })

    const markdown = await generateReport({ workspace: dir, format: "markdown" })
    expect(markdown.total).toBe(2)
    expect(markdown.counts.critical).toBe(1)
    const md = readFileSync(markdown.path, "utf8")
    expect(md).toContain("Acme Q4")
    expect(md).toContain("SQL injection in login")
    expect(md).toContain("CWE-89")
    expect(md).toContain("Out of scope")
    expect(md).not.toContain("Bearer secret")
    expect(md).not.toContain("token=secret")
    expect(md).toContain("[redacted]")

    const html = await generateReport({ workspace: dir, format: "html" })
    const page = readFileSync(html.path, "utf8")
    expect(page).toContain("<!doctype html>")
    expect(page).toContain("SQL injection in login")
    expect(page).toContain("Critical")

    const json = await generateReport({ workspace: dir, format: "json" })
    const parsed = JSON.parse(readFileSync(json.path, "utf8"))
    expect(parsed.findings).toHaveLength(2)
    expect(parsed.engagement.name).toBe("Acme Q4")

    const sarif = await generateReport({ workspace: dir, format: "sarif" })
    const document = JSON.parse(readFileSync(sarif.path, "utf8"))
    expect(document.version).toBe("2.1.0")
    expect(document.runs[0].results).toHaveLength(2)
    expect(document.runs[0].results[0].level).toBe("error")
  })

  it("refuses a report path outside the workspace", async () => {
    const dir = workspace()
    await expect(generateReport({ workspace: dir, format: "markdown", path: "../../escape.md" })).rejects.toThrow(
      "inside the engagement workspace",
    )
  })

  it("renders an empty store without failing", async () => {
    const dir = workspace()
    for (const format of ["markdown", "html", "json", "sarif"] as const) {
      const result = await generateReport({ workspace: dir, format })
      expect(readFileSync(result.path, "utf8").length).toBeGreaterThan(0)
    }
    const markdown = await generateReport({ workspace: dir, format: "markdown" })
    expect(readFileSync(markdown.path, "utf8")).toContain("No findings recorded")
  })

  it("excludes suppressed and false-positive findings", async () => {
    const dir = workspace()
    const store = await openStore(dir)
    store.save({
      title: "Included finding",
      category: "sqli",
      severity: "high",
      target: "https://app.example.com",
      description: "A real finding.",
      impact: "Impact.",
    })
    store.save({
      title: "Suppressed finding",
      category: "sqli",
      severity: "low",
      target: "https://app.example.com",
      description: "Suppressed.",
      impact: "Impact.",
      status: "suppressed",
    })
    store.save({
      title: "False positive finding",
      category: "sqli",
      severity: "low",
      target: "https://app.example.com",
      description: "False positive.",
      impact: "Impact.",
      status: "false_positive",
    })
    const result = await generateReport({ workspace: dir, format: "markdown" })
    const text = readFileSync(result.path, "utf8")
    expect(result.total).toBe(1)
    expect(text).toContain("Included finding")
    expect(text).not.toContain("Suppressed finding")
    expect(text).not.toContain("False positive finding")
  })
})
