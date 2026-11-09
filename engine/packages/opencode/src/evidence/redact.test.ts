import { describe, expect, it } from "bun:test"
import { redactHeaders, redactText } from "./redact"

describe("redaction", () => {
  it("redacts sensitive headers", () => {
    const headers = redactHeaders({
      Authorization: "Bearer super-secret",
      Cookie: "session=abc",
      "X-API-Key": "key",
      "Content-Type": "text/html",
    })
    expect(headers?.Authorization).toBe("[redacted]")
    expect(headers?.Cookie).toBe("[redacted]")
    expect(headers?.["X-API-Key"]).toBe("[redacted]")
    expect(headers?.["Content-Type"]).toBe("text/html")
  })

  it("redacts tokens in text and URLs", () => {
    const text = redactText("Authorization: Bearer abc.def\nGET /?token=xyz&page=2")
    expect(text).not.toContain("abc.def")
    expect(text).not.toContain("token=xyz")
    expect(text).toContain("page=2")
  })
})
