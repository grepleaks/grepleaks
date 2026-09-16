---
name: performing-active-discovery
description: Phase 2 of the offensive pipeline — turn the passive asset list into a live attack map: validate subdomains, scan ports, crawl and spider every web asset, mine JavaScript bundles for endpoints and secrets, discover APIs (OpenAPI/GraphQL), fingerprint tech stacks, and confirm takeover candidates and unauthenticated endpoints. Use as the active discovery phase of an engagement, driven by the orchestrating-end-to-end-web-attack skill.
domain: cybersecurity
subdomain: penetration-testing
tags:
- recon
- active
- subdomain-enumeration
- crawling
- javascript-mining
- api-discovery
- fingerprinting
version: '1.0'
author: lucas
license: Apache-2.0
nist_csf:
- ID.AM-06
- ID.RA-01
mitre_attack:
- T1595.003
- T1595.002
- T1046
---

# Performing Active Discovery

## Purpose

The passive phase gave you names; this phase tells you what's ALIVE and what it DOES. End of phase = you know every live asset, what tech runs on it, what endpoints exist (including the ones not linked from the homepage), and a shortlist of hot candidates (takeovers, unauth endpoints, leaked keys to verify).

## Inputs

- `01-passive/subdomains.txt`, `ips.txt`, `cnames.txt`, `urls.txt`, `leaks.md`
- `00-scope.md` (noise budget, port policy)

## Workflow

### 1. Validate Subdomains (who's alive?)

```bash
# Fast: DNS resolve + HTTP status + title + tech
subfinder -d target.com -silent -all | httpx -silent -status-code -title -tech-detect -follow-redirects -o 02-active/live.txt
# Fallback without subfinder: use 01-passive/subdomains.txt directly with httpx
cat 01-passive/subdomains.txt | httpx -silent -status-code -title -tech-detect -o 02-active/live.txt
```

Classify the results: `live.txt` → web apps / APIs / dead-but-DNS (A record, no web) / redirectors. Dead-but-DNS with a CNAME = takeover candidate (Step 5).

### 2. Port Scan (per live IP, respect the scope)

```bash
# Quick (top 100) for everything, full for key assets
nmap -sV --top-ports 100 -Pn <ip>
# Full + scripts on in-scope key IPs (with user's OK if prod)
nmap -sV -p- --min-rate 3000 -Pn --script smb-os-discovery,ssl-cert,http-title,http-enum <ip>
```
Record in `02-active/ports.md`: IP, service, version, anything unusual (exposed DBs, old SSH, unfiltered admin panels, `8080/8443/9090` side doors).

### 3. Crawl Every Live Web Asset

For each web asset in `live.txt`:

```bash
# JS-aware crawler (preferred)
katana -u https://app.target.com -d 3 -jc -kf all -aff -o 02-active/crawl-app.txt -H "Cookie: <test1 session>"
# Fallback: gau (passive+active URLs) + httpx
gau --subs app.target.com | sort -u | httpx -silent -mc 200,301,302,401,403,404,500 -o crawl-app.txt
```

Crawl twice if the app has an authenticated area: once anon, once logged in (cookie from test1). The logged-in crawl is where the real endpoints live.

Collect all JS URLs from the crawl, download the bundles:
```bash
grep -oE "https?://[^\"' ]+\.js" 02-active/crawl-app.txt | sort -u > js_urls.txt
mkdir -p js_files && xargs -n1 -P8 curl -s -O - js_files/ < js_urls.txt
```

### 4. JavaScript Mining (the 30 minutes that pay)

```bash
for js in js_files/*.js; do
  echo "=== $js"
  # Endpoints
  grep -oE '"/(api|v[0-9]|admin|internal|debug)/[a-zA-Z0-9/_.-]*"' "$js" | sort -u
  grep -oE 'https?://[a-zA-Z0-9.-]+(\.[a-zA-Z0-9-]+)+' "$js" | sort -u   # absolute hosts
  # Secrets & config
  grep -inE "(api[_-]?key|apikey|secret|token|passwd|password|jwt|bearer|private[_-]?key)['\"]?\s*[:=]" "$js" | head
  # Cloud
  grep -oE "[a-z0-9-]+\.(s3|s3-website|blob|storage)\.[a-z0-9.-]+" "$js"
  # OAuth / SSO
  grep -oE "client_id['\"]?\s*[:=]\s*['\"][^'\"]+" "$js"
  # WebSockets / GraphQL
  grep -oE "wss?://[a-zA-Z0-9./-]+|/graphql[a-zA-Z0-9/-]*" "$js" | sort -u
done > 02-active/js-endpoints.txt
```

