---
name: executing-attack-plan
description: Phase 5 of the offensive pipeline — execute the attack plan window by window in priority order: load the mapped exploitation skill for each window, run its workflow against the target, log every result (clean/finding + evidence), follow exploitable chains to maximum impact before moving on, and feed newly discovered assets back into the plan. Use after the attack plan is approved, driven by the orchestrating-end-to-end-web-attack skill.
domain: cybersecurity
subdomain: penetration-testing
tags:
- execution
- exploitation
- findings
- methodology
- pentest
- bug-bounty
version: '1.0'
author: lucas
license: Apache-2.0
nist_csf:
- ID.RA-04
- PR.PS-01
mitre_attack:
- T1190
- T1210
---

# Executing the Attack Plan

## Purpose

This is the engine room. The plan says what to test; this phase tests it, records everything, and chases chains. Three rules dominate: (1) no window is "done" without a logged verdict, (2) a finding gets chased to its max impact before the next window starts, (3) discoveries during execution loop back into the plan — they don't die in chat.

## Inputs

- `04-attack-plan.md` (windows, order, skills, noise schedule)
- `03-inventory.md` (context per asset)
- `05-execution/evidence/` directory (create at start)

## Workflow

### 1. Initialize

```bash
# Copy the findings log template into the execution folder
# findings-log.md header:
# # Findings Log — <target> — <date>
# | Window | Verdict | Severity | Evidence file | Notes |
```

Set the execution pointer: `W1`. Update STATE.md → Phase 5, current window.

### 2. Per-Window Loop

For each window in execution order:

**a. Load the mapped skill** (from the plan's table) — e.g. window W2 "file upload" → load `exploiting-file-upload-vulnerabilities`. That skill IS the procedure: follow its steps.

**b. Execute with evidence discipline.** For every significant request/response:
```
05-execution/evidence/W2-upload/
├── 01-canary.png          # the file you uploaded
├── 02-request.http        # full request
├── 03-response.http       # full response
└── 04-proof.png           # screenshot: execution / content-type / console
```
Evidence rule: a finding without a reproducible request is not a finding. Defang secrets in stored evidence.

**c. Log the verdict** — one of:
- `CLEAN` + what you tested (so it's not retested): "ext bypass x6, MIME, magic bytes, SVG — all rejected, files land in /uploads/ as .png only, served image/png"
- `FINDING (severity)` + evidence refs
- `BLOCKED` + reason + what would unblock (no 2nd account, needs mobile device)
- `SKIPPED (reason)` — only with justification (out of scope, noise budget)

**d. Chain before next window.** If the verdict is FINDING and it's exploitable, stop and answer: *what is the maximum I can do with this?*
- Upload works as `.svg` → can I reach other endpoints? → is there an LFI? → read `/etc/passwd`? → RCE?
- IDOR on `/users/123` → which fields? → can I WRITE (PUT/PATCH)? → can I reach the admin's id? → can I change their email? (→ ATO)
- SSRF to `169.254.169.254` → which cloud? → read the role creds → what can those creds do?
Log the chain as ONE finding with the max impact, including each hop.

**e. Update STATE.md** after each window (or each significant finding): current window, findings count, next action.

### 3. Loop-Backs (discovery during execution)

When execution reveals a NEW asset or feature (a subdomain in a response header, an endpoint in an error message, a second API in a JS chunk):
1. Add the row to `03-inventory.md` (mark `[discovered in W#]`)
2. Add the window(s) to `04-attack-plan.md` (score + band as usual)
3. Test it when its band's turn comes — or immediately if it's P0 (a dangling CNAME found mid-hunt gets tested NOW)

### 4. Noise Management

- P3 windows run only after all P0/P1 are done
- Announce each noisy test in the findings log: "W17 smuggling — 40 probe requests at 02:14 UTC"
- If the target shows stress (latency spikes, 502s), pause and note it

### 5. Stop Rules

End of phase when:
- Every window is `CLEAN`/`FINDING`/`BLOCKED`/`SKIPPED` (no empty rows), OR
- Timebox hit → log exactly where you stopped, STATE.md says "resume at W#"

## Output

- `05-execution/findings-log.md` (complete verdict table)
- `05-execution/evidence/W*/` (per-finding reproducible evidence)
- Updated `03-inventory.md` / `04-attack-plan.md` (loop-backs)
- STATE.md → Phase 6

## Gate (before phase 6)

- No window left without a verdict
- Every FINDING has evidence + a max-impact statement
- STATE.md clean
