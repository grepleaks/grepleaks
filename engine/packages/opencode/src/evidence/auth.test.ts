import { describe, expect, it } from "bun:test"
import { authStatus, parseAuth, profileFor } from "./auth"

describe("auth profiles", () => {
  it("parses a single bearer profile", () => {
    const profiles = parseAuth({ type: "bearer", token: "secret" })
    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.headers.Authorization).toBe("Bearer secret")
  })

  it("parses identities with roles", () => {
    const profiles = parseAuth({
      identities: [
        { label: "owner", role: "user", auth: { type: "cookie", value: "session=owner" } },
        { label: "other", role: "user", auth: { type: "header", name: "X-API-Key", value: "other" } },
      ],
    })
    expect(profiles).toHaveLength(2)
    expect(profileFor(profiles, "owner")?.headers.Cookie).toBe("session=owner")
    expect(profileFor(profiles, "other")?.headers["X-API-Key"]).toBe("other")
  })

  it("builds basic auth", () => {
    const profiles = parseAuth({ type: "basic", username: "u", password: "p" })
    expect(profiles[0]?.headers.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`)
  })

  it("does not expose secrets in status", () => {
    const status = JSON.stringify(authStatus(parseAuth({ type: "bearer", token: "super-secret-token" })))
    expect(status).not.toContain("super-secret-token")
    expect(status).toContain("secretConfigured")
  })
})
