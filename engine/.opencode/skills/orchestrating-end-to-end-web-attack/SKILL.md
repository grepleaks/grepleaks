---
name: orchestrating-end-to-end-web-attack
description: Orchestrator skill that runs a complete offensive engagement against a target — scopes the rules of engagement, drives each phase (passive recon, active discovery, inventory, attack planning, execution, reporting) by loading the matching phase skill, gates phase transitions on artifacts, and tracks state for resumption. Use when the user names a target to hack ("let's hack X", "engage X", "start a pentest on X") and the full cycle should be run from zero.
domain: cybersecurity
subdomain: penetration-testing
tags:
- orchestrator
- attack-workflow
- methodology
- pentest
- bug-bounty
- state-machine
version: '1.0'
author: lucas
license: Apache-2.0
nist_csf:
- ID.RA-01
- ID.AM-06
mitre_attack:
- T1595
- T1592
---

# Orchestrating an End-to-End Web Attack

## Overview

This is the **entry point** of the offensive skill set. When a target is named, do NOT jump straight into vulnerability testing. Load this skill, run the phase pipeline below, and load each phase skill in order. Each phase produces a **file artifact**; the next phase consumes it. Phase transitions are gated: no artifact, no next phase.

The pipeline mirrors the real pentest lifecycle (PTES): pre-engagement → intelligence → threat modeling → analysis → exploitation → reporting.

## When to Use

- User says: "let's hack <target>", "engage <target>", "scan <target>", "start on <target>"
- A new target enters the workspace
- **Quick mode** (target already known, user wants speed): skip phases 1-4 and load `performing-attack-surface-mapping-and-planning` directly, then continue at phase 5.

## Workspace Layout (create in Phase 0)

```
engagement/<target>/<YYYY-MM-DD>/
├── STATE.md                  # current phase, next action (update after EVERY phase)
├── 00-scope.md
├── 01-passive/               # subdomains.txt, ips.txt, cnames.txt, urls.txt, leaks.md
├── 02-active/                # live.txt, ports.md, crawl.txt, js-endpoints.txt, api-map.md, fingerprints.md, candidates.md
├── 03-inventory.md
├── 04-attack-plan.md
├── 05-execution/             # findings-log.md, evidence/
└── 06-report.md
```

`STATE.md` is what makes a long hunt resumable across sessions:

```markdown
# STATE — <target>
Phase: 3 (inventory) — in progress
Last action: crawled app.target.com, 214 URLs
Next action: complete feature checklist for api.target.com
Blocked on: nothing
```

## Phase Pipeline

| # | Phase | Load skill | Consumes | Produces | Gate to next |
|---|-------|-----------|----------|----------|--------------|
| 0 | Scope | `establishing-engagement-scope` | user request | `00-scope.md` + workspace | user confirms scope & noise budget |
| 1 | Passive recon | `performing-passive-reconnaissance` | `00-scope.md` | `01-passive/*` | subdomains collected, CNAMEs analyzed, leaks written |
| 2 | Active discovery | `performing-active-discovery` | `01-passive/*` | `02-active/*` | every live asset crawled, `candidates.md` written |
| 3 | Inventory | `building-attack-surface-inventory` | `01+02` | `03-inventory.md` | every asset has a row, feature checklist complete, no "?" |
| 4 | Attack plan | `planning-prioritized-attack-strategy` | `03-inventory.md` | `04-attack-plan.md` | every present feature mapped to a skill, P0s defined, noisy tests scheduled |
| 5 | Execution | `executing-attack-plan` | `04-attack-plan.md` | `05-execution/findings-log.md` | every window tested or skipped with documented reason |
| 6 | Report | `writing-penetration-test-report` | findings log + evidence | `06-report.md` | user reviews report |

## Execution Rules

1. **Gate discipline**: before loading the next phase skill, verify the previous artifact exists and is non-trivial. If a phase produced nothing (e.g. 0 subdomains), document why in STATE.md and move on — do not fabricate.
2. **Loop-backs are normal**: during execution, a new subdomain or endpoint discovered → append to `03-inventory.md`, add the window to `04-attack-plan.md`, test it. Never let a discovery die in chat.
3. **Chains before next window**: when a finding is exploitable, follow the chain to its max impact (upload → where does it land? → LFI? → RCE?) BEFORE moving to the next window. Criticals come from chains.
4. **Noise management**: P3 tests (smuggling, DoS, brute force, MFA fatigue) run last, off-peak, and are announced in the findings log as noisy tests performed.
5. **Update STATE.md after every phase AND every significant finding** — if the session dies, the next session resumes from STATE.md.
6. **User checkpoints**: after phase 0 (confirm scope), after phase 4 (confirm the plan + P0 list), and after phase 6 (review report). Do not checkpoint between 1-3 unless blocked.

## Resuming a Hunt

Session starts, user says "continue on <target>":
1. Read `engagement/<target>/<latest>/STATE.md`
2. Verify the current phase's artifact
3. Load the current phase's skill and continue from "Next action"

## Handoff to Exploitation

Phase 5 (`executing-attack-plan`) is what actually loads the exploitation skills from the set (SQLi, IDOR, file upload, SAML, …). The orchestrator never executes vulnerability tests itself — it drives the pipeline.
