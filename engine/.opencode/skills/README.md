# Bounty Set — skills offensifs web / API / mobile / cloud / LLM

129 skills orientés **offensive** pour du bug bounty et du hacking d'apps/sites : 113 sélectionnés dans les 817 du repo + 16 skills custom (catégorie `custom`) : 8 pour combler les gaps du repo + 8 pour le pipeline d'engagement.

## Pipeline d'engagement (le vrai flux pentest)

**"Ok let's hack X"** → l'orchestrateur prend le relais et enchaîne les phases :

| Phase | Skill | Artefact produit |
|---|---|---|
| Orchestration + état | `orchestrating-end-to-end-web-attack` | `STATE.md` (reprise de session) |
| 0. Scope | `establishing-engagement-scope` | `00-scope.md` + workspace |
| 1. Recon passive | `performing-passive-reconnaissance` | `01-passive/*` (subdomains, CNAMEs, leaks) |
| 2. Découverte active | `performing-active-discovery` | `02-active/*` (live, crawl, JS mining, candidats) |
| 3. Inventaire | `building-attack-surface-inventory` | `03-inventory.md` (assets × features) |
| 4. Plan d'attaque | `planning-prioritized-attack-strategy` | `04-attack-plan.md` (fenêtres → skills, P0-P3) |
| 5. Exécution | `executing-attack-plan` | `05-execution/` (findings + evidence) |
| 6. Reporting | `writing-penetration-test-report` | `06-report.md` |

Chaque phase est **gated** : pas d'artefact = pas de phase suivante. Les découvertes en cours d'exécution bouclent dans l'inventaire/plan. Le skill condensé `performing-attack-surface-mapping-and-planning` reste disponible en **quick mode** (target déjà connu, plan express).

Chaque entrée est un symlink vers `skills/<name>` (mise à jour via `git pull`).

## Catégories

| Catégorie | Nb | Contenu |
|---|---|---|
| `recon` | 14 | OSINT, sous-domaines, cert transparency, Shodan, urlscan, API discovery, scans |
| `web` | 46 | OWASP Top 10 complet : SQLi, XSS, SSRF, IDOR/BAC, deserialization, smuggling, HPP, cache poisoning/deception, WAF bypass, CORS, host header, open redirect, clickjacking, CSP, race conditions, subdomain takeover, business logic |
| `api` | 11 | REST, GraphQL (introspection, depth limit), WebSockets, SOAP, rate limiting, fuzzing, BOLA, API keys |
| `auth` | 8 | JWT (alg confusion, none, token security), OAuth2/OIDC, device code phishing, Evilginx3 (MFA bypass), hashcat |
| `components` | 3 | Dependency confusion, SCA, packages npm malveillants |
| `mobile` | 12 | Android/iOS : pinning bypass, intents, Frida, Objection, MobSF, JADX, stockage local |
| `cloud` | 9 | AWS (S3, pacu, ScoutSuite, privesc), Azure storage, Entra ID (ROADtools), MS Graph, cloudfox |
| `ai` | 8 | Prompt injection (direct/indirect/RAG), system prompt leak, Pyrit, Garak, vector stores, MCP |
| `general` | 3 | Metasploit, AFL++, binary exploitation |
| `custom` | 16 | **Pipeline (8)** : orchestrateur + 7 phases (scope, recon passive, discovery active, inventaire, plan, exécution, reporting) · **Gaps (8)** : attack plan condensé (quick mode), file upload, password reset, 2FA bypass, SAML, session management, DOM clobbering/postMessage, HTTP/2 |

## Couverture OWASP Top 10 (2021)

- A01 Broken Access Control — 5 skills
- A02 Cryptographic Failures — audit crypto, stockage mobile, headers, 2FA/SAML (custom)
- A03 Injection — 12 skills (le plus couvré)
- A04 Insecure Design — business logic (partiel)
- A05 Security Misconfiguration — headers, CSP, WAF, CORS, cloud
- A06 Vulnerable Components — 3 skills
- A07 Identification & Auth Failures — 8 skills + 2FA bypass, password reset, SAML, sessions (custom)
- A08 Software Integrity — mass assignment, deserialization
- A09 Logging & Monitoring — exfiltration via erreurs (partiel)
- A10 SSRF — 3 skills

## Gaps comblés par les skills custom

- Pipeline complet d'engagement (scope → recon → inventaire → plan → exécution → reporting) → 8 skills du pipeline ci-dessus
- File upload → `exploiting-file-upload-vulnerabilities`
- SAML attacks → `exploiting-saml-assertion-vulnerabilities`
- Password reset flows → `exploiting-password-reset-flaws`
- 2FA/MFA bypass → `bypassing-two-factor-authentication`
- Session management (fixation, cookie flags) → `testing-session-management-vulnerabilities`
- DOM clobbering + postMessage → `exploiting-dom-clobbering-and-postmessage`
- HTTP/2 attacks (CONTINUATION flood, Rapid Reset, h2c smuggling) → `exploiting-http2-vulnerabilities`

## Gaps restants (classes rares en bounty web, couverts en pratique par les skills voisins)

- Web Crypto client-side (nonce reuse, clés faibles) — partiellement dans `performing-cryptographic-audit-of-application`
- DNS rebinding — technique de bypass SSRF/CORS, abordable via les skills SSRF

## Usage

Chargé globalement via `~/.claude/skills/bug-bounty` (symlink vers ce dossier).
L'agent charge le skill pertinent à la demande (progressive disclosure).
