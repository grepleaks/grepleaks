---
name: building-attack-surface-inventory
description: Phase 3 of the offensive pipeline — consolidate passive and active discovery into a single structured inventory: every asset with its tech stack, auth model, entry points, and a completed feature checklist (upload, reset, 2FA, SSO, IDs, URL params, GraphQL, websockets, AI features…). Use after active discovery, driven by the orchestrating-end-to-end-web-attack skill, before writing the attack plan.
domain: cybersecurity
subdomain: penetration-testing
tags:
- attack-surface
- inventory
- feature-mapping
- threat-modeling
- pentest
version: '1.0'
author: lucas
license: Apache-2.0
nist_csf:
- ID.AM-06
- ID.RA-01
mitre_attack:
- T1595
- T1497
---

# Building the Attack Surface Inventory

## Purpose

One file, one truth. Everything discovered in phases 1-2 gets consolidated here. The inventory is the input to the attack plan — an asset or feature that is not in the inventory will not be tested. This phase is also where you **use the accounts**: walk the app like a real user and mark what exists.

## Inputs

- `01-passive/*` (subdomains, CNAMEs, URLs, leaks)
- `02-active/*` (live.txt, ports, crawls, js-endpoints, api-map, fingerprints, candidates)
- test accounts from `00-scope.md`

## Workflow

### 1. Build the Asset Table

```markdown
| # | Asset | Type | Tech (fingerprint) | Auth model | Entry points / key features | Signals |
|---|-------|------|--------------------|------------|------------------------------|---------|
| 1 | app.target.com | SPA (React) | Cloudflare, nginx, `csrftoken` cookie | session + JWT Bearer | login, 2FA, upload avatar, /admin (403), /api/v2 | S3 bucket in JS, Swagger at /api-docs |
| 2 | api.target.com | REST | AWS ALB | Bearer token | /users, /import (URL param), /webhooks, /graphql | verbose 500s, /health unauth |
| 3 | cdn.target.com | CDN static | CloudFront | none | user uploads | CNAME → dangling (candidate #1) |
| 4 | sso.target.com | SSO | Okta | SAML | /saml/acs, /saml/metadata | RelayState in URL |
| 5 | db.target.com:5432 | PostgreSQL | PG 14 | password? | ports.md #3 | exposed, no auth banner |
```

Rules:
- One row per asset (no "misc" rows).
- Type must be specific (SPA / server-rendered / REST / GraphQL / static / DB / storage / API gateway).
- Auth model: what actually gates it (cookie name, Bearer, none, IP allowlist).

### 2. Feature Checklist (walk each web asset, logged in)

For EVERY web asset, go through this list in the UI (15 min each). Mark ✅ / ❌ / ?(couldn't tell):

| Feature | Where to look |
|---|---|
| File upload | avatar, profile pic, document import, image editor, "attach", drag-drop |
| Password reset / magic link | login screen links |
| 2FA / MFA | settings → security; login flow |
| SSO (SAML/OIDC) | "Continue with…" buttons, SSO login option |
| OAuth (Google/Apple/…) | social login buttons |
| Session cookie | devtools → application → cookies (name + flags) |
| IDs in URLs / API responses | browse data: /users/123? order ids? uuids in JSON? |
| URL/URI parameters | import from URL, preview, embed, callback, webhook, "load from link" |
| Search / filter / sort | any search box, table filters, `?sort=` |
| User content rendered | comments, bios, names, titles — where do they display? |
| iframes / embeds / postMessage | bundles + visible embeds (chat widgets, payment iframes) |
| Websockets | devtools → network → WS (live features) |
| GraphQL | /graphql, /v1/graphql, apollo client in bundle |
| Mobile backend | separate API for the app? separate auth? |
| AI / chat / RAG | any "ask", copilot, support chat, document Q&A |
| Payment / voucher / invite / referral | checkout, promo codes, invite links |
| Export / download | "export to CSV", file download, report generation (path params) |
| Host-header sensitivity | does anything echo the Host (links in emails, generated URLs)? |

### 3. Annotate Signals

For each ✅ feature, add 1 line of context that will save time in phase 4:
- Upload: which endpoint, what file types accepted (from the UI error message), where files land (URL pattern)
- Reset: where the token goes (URL param? body?), token format visible?
- 2FA: which factor (TOTP/SMS/push), where validated
- SSO: which IdP (Okta? Azure? one-login?), ACS URL
- IDs: which object, format (int/uuid/slug), where shown
- URL params: exact param name, what it fetches

### 4. Cross-Check Against Candidates

Every entry in `02-active/candidates.md` must appear as a signal on some asset row (takeover → the subdomain row; unauth endpoint → the asset row; leaked key → the asset it was found in).

### 5. Resolve Every "?"

A "?" means you didn't look properly. Either find the answer (dig through the bundle, try the endpoint) or convert it to ❌ with a reason. The gate is: **no "?" in the final file.**

## Output

`03-inventory.md`:
1. Asset table (all assets, no gaps)
2. Per-asset feature checklist with annotations
3. Candidates cross-referenced
4. Explicit list of assets/features NOT testable (no account, out of scope) with reasons

## Gate (before phase 4)

- Every live asset from `02-active/live.txt` has a row
- Feature checklist complete for every web asset (✅/❌ only, no ?)
- Candidates all cross-referenced
- STATE.md → Phase 4
