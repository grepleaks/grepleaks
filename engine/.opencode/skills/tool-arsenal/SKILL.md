---
name: tool-arsenal
description: >
  Exhaustive nested dictionary of Linux security tools organized by family →
  subcategory → tool, each entry carrying install-on-demand / use / cleanup
  commands. USE this whenever you need to find and run the right tool for a
  pentest situation: load the matching references/<family>.md and follow the
  entry. Pairs with the situation→tool routing skill "selecting-pentest-tooling".
---

# Tool arsenal — nested tool dictionary

**Platform and ownership first.** This catalog lists example commands; it does not
mean the tools are installed or compatible with the current host. Detect the OS and
check existing tools before acting. Installation requires the operator's approval.
Never remove pre-existing software. Cleanup examples apply only to disposable,
operator-approved installations; on a native host, follow AGENTS.grepleaks.md.

## How to use this dictionary

Load the family reference file (`references/<family>.md`) that matches your task, then jump to the subcategory and tool. Each entry has four fields: **what** (when to reach for it) / **install** / **use** / **cleanup**. Read the entry, verify platform compatibility and obtain approval before installation or cleanup.

## Family index

| Family | What is inside (subcategories) | Reference file |
|---|---|---|
| Information Gathering | DNS & subdomains, Host & network discovery, Port & service scanning, OSINT & people, SSL/TLS, SNMP, SMB/NetBIOS enum, Web fingerprinting, Screenshotting & crawling | `references/information-gathering.md` |
| Vulnerability Analysis | Network/host vuln scanners, Web vuln scanners (general), Template-based scanning, CMS scanners, Service-specific scanners, SSL/TLS scanners, Exploit lookup | `references/vulnerability-analysis.md` |
| Web Application Analysis | Intercepting proxies, Fingerprinting & tech detection, Content & directory discovery, Web vulnerability scanners, CMS scanners, Crawling & parameter discovery, API testing, Client-side / specific injection | `references/web-application-analysis.md` |
| Database Assessment | SQL injection, DB clients & enumeration, NoSQL, Oracle-specific | `references/database-assessment.md` |
| Password Attacks | Wordlist generation & lists, Online brute-force, Offline hash cracking, Credential dumping, Hash identification | `references/password-attacks.md` |
| Wireless Attacks | WiFi (802.11), WiFi automation frameworks, Bluetooth, RFID / NFC, SDR (Software Defined Radio) | `references/wireless-attacks.md` |
| Reverse Engineering | Disassemblers & decompilers, Debuggers, Dynamic analysis & tracing, Binary analysis / symbolic execution & ROP, Android / Java bytecode, Strings / hex & ELF/PE inspection, Packers & format identification | `references/reverse-engineering.md` |
| Exploitation Tools | Frameworks, Exploit databases, Payload generation & evasion, Specific exploitation, Browser/social | `references/exploitation-tools.md` |
| Sniffing & Spoofing | Packet capture & analysis, Man-in-the-middle (MITM), Network spoofing & poisoning, SSL/TLS interception, Traffic replay & injection | `references/sniffing-spoofing.md` |
| Post Exploitation | Privilege escalation — Linux, Privilege escalation — Windows, Pivoting & tunneling, Credential dumping & AD attacks, Persistence & lateral movement, Loot & exfil helpers | `references/post-exploitation.md` |
| Command & Control (C2) | C2 frameworks, Application-layer channels (HTTP/DNS), Protocol tunneling & covert channels | `references/command-and-control.md` |
| Active Directory Attacks | Enumeration, Kerberos attacks, Credential dumping & relay, Cartography (BloodHound), ADCS & coercion | `references/active-directory.md` |
| Cloud & Container | Multi-cloud enumeration & auditing, AWS, Azure, GCP, Kubernetes & containers, IaC & secrets scanning | `references/cloud-and-container.md` |
| Mobile Application Analysis | Android static analysis, Android dynamic analysis, iOS, Instrumentation & device, App acquisition & signing, Automated analysis frameworks | `references/mobile.md` |
| Digital Forensics | Disk imaging & cloning, File carving & recovery, Memory forensics, Filesystem & OS artifacts, Document/PDF forensics, Network forensics, Anti-rootkit, Integrity / hashing & timelines | `references/forensics.md` |
| Social Engineering | Phishing frameworks, Credential harvesting & AiTM proxy, Payloads & maldocs (pretext delivery), OSINT & pretext research, Email delivery & spoofing | `references/social-engineering.md` |
| Fuzzing | Coverage-guided binary fuzzers, Protocol/network fuzzers, File format fuzzers, Web fuzzers | `references/fuzzing.md` |
| Cryptography & Steganography | Steganography, Metadata & carving, Crypto attacks, Encoding & analysis | `references/crypto-stego.md` |
| Hardware & Embedded / IoT | Firmware analysis & extraction, Firmware emulation & security scanning, Flash & chip, Serial / JTAG / bus, Logic analysis, RF & SDR | `references/hardware-embedded.md` |

---

For quick **situation→tool routing** (which tool to pick, not how each one works), load the sibling skill **"selecting-pentest-tooling"**.
