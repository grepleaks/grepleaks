---
name: performing-attack-surface-mapping-and-planning
description: Quick-mode recon-to-plan in a single pass — map the attack surface of a known web target (assets, endpoints, tech stack, auth boundaries, third parties) from passive and active reconnaissance, then produce a prioritized attack plan linking each attack window to its exploitation skill. Use when the target is already known and a fast plan is wanted; for a new target from zero, use the full pipeline starting with orchestrating-end-to-end-web-attack.
domain: cybersecurity
subdomain: penetration-testing
tags:
- recon
- attack-surface
- attack-plan
- methodology
- discovery
- osint
- bug-bounty
- pentest-planning
version: '1.0'
author: lucas
license: Apache-2.0
nist_csf:
- ID.RA-01
- ID.AM-06
- PR.PS-01
mitre_attack:
- T1595
- T1592
- T1590
---

# Attack Surface Mapping & Attack Planning

## Overview

This is the entry-point skill of the offensive set. A pentest is not a list of vulnerabilities you throw at a target — it is a loop: **recon → inventory → hypotheses → prioritized execution → findings**. Skipping the inventory step is why experienced testers find things in 10 minutes that scanners take 10 hours to miss: they already know WHERE the interesting features are before they test.

The output of this skill is a single artifact: an **attack plan** (markdown file) that lists every asset, every attack window with evidence, the exploitation skill to use for each, and the execution order. All other skills in the set are then executed from that plan.

## When to Use

- Start of any engagement: new target, new program, new app
- After a major change: new feature shipped, new subdomain, rebrand, new SSO provider
- When a scan produced noise and you need to triage where to actually look
- As a pre-flight before a time-boxed hunt (e.g. "2 hours on this target")

## Prerequisites

- **Scope**: target domain(s), whether API/mobile/cloud are in scope, written permission level
- **Accounts**: a normal user account (and ideally a second one for IDOR/BAC tests)
- **Tools**: subfinder, httpx, nmap, ffuf, curl, a browser with devtools, (optional: Amass, nuclei, Gau, repo enumeration)
- **Rules of engagement**: what is off-limits (DoS, third-party properties, prod data mutation)

---

## Phase 0 — Scope & Rules of Engagement

Write down (even 3 lines) before touching anything:
- In scope: domains, wildcard?, API hosts, mobile backends, cloud accounts
- Out of scope / no-touch: third-party SaaS, other customers' data, aggressive DoS
- Noise budget: how much traffic is acceptable (matters for rate-limit and brute-force tests)
- Test accounts available (affects which auth flows you can test)

---

## Phase 1 — Passive Recon (touch nothing)

Goal: build the asset universe WITHOUT sending a single request to the target.

| Source | What it gives you | How |
|---|---|---|
| DNS | zones, subdomains, CNAME targets, MX | `dig` / `host`, zone transfer attempts |
| Certificate Transparency | historical subdomains (dead ones included) | `crt.sh/?q=%.<domain>`, censys |
| Shodan / Censys | open ports, banners, known vulns, IPs | shodan search `<domain>`, `<ip>` |
| Search engines | docs, leaks, staging URLs, API refs | `site:<domain>`, `<domain> "api"`, `<domain> "password reset"` |
| GitHub / GitLab | source, keys, env files, internal hostnames | dorks: `"domain.com" extension:env`, `org:x "target-api"`, `<domain> "eyJ"` (JWTs) |
| Paste sites | leaked creds, dumps | pastebin/gist search |
| urlscan.io | screenshots + full request graph of known pages | urlscan search |
| Wayback Machine | historical endpoints (dead admin panels, old API versions) | web.archive.org CDX API |

**Output:** raw lists → `assets/subdomains.txt`, `assets/ips.txt`, `assets/urls.txt`, `notes/leaks.md`.

Key questions answered: How many subdomains exist? Which CNAMEs point to third parties (S3, Heroku, GitHub Pages, Fastly…)? Any `staging`/`dev`/`old`/`api`/`admin`/`internal` in the list? Any leaked secrets in code?

## Phase 2 — Active Discovery (low noise)

Now hit the target, gently:

