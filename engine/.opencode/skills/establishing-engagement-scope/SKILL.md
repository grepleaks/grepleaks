---
name: establishing-engagement-scope
description: Phase 0 of the offensive pipeline — extract the engagement scope (in/out of scope, noise budget, accounts, program rules), verify available tooling, create the engagement workspace, and write the scope file. Use as the first phase of any target engagement, driven by the orchestrating-end-to-end-web-attack skill.
domain: cybersecurity
subdomain: penetration-testing
tags:
- scope
- rules-of-engagement
- pre-engagement
- workspace
- pentest
version: '1.0'
author: lucas
license: Apache-2.0
nist_csf:
- ID.AM-06
- ID.RA-01
mitre_attack:
- T1595
---

# Establishing Engagement Scope

## Purpose

Pre-engagement phase. Before a single packet is sent: know WHAT is in scope, HOW LOUD we can be, and WHAT TOOLS we have. This phase is fast (10-15 min) but prevents the two classic failures: testing out-of-scope assets, and burning the target with noise before finding anything.

## Inputs

- User request: target name/URL(s), context (bug bounty program? internal pentest? research?)
- Optional: program URL (HackerOne/Bugcrowd/Intigriti), program policy text

## Workflow

### 1. Extract the Scope

From the user request and any program policy:

**In scope** (be explicit — list every domain/asset class):
- Domains: `target.com`, `*.target.com` (wildcard?), specific subdomains only?
- API hosts, mobile app backends, cloud storage (S3 buckets, blob containers)
- Third-party properties owned by the target (their staging, their GitHub org)

**Out of scope / no-touch**:
- Other customers' data, third-party SaaS (their Okta, their Stripe), personal accounts of employees
- Hardware/physical, VDI, specific apps explicitly excluded

**Noise budget** (critical for bounties and prod targets):
- Rate: continuous crawling OK? Brute force OK? DoS vectors OK?
- Timing: off-peak window if any
- Mutation: can you create/modify/delete data? (usually: create yes, delete no, never touch prod payments)

**Accounts**:
- Normal user account (test1) — required
- Second user (test2) — required for IDOR/BAC
- Admin — often not available; note it
- Test email/phone for reset & 2FA flows

**Program rules** (bug bounty):
- Safe harbor? POC requirements? Which severity is rewarded?
- Already-known vulns list (check the program's known issues to avoid dupes)
- Response time expectations

If info is missing: ask the user the 3 essential questions (domains in scope, noise budget, accounts) — then proceed, do not interrogate further.

### 2. Verify Tooling

```bash
for t in subfinder httpx nmap ffuf curl jq python3 gau katana sqlmap jwt_tool seclists; do
  command -v $t >/dev/null 2>&1 && echo "OK  $t" || echo "MISS $t"
done
```

For each MISS: note the fallback in the scope file (e.g. no subfinder → crt.sh + dnsdumpster API; no ffuf → curl loop; no katana → Burp spider or wget --spider).

### 3. Create the Workspace

```bash
T="engagement/<target>/$(date +%F)"
mkdir -p $T/01-passive $T/02-active $T/05-execution/evidence
```

### 4. Write `00-scope.md`

```markdown
# Scope — <target> — <date>
## In scope
<explicit list>
## Out of scope / no-touch
<list>
## Noise budget
<rate, timing, mutation rules>
## Accounts
test1: <email> (normal)
test2: <email> (second user)
## Program rules
<safe harbor, POC requirements, known-issues link>
## Tooling
OK: ... / MISS (fallback): ...
## First targets (user priority if any)
```

### 5. Checkpoint with the User

Show the scope file. One question: "Scope confirmé, on part sur quoi en premier — le wildcard ou un sous-domaine précis ?" Then update STATE.md → Phase 1.

## Output

- `00-scope.md`
- workspace directory tree
- `STATE.md` → Phase: 1

## Gate (before phase 1)

- Scope file exists with in/out of scope, noise budget, accounts
- Tooling checked, fallbacks noted
- User confirmed
