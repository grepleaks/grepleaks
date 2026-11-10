/**
 * Local findings store. One SQLite database per engagement workspace.
 */

import { createHash } from "node:crypto"
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import type {
  Finding,
  FindingEvidence,
  FindingInput,
  FindingStatus,
  Severity,
  Verification,
} from "./types"
import { asSeverity, severityRank } from "./types"

type Row = Record<string, any>

interface DbLike {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: any[]): any
    get(...params: any[]): any
    all(...params: any[]): any[]
  }
  close(): void
}

interface SqliteModule {
  Database?: new (filename: string, options?: any) => DbLike
  DatabaseSync?: new (filename: string) => DbLike
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  target TEXT NOT NULL,
  endpoint TEXT,
  parameter TEXT,
  method TEXT,
  cwe TEXT,
  cvss REAL,
  cvss_vector TEXT,
  description TEXT NOT NULL,
  impact TEXT NOT NULL,
  remediation TEXT,
  evidence TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'candidate',
  verified INTEGER NOT NULL DEFAULT 0,
  verification TEXT,
  identities TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS findings_dedupe ON findings(dedupe_key);
CREATE INDEX IF NOT EXISTS findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS findings_severity ON findings(severity);
`

function now(): string {
  return new Date().toISOString()
}

function id(): string {
  const random = Math.random().toString(36).slice(2, 8)
  return `fnd_${Date.now().toString(36)}${random}`
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
}

function hostOf(target: string): string {
  try {
    return new URL(target.includes("://") ? target : `http://${target}`).hostname.toLowerCase()
  } catch {
    return target.toLowerCase().split(/[/?#]/)[0] ?? target.toLowerCase()
  }
}

function pathOf(target: string): string {
  try {
    return new URL(target.includes("://") ? target : `http://${target}`).pathname.replace(/\/+$/, "") || "/"
  } catch {
    return "/"
  }
}

export function dedupeKey(input: Pick<FindingInput, "title" | "category" | "target" | "endpoint" | "parameter">): string {
  const basis = [
    hostOf(input.target),
    input.category.toLowerCase(),
    pathOf(input.endpoint ?? input.target),
    (input.parameter ?? "").toLowerCase(),
    slug(input.title),
  ].join("|")
  return createHash("sha256").update(basis).digest("hex").slice(0, 32)
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function rowToFinding(row: Row): Finding {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    severity: asSeverity(row.severity),
    confidence: Number(row.confidence ?? 0),
    target: row.target,
    endpoint: row.endpoint ?? undefined,
    parameter: row.parameter ?? undefined,
    method: row.method ?? undefined,
    cwe: row.cwe ?? undefined,
    cvss: row.cvss === null || row.cvss === undefined ? undefined : Number(row.cvss),
    cvssVector: row.cvss_vector ?? undefined,
    description: row.description,
    impact: row.impact,
    remediation: row.remediation ?? undefined,
    evidence: parseJson<FindingEvidence>(row.evidence, {}),
    status: row.status as FindingStatus,
    verified: Boolean(row.verified),
    verification: parseJson<Verification | undefined>(row.verification, undefined),
    identities: parseJson<string[]>(row.identities, []),
    tags: parseJson<string[]>(row.tags, []),
    source: row.source ?? undefined,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mergeEvidence(left: FindingEvidence, right: FindingEvidence): FindingEvidence {
  return {
    request: right.request ?? left.request,
    response: right.response ?? left.response,
    payload: right.payload ?? left.payload,
    output: [left.output, right.output].filter(Boolean).join("\n---\n") || undefined,
    files: Array.from(new Set([...(left.files ?? []), ...(right.files ?? [])])),
    notes: [left.notes, right.notes].filter(Boolean).join("\n") || undefined,
    expect: right.expect ?? left.expect,
    steps: Array.from(new Set([...(left.steps ?? []), ...(right.steps ?? [])])),
  }
}

export class FindingStore {
  private constructor(private readonly db: DbLike, readonly filename: string) {}

  static async open(workspace: string): Promise<FindingStore> {
    const filename = process.env.GREPLEAKS_FINDINGS_DB || path.join(workspace, ".grepleaks", "findings.db")
    mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
    const mod: SqliteModule = await import("bun:sqlite").catch(() => import("node:sqlite"))
    if (!mod.Database && !mod.DatabaseSync) throw new Error("No SQLite runtime available")
    const db = mod.Database ? new mod.Database(filename, { create: true }) : new mod.DatabaseSync!(filename)
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;")
    db.exec(SCHEMA)
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        chmodSync(`${filename}${suffix}`, 0o600)
      } catch {
        // The WAL/SHM files may not exist yet; they are created on first write.
      }
    }
    return new FindingStore(db, filename)
  }

  close(): void {
    this.db.close()
  }

  save(input: FindingInput): { finding: Finding; deduped: boolean } {
    const timestamp = now()
    const key = dedupeKey(input)
    const existing = this.db.prepare("SELECT * FROM findings WHERE dedupe_key = ? LIMIT 1").get(key) as Row | undefined
    if (existing) {
      const current = rowToFinding(existing)
      const merged: Partial<Finding> = {
        severity: severityRank(input.severity) > severityRank(current.severity) ? input.severity : current.severity,
        confidence: Math.max(current.confidence, input.confidence ?? 0),
        description: (input.description ?? "").length > current.description.length ? input.description : current.description,
        impact: (input.impact ?? "").length > current.impact.length ? input.impact : current.impact,
        remediation: input.remediation && !current.remediation ? input.remediation : current.remediation,
        evidence: mergeEvidence(current.evidence, input.evidence ?? {}),
        identities: Array.from(new Set([...current.identities, ...(input.identities ?? [])])),
        tags: Array.from(new Set([...current.tags, ...(input.tags ?? [])])),
        status: input.status === "confirmed" ? "confirmed" : current.status,
        verified: current.verified,
        updatedAt: timestamp,
      }
      this.write(current.id, merged, current)
      return { finding: this.get(current.id)!, deduped: true }
    }

    const finding: Finding = {
      id: id(),
      title: input.title,
      category: input.category,
      severity: asSeverity(input.severity),
      confidence: input.confidence ?? 0.5,
      target: input.target,
      endpoint: input.endpoint,
      parameter: input.parameter,
      method: input.method,
      cwe: input.cwe,
      cvss: input.cvss,
      cvssVector: input.cvssVector,
      description: input.description,
      impact: input.impact,
      remediation: input.remediation,
      evidence: input.evidence ?? {},
      status: input.status ?? "candidate",
      verified: false,
      identities: input.identities ?? [],
      tags: input.tags ?? [],
      source: input.source,
      dedupeKey: key,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.insert(finding)
    return { finding, deduped: false }
  }

  private insert(finding: Finding): void {
    this.db
      .prepare(
        `INSERT INTO findings (
          id, title, category, severity, confidence, target, endpoint, parameter, method, cwe, cvss,
          cvss_vector, description, impact, remediation, evidence, status, verified, verification,
          identities, tags, source, dedupe_key, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        finding.id,
        finding.title,
        finding.category,
        finding.severity,
        finding.confidence,
        finding.target,
        finding.endpoint ?? null,
        finding.parameter ?? null,
        finding.method ?? null,
        finding.cwe ?? null,
        finding.cvss ?? null,
        finding.cvssVector ?? null,
        finding.description,
        finding.impact,
        finding.remediation ?? null,
        JSON.stringify(finding.evidence),
        finding.status,
        finding.verified ? 1 : 0,
        finding.verification ? JSON.stringify(finding.verification) : null,
        JSON.stringify(finding.identities),
        JSON.stringify(finding.tags),
        finding.source ?? null,
        finding.dedupeKey,
        finding.createdAt,
        finding.updatedAt,
      )
    this.writeSummary()
  }

  private write(findingId: string, patch: Partial<Finding>, _current?: Finding): void {
    const fields: string[] = []
    const values: any[] = []
    const columns: Record<string, string> = {
      title: "title",
      category: "category",
      severity: "severity",
      confidence: "confidence",
      target: "target",
      endpoint: "endpoint",
      parameter: "parameter",
      method: "method",
      cwe: "cwe",
      cvss: "cvss",
      cvssVector: "cvss_vector",
      description: "description",
      impact: "impact",
      remediation: "remediation",
      status: "status",
      verified: "verified",
      source: "source",
      updatedAt: "updated_at",
    }
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue
      const value = (patch as any)[key]
      fields.push(`${column} = ?`)
      values.push(key === "verified" ? (value ? 1 : 0) : (value ?? null))
    }
    if ("evidence" in patch) {
      fields.push("evidence = ?")
      values.push(JSON.stringify(patch.evidence ?? {}))
    }
    if ("verification" in patch) {
      fields.push("verification = ?")
      values.push(patch.verification ? JSON.stringify(patch.verification) : null)
    }
    if ("identities" in patch) {
      fields.push("identities = ?")
      values.push(JSON.stringify(patch.identities ?? []))
    }
    if ("tags" in patch) {
      fields.push("tags = ?")
      values.push(JSON.stringify(patch.tags ?? []))
    }
    if (fields.length === 0) return
    values.push(findingId)
    this.db.prepare(`UPDATE findings SET ${fields.join(", ")} WHERE id = ?`).run(...values)
    this.writeSummary()
  }

  private writeSummary(): void {
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          chmodSync(`${this.filename}${suffix}`, 0o600)
        } catch {
          // The file may not exist yet.
        }
      }
      const file = path.join(path.dirname(this.filename), "summary.json")
      const result = this.summary()
      const latest = this.list({ limit: 8 }).map((finding) => ({
        id: finding.id,
        title: finding.title,
        severity: finding.severity,
        status: finding.status,
        verified: finding.verified,
        target: finding.target,
        category: finding.category,
      }))
      // Write a temporary file and rename it over the summary: the TUI polls
      // this file and must never read a half-written one. rename() is atomic
      // on the same filesystem.
      const temporary = `${file}.${process.pid}.tmp`
      try {
        writeFileSync(temporary, JSON.stringify({ generatedAt: now(), ...result, latest }, null, 2), { mode: 0o600 })
        renameSync(temporary, file)
      } catch (error) {
        rmSync(temporary, { force: true })
        throw error
      }
    } catch {
      // The summary is a UI convenience; never fail a finding write for it.
    }
  }

  update(findingId: string, patch: Partial<Finding>): Finding | undefined {
    const current = this.get(findingId)
    if (!current) return undefined
    this.write(current.id, { ...patch, updatedAt: now() }, current)
    return this.get(current.id)
  }

  recordVerification(findingId: string, verification: Verification): Finding | undefined {
    const current = this.get(findingId)
    if (!current) return undefined
    const verified =
      verification.status === "reproduced"
        ? true
        : verification.status === "not_reproduced"
          ? false
          : current.verified
    const status =
      verification.status === "reproduced"
        ? "confirmed"
        : verification.status === "not_reproduced" && current.status === "confirmed"
          ? "candidate"
          : current.status
    return this.update(findingId, { verification, verified, status })
  }

  get(findingId: string): Finding | undefined {
    const exact = this.db.prepare("SELECT * FROM findings WHERE id = ?").get(findingId) as Row | undefined
    if (exact) return rowToFinding(exact)
    const matches = this.db
      .prepare("SELECT * FROM findings WHERE id LIKE ? ORDER BY created_at DESC LIMIT 2")
      .all(`${findingId}%`) as Row[]
    if (matches.length === 1) return rowToFinding(matches[0])
    return undefined
  }

  list(filter: { status?: string; severity?: string; target?: string; limit?: number } = {}): Finding[] {
    const where: string[] = []
    const values: any[] = []
    if (filter.status) {
      where.push("status = ?")
      values.push(filter.status)
    }
    if (filter.severity) {
      where.push("severity = ?")
      values.push(filter.severity)
    }
    if (filter.target) {
      where.push("(target = ? OR endpoint LIKE ? OR target LIKE ?)")
      values.push(filter.target, `%${filter.target}%`, `%${filter.target}%`)
    }
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 500))
    const sql = `SELECT * FROM findings ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY CASE severity WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END DESC,
      created_at DESC LIMIT ${limit}`
    return (this.db.prepare(sql).all(...values) as Row[]).map(rowToFinding)
  }

  summary(): {
    total: number
    byStatus: Record<string, number>
    bySeverity: Record<Severity, number>
    verified: number
  } {
    const rows = this.db.prepare("SELECT status, severity, verified FROM findings").all() as Row[]
    const byStatus: Record<string, number> = {}
    const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    let verified = 0
    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
      const severity = asSeverity(row.severity)
      bySeverity[severity] += 1
      if (row.verified) verified += 1
    }
    return { total: rows.length, byStatus, bySeverity, verified }
  }
}

const stores = new Map<string, Promise<FindingStore>>()

export function openStore(workspace: string): Promise<FindingStore> {
  const filename = process.env.GREPLEAKS_FINDINGS_DB || path.join(workspace, ".grepleaks", "findings.db")
  const existing = stores.get(filename)
  if (existing) return existing
  const created = FindingStore.open(workspace)
  stores.set(filename, created)
  return created
}