1. **Subdomain validation** — which subdomains are live:
```bash
subfinder -d target.com -silent | httpx -silent -status-code -title -tech-detect -o assets/live.txt
```
2. **Port/service scan** on live IPs (top ports first, then full if scoped):
```bash
nmap -sV -p- --min-rate 3000 -Pn <ip>   # or -sC for default scripts
```
3. **Crawl/spider** each live web app — enumerate real endpoints, not just the homepage:
```bash
# Burp Spider or:
gau --subs target.com | sort -u > urls_all.txt
katana -u https://app.target.com -d 3 -jc -kf all -o crawl.txt
```
4. **JavaScript mining** — the highest-yield 30 minutes of any web recon:
```bash
# Collect all JS, then grep for endpoints, keys, tokens, internal hosts
for js in js_files/*.js; do
  grep -oE 'https?://[a-zA-Z0-9.-]+' "$js"
  grep -oE '"/[a-z0-9/_-]{3,}"' "$js"
  grep -oE '(api[_-]?key|secret|token|jwt|bearer)["'"'"']?\s*[:=]\s*["'"'"'][^"'"'"']{8,}' "$js" -i
done
```
Look for: API routes, websocket URLs, admin paths, environment names, AWS S3 bucket names, OAuth client IDs, JWTs in client code.
5. **API discovery** — OpenAPI/Swagger, GraphQL playgrounds, gRPC reflection:
```bash
ffuf -u "https://api.target.com/FUZZ" -w common_api_paths.txt -mc 200,401,403
# Try: /openapi.json /swagger.json /api-docs /graphql /graphiql /_catalog /docs
```
6. **Tech stack fingerprinting** per asset — framework, WAF, CDN, server, cookie names (each changes which tests matter):
```bash
curl -sI https://app.target.com/ | grep -iE "server|x-powered|via|set-cookie|x-request"
```

## Phase 3 — Attack Surface Inventory

Consolidate everything into ONE table. This is the core artifact. Every row is an asset with its properties:

```markdown
| # | Asset | Type | Tech | Auth | Entry points / features | Interesting signals |
|---|-------|------|------|------|------------------------|---------------------|
| 1 | app.target.com | Web app (React SPA) | nginx, Cloudflare | cookie session + JWT | login, upload avatar, /admin, /api/v2 | S3 bucket in JS, Swagger at /api-docs |
| 2 | api.target.com | REST API | — | Bearer token | /users, /import (URL param), /webhooks | no auth on /health verbose |
| 3 | cdn.target.com | Static/CDN | CloudFront | none | serves user uploads | CNAME → dangling? |
| 4 | sso.target.com | SSO | Okta | SAML | /saml/acs | RelayState in URL |
| 5 | static-bucket.s3.amazonaws.com | Cloud storage | S3 | public? | listed objects | found in JS bundle |
```

**Feature flags to explicitly check per web asset** (walk the app as a normal user, 15 min each):
- [ ] File upload anywhere (avatar, document, image, import)
- [ ] Password reset / email change / magic link
- [ ] 2FA/MFA in the flow
- [ ] SSO (SAML/OIDC) login
- [ ] OAuth "continue with…" (Google/Apple/Microsoft)
- [ ] Session cookie (name, flags)
- [ ] IDs in URLs or API responses (user ids, order ids, uuids)
- [ ] URL/URI parameters (fetch, import, preview, callback, webhook)
- [ ] Search / filter / sort parameters
- [ ] User-generated content rendered (comments, bios, names)
- [ ] iframes / embeds / postMessage in the bundle
- [ ] Websockets (live features)
- [ ] GraphQL endpoint
- [ ] Mobile app backend (separate auth?)
- [ ] AI / chat / RAG feature
- [ ] Payment / voucher / invite / referral logic
- [ ] Export / download features (path params)
- [ ] Host header sensitivity (password reset email, links)

## Phase 4 — Attack Window Identification

Map every detected feature to vulnerability classes and to the **exact skill** from the set that executes the test:

