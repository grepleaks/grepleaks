---
name: testing-session-management-vulnerabilities
description: Test session management for fixation, predictable session IDs, missing cookie flags (Secure/HttpOnly/SameSite), non-invalidating logout, concurrent sessions, and excessive lifetimes to enable session hijacking and account takeover. Use during any web application or API security assessment where a session cookie or bearer token is issued.
domain: cybersecurity
subdomain: web-application-security
tags:
- session
- session-fixation
- cookie-flags
- http-only
- samesite
- session-hijacking
- bug-bounty
version: '1.0'
author: lucas
license: Apache-2.0
nist_csf:
- PR.PS-01
- PR.DS-10
- DE.CM-09
mitre_attack:
- T1528
- T1078
---

# Testing Session Management Vulnerabilities

## Overview

A session ID is a bearer credential: whoever holds it IS the user. The test is therefore: can you (a) obtain one without authenticating (fixation, prediction), (b) steal it (missing flags + XSS, logs, referrers), or (c) keep using one you shouldn't (no invalidation, long lifetime)?

## When to Use

- Every web app / API assessment (session handling is universal)
- Targets where the session cookie name looks weak (`JSESSIONID`, `PHPSESSID`, short tokens)
- After finding any XSS (check HttpOnly) or any logout (check invalidation)

## Prerequisites

- Burp Suite or curl with cookie jars
- Two test accounts
- `python3` for entropy checks

## Step 1: Inventory the Session

```bash
curl -sI -c /tmp/jar "https://target.com/" | grep -i set-cookie
```

Record: name, path/domain scope, value length and charset, and all flags. Then map the session lifecycle: login → new value? privilege change → new value? logout → value dead?

## Step 2: Cookie Flags

| Missing flag | Test | Impact |
|---|---|---|
| `Secure` | Load the app over `http://` (or strip in Burp) — is the cookie sent? | Session stealable on any network (Medium/High) |
| `HttpOnly` | Any XSS on the origin + `document.cookie` | Session theft via XSS (chain → High) |
| `SameSite` | Cross-site POST from attacker.com with the cookie (Lax missing) | CSRF on state-changing requests |

`SameSite=Strict` on the main cookie is unusual (breaks normal navigation) — note it, but test `Lax` vs missing carefully: `Lax` blocks cross-site POST; missing sends it.

## Step 3: Session Fixation

1. As an anonymous user, capture the pre-login session ID (`S0`).
2. Log in. If the ID is **still `S0`** → fixation: an attacker who set `S0` (via crafted link, XSS, or shared session) is logged in as the victim after login.
3. Correct behavior: the session ID **regenerates** at login AND on any privilege change (user → admin).

```bash
# Pre-login
curl -s -c /tmp/pre "https://target.com/" -o /dev/null
grep session /tmp/pre
# Login
curl -s -b /tmp/pre -c /tmp/post -d "user=a&pass=b" "https://target.com/login" -o /dev/null
grep session /tmp/post   # same value as pre? → fixation
```

## Step 4: ID Predictability & Entropy

Collect 10–20 session IDs (log out/in repeatedly, or from different accounts):

```bash
python3 - <<'EOF'
import math, collections
ids = ["PASTE_ID_1", "PASTE_ID_2", "PASTE_ID_3"]  # collect ~15
for i in ids[:3]:
    print(i, len(i))
# entropy per char position (sequential check)
import itertools
print("unique:", len(set(ids)))
EOF
```

Red flags:
- Sequential/incrementing values (counter)
- Timestamps: base36/base62 of epoch, or `iat`-style prefixes
- Very short (< 128 bits effective), or only a small charset
- IDs that encode the username or account ID (useful for enumeration)

If predictable → demonstrate: predict the next ID and use it in a fresh browser (no login) to reach a logged-in page.

## Step 5: Invalidation

- **Logout:** after logout, reuse the old cookie — still authenticated? (Server-side invalidation missing.) Also check: does logout just delete the client cookie while the server session lives?
- **Password change:** change password, reuse the old session.
- **2FA / role change:** after demotion, does the old (privileged) session still work?
- **Concurrent sessions:** log in from 3 "browsers" (cookie jars) — is there a limit? Does the newest evict the oldest?
- **Absolute vs idle timeout:** leave a session idle 30 min / 2 h / 24 h; also check the stated policy in the docs vs reality.

## Step 6: Session ID Placement

- **In the URL** (`?JSESSIONID=`, path-based): leaks to referrers, proxies, server logs, browser history. Find any link/redirect that carries it.
- **In multiple places** (cookie AND header AND URL): all three must rotate together at regeneration — test that one stale copy doesn't resurrect the session.
- **JWT as session:** check `exp` (too long = no real invalidation), no revocation mechanism, `jti` uniqueness, and whether logout actually removes anything server-side.

## Step 7: Cross-Origin & Subdomain Scope

- Cookie `Domain=.target.com` → shared across all subdomains. A weak subdomain (admin-panel on a forgotten host) shares your session.
- Test: set the cookie on `app.target.com`, then hit `api.target.com` with it — same user?
- `Path=/` vs narrow path (usually fine, but check for a session on `/` that a subpath app ignores).

## Tools

| Tool | Use |
|---|---|
| Burp (cookie editor, compare) | flag/lifecycle checks |
| curl cookie jars | fixation, invalidation scripts |
| Python | entropy, pattern detection |
| jwt.io | JWT sessions |

## Reporting Tips

- Fixation with pre-login ID reused post-login → **High** (demo: attacker sets cookie, victim logs in, attacker's request is authenticated).
- Missing `Secure` → **Medium**; missing `HttpOnly` + working XSS → **High** (report the chain).
- No logout invalidation → **Low/Medium** (depends on session lifetime).
- Always include the raw `Set-Cookie` header and the reproduction steps with two cookie jars.
