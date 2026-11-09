# Evidence, verification and reports

Grepleaks keeps a local record of what it tested and what it proved. The store
lives in the engagement workspace, so findings and reports persist with the
engagement files.

```
/engagement/.grepleaks/
  findings.db      SQLite findings store
  summary.json     small summary polled by the TUI sidebar
  reports/         generated markdown / html / json / sarif reports
  oast/hits.jsonl  out-of-band collaborator hits
  scope.json       optional scope file
  auth.json        optional target authentication profiles
```

## Scope

Pass `--scope` or create `.grepleaks/scope.json`:

```json
{
  "engagement": "Acme Q4",
  "client": "Acme",
  "start": "2026-11-01",
  "end": "2026-11-15",
  "tester": "Your name",
  "authorization": "SOW #123",
  "in_scope": ["app.example.com", "*.example.com", "10.0.0.0/8", "https://api.partner.test/api"],
  "out_of_scope": ["admin.example.com"],
  "rate_limit": { "requests_per_second": 5 },
  "attribution": { "X-Engagement": "acme-q4" },
  "allowed_activities": ["web", "api"]
}
```

Matching rules:

- `example.com` matches that exact host.
- `*.example.com` matches the apex and subdomains.
- `10.0.0.0/8` matches an IPv4 CIDR range.
- `https://api.example.com/api` matches that URL prefix only.
- Out-of-scope entries always win.

The verification oracles refuse an out-of-scope target. A scope file is
authorization metadata, not an OS sandbox: the agent still respects the
operator's rules. Set `GREPLEAKS_REQUIRE_SCOPE=1` to refuse traffic when no
scope file is configured.

## Target authentication

Pass `--auth` or create `.grepleaks/auth.json`:

```json
{
  "identities": [
    { "label": "owner", "role": "user", "auth": { "type": "bearer", "token": "..." } },
    { "label": "other", "role": "user", "auth": { "type": "cookie", "value": "session=..." } }
  ]
}
```

Supported auth types: `bearer`, `cookie`, `basic` (`username`/`password`) and
`header` (`name`/`value`). A single object without `identities` is also accepted.
`auth_status` lists labels, roles and header names, never secrets.

## Findings

`save_finding` writes a structured finding. Minimum fields: `title`, `category`,
`severity`, `target`, `description`, `impact`. Useful optional fields:
`endpoint`, `parameter`, `method`, `cwe`, `cvss`, `payload`, `request_json`,
`response_json`, `expect_json`, `tags`, `identities`, `source`.

```json
{
  "title": "SQL injection in login",
  "category": "sqli",
  "severity": "high",
  "target": "https://app.example.com",
  "endpoint": "https://app.example.com/login",
  "parameter": "username",
  "description": "The username parameter is concatenated into a SQL query.",
  "impact": "Authentication bypass and data exfiltration.",
  "payload": "' OR 1=1 --",
  "request_json": "{\"url\":\"https://app.example.com/login\",\"method\":\"POST\",\"headers\":{\"content-type\":\"application/x-www-form-urlencoded\"},\"body\":\"username={{payload}}&password=x\"}",
  "response_json": "{\"status\":200,\"body\":\"...\"}",
  "cwe": "CWE-89",
  "cvss": 9.8
}
```

Findings are deduplicated on target + category + path + parameter + normalized
title. A duplicate merges evidence into the existing record. The `confirmed`
status is set by `verify_finding`; if a caller asks `save_finding` for
`confirmed`, it is stored as a candidate with a warning.

`list_findings` and `get_finding` read the store. The TUI sidebar shows a live
summary.

## Verification

`verify_finding` runs a category oracle:

| Category | Oracle |
| --- | --- |
| `sqli` | boolean true/false difference, status difference, SQL error signatures |
| `xss` | marker reflection in an HTML context, unescaped payload |
| `ssrf` | out-of-band callback from the collaborator |
| `rce` | command output marker or out-of-band callback |
| `path-traversal` | `/etc/passwd` signature in the response |
| `idor` | owner vs non-owner profiles (2xx + denial or materially different body) |
| other | replay with `expect_json` (`status`, `contains`, `notContains`, `maxLength`) |

A `reproduced` result sets `verified: true` and `status: "confirmed"`. A
`not_reproduced` result is not proof that the bug is absent: the target may have
changed. `inconclusive` means the oracle lacked a precondition (for example no
collaborator for SSRF).

Limitations: the XSS oracle proves reflection in an HTML response, not browser
execution. The IDOR oracle is a heuristic and does not prove ownership across
tenants. SQLi timing attacks are not implemented yet.

## Out-of-band collaborator

`collaborator` with `action: "open"` starts an HTTP listener and returns a
unique URL and token. Inject the URL into the target, then call
`collaborator` with `action: "poll"`.

The default URL is local to the container (`127.0.0.1`). For a target that
cannot reach the container, pass `public_base` or set `GREPLEAKS_OAST_URL` to an
externally reachable endpoint (for example a reverse tunnel or the Grepleaks
host). DNS callbacks are not implemented yet.

## Reports

`generate_report` writes a deterministic report from the store:

- `markdown` (default)
- `html` (print-ready; use the browser's Print → PDF for a PDF)
- `json`
- `sarif` 2.1.0

Reports include the engagement metadata, scope, executive summary, findings
sorted by severity, request/response evidence, verification assertions and a
limitations section. Only findings marked verified carry a reproduction record.
Suppressed and false-positive findings stay in the local store but are excluded
from reports.

## Validation

```bash
# Unit and integration tests for the evidence modules.
cd engine/packages/opencode && bun test src/evidence --timeout 30000

# End-to-end workflow without Docker: real engine, mock provider, local SQLi target.
python3 scripts/smoke-evidence.py --local

# End-to-end workflow through the Docker launcher (after building the image).
python3 scripts/smoke-evidence.py
```

The local E2E exercises tool registration, scope allow/deny, duplicate
suppression, SQLi verification, report generation and secret redaction.
