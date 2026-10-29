# Bounty Set — offensive web / API / mobile / cloud / LLM skills

129 **offensive** skills for bug bounty and app/site hacking: 113 selected from the repo's 817 + 16 custom skills (the `custom` category): 8 filling repo gaps + 8 for the engagement pipeline.

## Engagement pipeline (the actual pentest flow)

**"Ok let's hack X"** → the orchestrator takes over and walks the phases:

| Phase | Skill | Artefact produced |
|---|---|---|
| Orchestration + state | `orchestrating-end-to-end-web-attack` | `STATE.md` (session resume) |
| 0. Scope | `establishing-engagement-scope` | `00-scope.md` + workspace |
| 1. Passive recon | `performing-passive-reconnaissance` | `01-passive/*` (subdomains, CNAMEs, leaks) |
| 2. Active discovery | `performing-active-discovery` | `02-active/*` (live hosts, crawl, JS mining, candidates) |
| 3. Inventory | `building-attack-surface-inventory` | `03-inventory.md` (assets × features) |
| 4. Attack plan | `planning-prioritized-attack-strategy` | `04-attack-plan.md` (windows → skills, P0-P3) |
| 5. Execution | `executing-attack-plan` | `05-execution/` (findings + evidence) |
| 6. Reporting | `writing-penetration-test-report` | `06-report.md` |

Every phase is **gated**: no artefact, no next phase. Findings discovered during execution loop back into the inventory and the plan. The condensed `performing-attack-surface-mapping-and-planning` skill stays available as **quick mode** (target already known, express plan).

Each entry is a symlink to `skills/<name>` (updated with `git pull`).

## Categories

| Category | Count | Contents |
|---|---|---|
| `recon` | 14 | OSINT, subdomains, cert transparency, Shodan, urlscan, API discovery, scans |
| `web` | 46 | Full OWASP Top 10: SQLi, XSS, SSRF, IDOR/BAC, deserialization, smuggling, HPP, cache poisoning/deception, WAF bypass, CORS, host header, open redirect, clickjacking, CSP, race conditions, subdomain takeover, business logic |
| `api` | 11 | REST, GraphQL (introspection, depth limits), WebSockets, SOAP, rate limiting, fuzzing, BOLA, API keys |
| `auth` | 8 | JWT (alg confusion, none, token security), OAuth2/OIDC, device code phishing, Evilginx3 (MFA bypass), hashcat |
| `components` | 3 | Dependency confusion, SCA, malicious npm packages |
| `mobile` | 12 | Android/iOS: pinning bypass, intents, Frida, Objection, MobSF, JADX, local storage |
| `cloud` | 9 | AWS (S3, pacu, ScoutSuite, privesc), Azure storage, Entra ID (ROADtools), MS Graph, cloudfox |
| `ai` | 8 | Prompt injection (direct/indirect/RAG), system prompt leak, Pyrit, Garak, vector stores, MCP |
| `general` | 3 | Metasploit, AFL++, binary exploitation |
| `custom` | 16 | **Pipeline (8)**: orchestrator + 7 phases (scope, passive recon, active discovery, inventory, plan, execution, reporting) · **Gaps (8)**: condensed attack plan (quick mode), file upload, password reset, 2FA bypass, SAML, session management, DOM clobbering/postMessage, HTTP/2 |

## OWASP Top 10 (2021) coverage

- A01 Broken Access Control — 5 skills
- A02 Cryptographic Failures — crypto audit, mobile storage, headers, 2FA/SAML (custom)
- A03 Injection — 12 skills (the largest coverage)
- A04 Insecure Design — business logic (partial)
- A05 Security Misconfiguration — headers, CSP, WAF, CORS, cloud
- A06 Vulnerable Components — 3 skills
- A07 Identification & Auth Failures — 8 skills + 2FA bypass, password reset, SAML, sessions (custom)
- A08 Software Integrity — mass assignment, deserialization
- A09 Logging & Monitoring — exfiltration through errors (partial)
- A10 SSRF — 3 skills

## Gaps closed by the custom skills

- Full engagement pipeline (scope → recon → inventory → plan → execution → reporting) → the 8 pipeline skills above
- File upload → `exploiting-file-upload-vulnerabilities`
- SAML attacks → `exploiting-saml-assertion-vulnerabilities`
- Password reset flows → `exploiting-password-reset-flaws`
- 2FA/MFA bypass → `bypassing-two-factor-authentication`
- Session management (fixation, cookie flags) → `testing-session-management-vulnerabilities`
- DOM clobbering + postMessage → `exploiting-dom-clobbering-and-postmessage`
- HTTP/2 attacks (CONTINUATION flood, Rapid Reset, h2c smuggling) → `exploiting-http2-vulnerabilities`

## Remaining gaps (rare classes in web bounty, covered in practice by neighbouring skills)

- Client-side Web Crypto (nonce reuse, weak keys) — partly in `performing-cryptographic-audit-of-application`
- DNS rebinding — an SSRF/CORS bypass technique, approachable through the SSRF skills

## Usage

The agent loads the relevant skill on demand (progressive disclosure); each entry in
this folder is a symlink into `skills/<name>`.
