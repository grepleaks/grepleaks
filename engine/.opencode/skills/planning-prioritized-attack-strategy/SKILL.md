---
name: planning-prioritized-attack-strategy
description: Phase 4 of the offensive pipeline — turn the attack surface inventory into a prioritized attack plan: map every detected feature to vulnerability windows and the exact exploitation skill to run, score each window (impact × feasibility × cheapness), define the P0-P3 execution order, and schedule noisy tests. Use after the inventory is complete, driven by the orchestrating-end-to-end-web-attack skill, before execution.
domain: cybersecurity
subdomain: penetration-testing
tags:
- attack-plan
- prioritization
- threat-modeling
- vulnerability-mapping
- pentest
version: '1.0'
author: lucas
license: Apache-2.0
nist_csf:
- ID.RA-01
- ID.AM-06
mitre_attack:
- T1497
- T1595
---

# Planning the Prioritized Attack Strategy

## Purpose

The inventory says WHAT exists. The plan says WHAT TO TEST, IN WHAT ORDER, WITH WHICH SKILL. This is the phase where senior-tester judgment lives: a 40-feature target does not get 40 equal tests — it gets 5 P0s that are likely to yield, then the rest.

## Inputs

- `03-inventory.md` (asset table + feature checklist + candidates)
- `00-scope.md` (noise budget, accounts)

## Workflow

### 1. Map Features → Attack Windows → Skills

For every ✅ feature in the inventory, list the vulnerability windows it opens and the skill from the set that executes each:

| Feature detected | Attack window(s) | Skill to run |
|---|---|---|
| File upload | webshell, polyglot XSS, LFI chain | `exploiting-file-upload-vulnerabilities` |
| Password reset / magic link | token flaws, host header, JWT-in-reset | `exploiting-password-reset-flaws` |
| 2FA (TOTP/SMS/push/WebAuthn) | replay, fatigue, logic, backup codes | `bypassing-two-factor-authentication` |
| SAML SSO | XSW, attributes, XXE, RelayState | `exploiting-saml-assertion-vulnerabilities` |
| OAuth / "continue with" | redirect_uri, code theft, PKCE, state | `testing-oauth2-implementation-flaws` + `exploiting-oauth-misconfiguration` |
| JWT (Bearer / cookie / reset) | alg confusion, none, weak secret, kid | `testing-for-json-web-token-vulnerabilities` + `exploiting-jwt-algorithm-confusion-attack` |
| Session cookie | fixation, flags, invalidation, scope | `testing-session-management-vulnerabilities` |
| REST API | BOLA, mass assignment, rate limits, excess data | `testing-api-security-with-owasp-top-10` + `exploiting-idor-vulnerabilities` + `exploiting-mass-assignment-in-rest-apis` + `exploiting-excessive-data-exposure-in-api` |
| GraphQL | introspection, depth, batching, authz per field | `performing-graphql-introspection-attack` + `performing-graphql-depth-limit-attack` |
| URL parameter (import/preview/webhook) | SSRF (direct + blind) | `performing-ssrf-vulnerability-exploitation` + `performing-blind-ssrf-exploitation` |
| Search / filter / sort | SQLi, NoSQLi, second-order | `exploiting-sql-injection-vulnerabilities` + `exploiting-nosql-injection-vulnerabilities` |
| ID in URL / API response | IDOR / BOLA / BFLA | `exploiting-idor-vulnerabilities` + `testing-for-broken-access-control` + `exploiting-broken-function-level-authorization` |
| User content rendered | reflected/stored/DOM XSS | `testing-for-xss-vulnerabilities` + `testing-for-xss-vulnerabilities-with-burpsuite` |
| iframes / postMessage in bundle | DOM XSS, clobbering, origin checks | `exploiting-dom-clobbering-and-postmessage` |
| Dangling CNAME / 3rd-party asset | subdomain takeover | `exploiting-broken-link-hijacking` |
| Public cloud storage | listing, RW, takeover, exfil | `auditing-aws-s3-bucket-permissions` (+ Azure/GCP equivalents) |
| Export / download / page param | LFI, path traversal | `performing-directory-traversal-testing` |
| AI / chat / RAG | prompt injection, system prompt leak, tool abuse | `testing-prompt-injection-in-rag-pipelines` + `testing-for-system-prompt-leakage` |
| Webhooks / callbacks / redirects | open redirect, host header, token leak | `testing-for-open-redirect-vulnerabilities` + `testing-for-host-header-injection` |
| Payment / voucher / invite flow | business logic, negative values, races | `testing-for-business-logic-vulnerabilities` + `exploiting-race-condition-vulnerabilities` |
| Multi-tenant features | cross-tenant data leak | `testing-for-broken-access-control` |
| Mobile app | pinning, storage, intents, deep links | `conducting-mobile-app-penetration-test` |
| HTTP/2 + proxy chain | desync, smuggling, DoS vectors | `exploiting-http2-vulnerabilities` |
| Behind CDN/WAF, multi-tier | request smuggling, cache poisoning, HPP | `exploiting-http-request-smuggling` + `performing-web-cache-poisoning-attack` + `performing-http-parameter-pollution-attack` |
| CORS on API | null origin, wildcard+credentials, reflection | `testing-cors-misconfiguration` |
| Login / verify endpoints | rate limiting → brute force | `performing-api-rate-limiting-bypass` |
| Any HTML response with CSP | CSP bypass → XSS even with filters | `performing-content-security-policy-bypass` |
| Deserialization hints (Java cookies, .bin, base64 blobs) | gadget chains | `exploiting-insecure-deserialization` |
| Prototype pollution hints (Node, JSON merge, ?a[b]=c) | __proto__ pollution | `exploiting-prototype-pollution-in-javascript` |
| Template rendering of user data | SSTI | `exploiting-template-injection-vulnerabilities` |
| Leaked AWS key (from recon) | key → privesc → data | `exploiting-aws-with-pacu` + `enumerating-cloud-with-cloudfox` |