| Detected feature | Attack window(s) | Skill to run |
|---|---|---|
| File upload | webshell, polyglot XSS, LFI chain | `exploiting-file-upload-vulnerabilities` |
| Password reset / magic link | token flaws, host header, JWT | `exploiting-password-reset-flaws` |
| 2FA (TOTP/SMS/push/WebAuthn) | replay, fatigue, logic | `bypassing-two-factor-authentication` |
| SAML SSO | XSW, attributes, XXE, RelayState | `exploiting-saml-assertion-vulnerabilities` |
| OAuth / "continue with" | redirect_uri, code theft, PKCE | `testing-oauth2-implementation-flaws` + `exploiting-oauth-misconfiguration` |
| JWT (Bearer / cookie) | alg confusion, none, weak secret | `testing-for-json-web-token-vulnerabilities` + `exploiting-jwt-algorithm-confusion-attack` |
| Session cookie | fixation, flags, invalidation | `testing-session-management-vulnerabilities` |
| REST API | BOLA, mass assignment, rate limits | `testing-api-security-with-owasp-top-10` + `exploiting-idor-vulnerabilities` + `exploiting-mass-assignment-in-rest-apis` |
| GraphQL | introspection, depth, batching | `performing-graphql-introspection-attack` + `performing-graphql-depth-limit-attack` |
| URL parameter (import/preview/webhook) | SSRF | `performing-ssrf-vulnerability-exploitation` + `performing-blind-ssrf-exploitation` |
| Search / filter / sort | SQLi, NoSQLi, second-order | `exploiting-sql-injection-vulnerabilities` |
| ID in URL/API response | IDOR / BOLA | `exploiting-idor-vulnerabilities` + `testing-for-broken-access-control` |
| User content rendered | XSS (reflected/stored/DOM) | `testing-for-xss-vulnerabilities` + `exploiting-dom-clobbering-and-postmessage` |
| iframes / postMessage in bundle | DOM XSS, clobbering | `exploiting-dom-clobbering-and-postmessage` |
| Dangling CNAME / 3rd-party asset | subdomain takeover | `exploiting-broken-link-hijacking` |
| Public cloud storage (S3/blob/GCS) | listing, read/write, takeover | `auditing-aws-s3-bucket-permissions` |
| Export / download / page param | LFI, path traversal | `performing-directory-traversal-testing` |
| AI chat / RAG | prompt injection, system prompt | `testing-prompt-injection-in-rag-pipelines` + `testing-for-system-prompt-leakage` |
| Webhooks / callbacks / redirects | open redirect, host header | `testing-for-open-redirect-vulnerabilities` + `testing-for-host-header-injection` |
| Payment / voucher / invite flow | business logic, race | `testing-for-business-logic-vulnerabilities` + `exploiting-race-condition-vulnerabilities` |
| Multi-tenant features | tenant data leak | `testing-for-broken-access-control` |
| Mobile app | pinning, storage, intents | `conducting-mobile-app-penetration-test` |
| HTTP/2 + proxy chain | desync, DoS | `exploiting-http2-vulnerabilities` |
| Behind CDN/WAF, multi-tier | smuggling, cache, HPP | `exploiting-http-request-smuggling` + `performing-web-cache-poisoning-attack` + `performing-http-parameter-pollution-attack` |
| CORS on API | misconfiguration | `testing-cors-misconfiguration` |
| Login brute-force surface | rate limiting | `performing-api-rate-limiting-bypass` |
| Any HTML response with CSP | CSP bypass | `performing-content-security-policy-bypass` |

## Phase 5 — Prioritization

Score each window: **Impact (I) × Feasibility (F) × Cheapness (C)** — each 1–3.

- **I**: RCE/ATO = 3, stored XSS/data leak = 2, info disclosure = 1
- **F**: feature confirmed working + you have an account = 3, needs special state = 2, needs infra (VPS, second domain) = 1
- **C**: testable in < 5 min with one request = 3, < 1 h = 2, multi-step = 1

**Execution rules (what a senior tester actually does):**
1. **P0 — first hour, cheap + high impact:** no-auth endpoints, dangling CNAMEs (1 DNS query each), file upload (3 uploads), password reset (2 requests), host header in reset email, JWT decode, CORS preflight, Swagger contents.
2. **P1 — core test:** IDOR sweep on every object ID, SQLi on search params, SSRF on URL params, OAuth redirect_uri, mass assignment on create/update, business logic on payment/voucher.
3. **P2 — time-consuming / needs setup:** DOM clobbering, cache poisoning, SAML deep-dive, 2FA flow, mobile.
4. **P3 — noisy, coordinate/last:** request smuggling, HTTP/2 DoS, rate-limit brute force, MFA fatigue, XML bombs. (These can affect other users — in a real pentest you schedule them; in a bounty, do them off-peak and document it.)

## Phase 6 — Output: The Attack Plan

Write the plan to `attack-plan-<target>-<date>.md`:

```markdown
# Attack Plan — <target> — <date>
## Scope & rules (from Phase 0)
## Assets (Phase 3 table)
## Attack windows
| # | Window | Evidence (request/URL) | Hypothesis | Skill | P0-3 | Noise |
|---|--------|------------------------|------------|-------|------|-------|
## Execution order (numbered, from Phase 5)
## Noisy tests to schedule
## Findings log (fill during execution: window #, what, severity, request)
```

Then execute in order. For each window: load the mapped skill, run its workflow, log the result in the findings log, move on. When a finding chains (e.g. upload → LFI → RCE), follow the chain before moving to the next window — chains are where criticals come from.

## Quality Checks Before Leaving This Phase

- [ ] Every live subdomain has been crawled or explicitly skipped (with reason)
- [ ] Every asset has its tech stack fingerprinted
- [ ] Every feature in the Phase 3 checklist is marked present/absent
- [ ] Every present feature has at least one attack window + skill assigned
- [ ] No P0 window was skipped without a documented reason
- [ ] The plan file exists and the execution order is numbered