Every new hostname → validate (is it in scope? live?). Every key → to `candidates.md` (test in phase 5, don't test in recon — keep noise down).

### 5. Takeover Confirmation (the cheap criticals)

For each flagged CNAME (from `01-passive/cnames.txt`) and each dead subdomain:

```bash
dig +short CNAME staging.target.com
# Then check the provider: is the resource actually claimed?
# S3:        curl -sI https://staging.target.com | grep -i "server|x-amz"  → "NoSuchBucket" or "Amazon S4" with no custom domain = dangling
# Heroku:    title "There is nothing here"
# GH Pages:  "404 This page exists if you claim it"
# CloudFront: "The domain name does not exist" / "No distribution for this cloudfront domain"
# Azure blob: 404 + "The specified container does not exist"
```
Each confirmed dangling CNAME → top of `02-active/candidates.md`. (Exploitation = `exploiting-broken-link-hijacking` in phase 5.)

### 6. API Discovery

```bash
# OpenAPI / docs (anon + logged in)
for p in openapi.json swagger.json swagger.yaml api-docs api/docs docs graphql graphiql apollo _catalog v1 v2 v3 health metrics debug; do
  for h in api.target.com app.target.com; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "https://$h/$p")
    [ "$code" != "404" ] && [ "$code" != "000" ] && echo "$code https://$h/$p"
  done
done
# ffuf on API host for verb+path patterns if you have a wordlist
ffuf -u "https://api.target.com/FUZZ" -w api_paths.txt -mc 200,401,403,500 -t 20
# GraphQL probe
curl -s -X POST https://api.target.com/graphql -H 'Content-Type: application/json' -d '{"query":"{__schema{types{name}}}"}' | head -c 300
```
Dump any OpenAPI spec to `02-active/api-map.md` (endpoints, auth schemes, interesting params).

### 7. Fingerprinting (per asset)

```bash
curl -sI https://app.target.com/ | grep -iE "server|x-powered-by|via|set-cookie|x-request-id|x-amz|x-served-by|cf-ray|report-to"
```
Write `02-active/fingerprints.md` per asset:
- CDN/WAF (Cloudflare? Akamai? AWS WAF? — changes which bypass skills matter)
- Web server + framework hints (X-Powered-By, error pages, cookie names: `JSESSIONID`=Java, `PHPSESSID`=PHP, `csrftoken`=Django, `connect.sid`=Node)
- Auth model observed (session cookie? JWT in header? basic?)
- Error style (verbose 500s = information disclosure + injection hints)

### 8. Unauthenticated Endpoint Sweep (quiet)

From crawl + js-endpoints + api-map: hit every endpoint ANON with GET (and OPTIONS). Log anything that returns 200 with content or a verbose 4xx/5xx → `candidates.md`. A 200 on a user-data endpoint without auth is already a finding.

### 9. Write `02-active/candidates.md`

```markdown
# Candidates (hot list for phase 5)
| # | Candidate | Evidence | Why hot | Test skill |
|---|-----------|----------|---------|------------|
| 1 | staging.target.com → s3 bucket | curl: NoSuchBucket | takeover | exploiting-broken-link-hijacking |
| 2 | /api/v1/users/422 anon 200 | crawl | IDOR/BAC unauth | exploiting-idor-vulnerabilities |
| 3 | AWS key AKIA…WXYZ (repo) | js-mining | verify + S3 audit | auditing-aws-s3-bucket-permissions |
```

## Output

`02-active/`: `live.txt`, `ports.md`, `crawl-<asset>.txt`, `js-endpoints.txt`, `api-map.md`, `fingerprints.md`, `candidates.md`.

## Gate (before phase 3)

- Every live web asset was crawled (anon, + logged-in where an account exists)
- Every CNAME flagged in phase 1 has a takeover verdict
- `candidates.md` exists (even if short)
- STATE.md → Phase 3