### 2. Score Each Window

**Score = Impact (1-3) × Feasibility (1-3) × Cheapness (1-3)**

- **Impact**: RCE / full ATO / cross-tenant data = 3 · stored XSS / IDOR on PII / SSRF to internal = 2 · info disclosure / low = 1
- **Feasibility**: feature confirmed + you have an account = 3 · needs special state (second account, specific data) = 2 · needs infra (VPS, second domain, mobile device) = 1
- **Cheapness**: testable in < 5 min with 1-2 requests = 3 · < 1 h = 2 · multi-step / multi-session = 1

### 3. Assign Priority Bands

| Band | Rule | Examples |
|---|---|---|
| **P0** | score ≥ 12 OR trivially cheap high-impact | dangling CNAME (1 DNS query), unauth endpoint, file upload, password reset, host header in reset email, JWT decode, CORS preflight |
| **P1** | score 6-11, core test | IDOR sweep on object IDs, SQLi on search, SSRF on URL params, OAuth redirect_uri, mass assignment, business logic on payment, SSO attribute tamper |
| **P2** | needs setup or time | DOM clobbering, cache poisoning, SAML deep-dive, 2FA full flow, mobile, AI/RAG |
| **P3** | noisy — schedule, coordinate | request smuggling, HTTP/2 DoS, rate-limit brute force, MFA fatigue, XML bombs, GraphQL depth |

**Execution rules:**
1. P0 first — the first hour exists to find something.
2. Within a band, order by cheapness (burn the 2-minute tests before the 2-hour tests).
3. P3 last, off-peak, announced as noisy (findings log).
4. One window = one skill load. Do not mix techniques mid-window.

### 4. Write `04-attack-plan.md`

```markdown
# Attack Plan — <target> — <date>
## Scope recap (from 00-scope.md)
## Windows
| # | Window | Asset | Evidence (URL/request) | Hypothesis | Skill | Score | Band | Noise |
|---|--------|-------|------------------------|------------|-------|-------|------|-------|
| W1 | Subdomain takeover | staging.target.com | cnames.txt line 4 | S3 dangling | exploiting-broken-link-hijacking | 18 | P0 | low |
| W2 | File upload → RCE | app.target.com | /settings/avatar, accepts .png | ext/MIME bypass | exploiting-file-upload-vulnerabilities | 15 | P0 | low |
...
## Execution order
1. W1 (5 min) → 2. W3 (5 min) → 3. W2 (30 min) → ...
## Noisy tests (schedule)
- W17 smuggling — propose 02:00 UTC
## Findings log
(move to 05-execution/findings-log.md at execution start)
```

### 5. Checkpoint with the User

Show the plan: P0 list + total estimated time. One question: "On exécute dans cet ordre, ou tu veux qu'on force la main sur une fenêtre en particulier ?" Then STATE.md → Phase 5.

## Output

`04-attack-plan.md` (windows table + execution order + noisy schedule).

## Gate (before phase 5)

- Every ✅ feature in `03-inventory.md` has ≥ 1 window (or an explicit "no window" reason)
- Every candidate from `02-active/candidates.md` is a window
- Every window has a skill assigned and a band
- Noisy tests are scheduled, not inlined
- User confirmed the order
