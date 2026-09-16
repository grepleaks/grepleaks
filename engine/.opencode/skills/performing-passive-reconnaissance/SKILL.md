---
name: performing-passive-reconnaissance
description: Phase 1 of the offensive pipeline — build the target's asset universe without sending a single direct request: DNS, certificate transparency, Shodan/Censys, search-engine and GitHub dorks, Wayback Machine, urlscan, and paste sites. Use as the passive intel phase of an engagement, driven by the orchestrating-end-to-end-web-attack skill, before any active discovery.
domain: cybersecurity
subdomain: penetration-testing
tags:
- recon
- passive
- osint
- certificate-transparency
- subdomains
- github-dorks
- wayback
version: '1.0'
author: lucas
license: Apache-2.0
nist_csf:
- ID.AM-06
- ID.RA-10
mitre_attack:
- T1592
- T1595
- T1589.002
---

# Performing Passive Reconnaissance

## Purpose

Map the asset universe **without touching the target**. Passive sources reveal: all subdomains (including dead ones — takeover candidates), the IP footprint, third-party CNAMEs, historical endpoints (Wayback), and leaks in public code (keys, internal hostnames). This is where 50% of the easy wins are already found.

## Inputs

- `00-scope.md` (domain list, in-scope classes)

## Workflow

### 1. DNS

```bash
D=target.com
dig +short @$D A; dig +short @$D MX; dig +short @$D NS
# Zone transfer (rare, free win)
for ns in $(dig +short NS $D); do
  dig +short axfr @$ns $D
done
# Existing subdomains from known lists + DNS brute (still "light")
dig +short www.api.app.admin.dev.staging.old.test.internal.mobile.portal $D | sort -u > 01-passive/subdomains.txt
```

### 2. Certificate Transparency (the main subdomain source)

```bash
# crt.sh (free, no key)
curl -s "https://crt.sh/?q=%.${D}&output=json" | \
  python3 -c "import json,sys; [print(x['name_value']) for x in json.load(sys.stdin) for n in x['name_value'].split(',')] " \
  | tr ' ' '\n' | sort -u >> 01-passive/subdomains.txt
# certspotter (fresh certs)
curl -s "https://api.certspotter.com/v1/issuances?domain=${D}&include_subdomains=true&expand=dns_names" | \
  python3 -c "import json,sys; [print(n) for i in json.load(sys.stdin) for n in i['dns_names']]" | sort -u >> 01-passive/subdomains.txt
sort -u 01-passive/subdomains.txt -o 01-passive/subdomains.txt
wc -l 01-passive/subdomains.txt
```

### 3. CNAME Analysis (takeover candidates — do this NOW, it's free)

```bash
while read s; do
  c=$(dig +short CNAME "$s.$D" | head -1)
  [ -n "$c" ] && echo "$s.$D -> $c"
done < 01-passive/subdomains.txt | sort -u > 01-passive/cnames.txt
```

Flag CNAMEs pointing to: `*.s3.amazonaws.com`, `s3-website-*`, `*.herokuapp.com`, `*.github.io`, `*.fastly.net`, `*.cloudfront.net` (with `d1--` custom), `*.herokudns.com`, `*.netlify.app`, `*.pages.dev`, `*.blob.core.windows.net`, `*.digitaloceanspaces.com`, `*.use1.a.fastly.net`, `*.acm-backup...`, `*.bintray...`, `*.ghost.io`, `*.readme.io`, `*.tumblr.com`, `*.zendesk...` → each goes to `02-active/candidates.md` later. (The takeover test itself is active — done in phase 2.)

### 4. Shodan / Censys (if keys available)

```bash
# Shodan (SHODAN_API_KEY)
curl -s "https://api.shodan.io/dns/domain/$D?key=$KEY" 
curl -s "https://api.shodan.io/host/search?query=hostname:$D&key=$KEY&min=1&limit=100"
# or CLI: shodan host <ip> / shodan search hostname:$D
```
Collect: IPs, open ports, banners, known vulns → `01-passive/ips.txt`, notes in `leaks.md`.

### 5. Search Engine Dorks

Run these (Google/Bing/DuckDuckGo, or `site:` via a search API):
```
site:<D>
site:<D> -www
site:<D> ext:pdf | ext:xls | ext:csv
site:<D> "password" OR "login" OR "admin"
site:<D> staging OR dev OR test OR old OR backup
"<D>" "api" 
"<D>" "s3://" OR "blob.core" OR "gs://"
inurl:<D> admin OR panel OR portal
```
→ interesting URLs to `01-passive/urls.txt`, anything else to `leaks.md`.

### 6. GitHub / GitLab Dorks (leak goldmine)

```
"<D>"
"<D>" extension:env
"<D>" "api_key" OR "apikey" OR "secret"
"<D>" "eyJ"                     # JWTs in code
"<D>" "AKIA"                    # AWS keys
org:<their-org> "<D>"
"<D>" internal OR intranet OR localhost
```
For each hit: check the file. Keys/tokens → `leaks.md` (defang before storing: `AKIA…last4`). Internal hostnames → `subdomains.txt`.

### 7. Wayback Machine (historical attack surface)

```bash
curl -s "http://web.archive.org/cdx/search/cdx?url=*.${D}/*&output=text&fl=original&collapse=urlkey&limit=5000" \
  | sort -u > 01-passive/urls_wayback.txt
grep -iE "admin|staging|old|test|api|v1|v2|backup|internal|debug|php|env|config" 01-passive/urls_wayback.txt
```
Dead URLs (404 today) = forgotten endpoints. Interesting ones → `urls.txt` marked `[wayback]`.

### 8. urlscan.io & Paste Sites

```bash
curl -s "https://urlscan.io/api/v1/search/?q=domain:%22${D}%22&size=50" | \
  python3 -c "import json,sys; [print(r['task']['url']) for r in json.load(sys.stdin)['results']]"
```
Paste sites (pastebin, gists, hastebin): search `<D>` and the brand name → `leaks.md`.

### 9. Write `01-passive/leaks.md`

```markdown
# Leaks — <target>
## Credentials / keys (defanged)
- AKIA…WXYZ in github.com/x/y/.env (line 12) — status: untested
## Internal hostnames
- internal-api.corp (from repo X)
## Interesting URLs
- staging-2.<D> (wayback 2023, now 404?)
## Notes
```

## Output

`01-passive/` with: `subdomains.txt` (union, deduped), `ips.txt`, `cnames.txt`, `urls.txt` (live + wayback), `leaks.md`.

## Gate (before phase 2)

- `subdomains.txt` non-empty (if truly empty: note it, target may be IP-only → adjust in phase 2)
- `cnames.txt` written and third-party CNAMEs flagged
- `leaks.md` written (even if "nothing found" — say so explicitly)
- STATE.md updated → Phase 2
