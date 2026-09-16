---
name: bypassing-two-factor-authentication
description: Bypass 2FA/MFA via token replay, response manipulation, missing re-authentication on sensitive actions, TOTP weaknesses, MFA fatigue, and backup-code flaws to achieve account takeover. Use when a target uses TOTP, SMS, push, or WebAuthn as a second factor during a bug bounty or identity security assessment.
domain: cybersecurity
subdomain: identity-security
tags:
- 2fa
- mfa
- totp
- sms
- push
- webauthn
- mfa-fatigue
- account-takeover
- bug-bounty
version: '1.0'
author: lucas
license: Apache-2.0
nist_csf:
- PR.AA-03
- PR.PS-01
- PR.DS-10
mitre_attack:
- T1556
- T1110.003
---

# Bypassing Two-Factor Authentication

## Overview

2FA is frequently implemented as a gate that checks "a valid second factor was presented once" — not "the account is continuously protected". The classic gaps: the first factor's session survives the second, tokens replay, the second factor can be removed without re-authentication, and the response that says "MFA passed" is client-controlled.

## When to Use

- Login, sensitive actions, or API flows that demand TOTP/SMS/push/WebAuthn
- Profile/settings pages that manage MFA enrollment
- Targets advertising "secure login with 2FA"

## Prerequisites

- Test account with MFA enabled (TOTP app, or a number you control for SMS)
- Burp Suite (Repeater, Turbo Intruder), `oathtool` (TOTP), `totp.js` for browser
- A second account for session comparison

## Step 1: Map the MFA Flow

1. Log in and capture every request: which endpoint validates the code (`POST /2fa/verify`), what it returns (a cookie? a flag in JSON? a new session?), and which actions re-trigger MFA.
2. Note the factor type: TOTP (30s codes), SMS (6 digits), push (approve/reject), WebAuthn (security key), email link.
3. Determine: is MFA checked at login only, or per-action? Is there a "remember this device for 30 days" (skip token — steal it)?

## Step 2: Token Replay & Lifetime

- Use the same TOTP code **twice** (two logins in the same 30s window).
- Use a code from the **previous** time window (is clock skew > 1 step allowed?).
- After logging in, log out and log in again with the same code.
- If MFA returns a "skip" cookie/token (device trust): does it bind to anything (IP, UA, hardware ID)? Steal/reuse it from another session.
- SMS: codes are often 6 digits with no rate limit → brute force (`ffuf` on the verify endpoint, 1M combos; check lockout).

## Step 3: Response Manipulation

The `verify` response is the trust boundary. In Burp Repeater:
- Delete the success field: `{"success":true}` → `{"success":false}` — does the client proceed anyway? (Client-side check = full bypass.)
- Add/modify: `{"mfa_required":false}`, `{"two_factor":0}`, `{"admin":true}`.
- JSON comment: `{"success":true} //` on backends that don't strictly parse.
- Swap the MFA session cookie with a pre-MFA one and see which cookie the app trusts.
- If the flow returns a temporary "MFA passed" JWT: apply standard JWT attacks (alg none, weak secret, missing `exp`).

## Step 4: Missing Re-Authentication

The highest-value logic checks — do these actions require re-auth (password + 2FA) or just a session?
- Change email / phone number (→ new password reset target, new SMS target)
- **Disable or remove 2FA**
- Change password (without re-auth, with a dying session)
- Add a recovery device / backup codes
- Add a trusted device
- Invite an admin / change role

Test: log in (with 2FA), go straight to settings, perform the action. If allowed → chain to ATO.

## Step 5: MFA Fatigue (Push)

For push-based MFA (Duo, built-in):
```bash
# Loop the "send push" endpoint from the login screen
for i in $(seq 1 50); do
  curl -s -X POST "https://target.com/2fa/send" \
    -H "Content-Type: application/json" \
    -d '{"email":"victim@target.com"}' &
done; wait
```
(Or Burp Turbo Intruder, 20–50 req/s for a minute.) If the user approves **any** notification in the flood → MFA passed. Variants: approve-then-reject loops, "don't ask again" options in the prompt.

## Step 6: TOTP-Specific

- Secret strength: if the app shows the TOTP secret in settings (often as an image or base32 string), check if it's predictable/short.
- Brute force a weak secret: `oathtool --base32 -w 16 SECRET` generates codes; or enumerate secrets if the endpoint is guessable.
- Server without counter/sync: codes from a stale clock are accepted → wider window to guess.
- QR code exposure: the enrollment QR (containing the secret) served without auth?

## Step 7: Backup Codes

- Are backup codes shown in an API response after generation (force-browse `/mfa/backup-codes`)?
- Does using one code invalidate the rest?
- Can you re-download the full list repeatedly?
- Format: long random strings (good) vs short/sequential (brute force).

## Step 8: WebAuthn / FIDO2

- Check `userVerification` requirement: if not "required", the authenticator may accept without biometric/PIN.
- Cross-origin: register a key on an attacker origin? (Relies on `rpID`/`origin` checks.)
- Transport: WebAuthn over plain HTTP (not just HTTPS)?
- Test with two authenticators: does the second factor bind to a credential ID (can't be swapped)?

## Step 9: SMS-Specific

- Change the phone number in profile (Step 4) and reset the password via SMS.
- Check if the SMS endpoint accepts international formats / E.164 normalization bugs (`+15551234567` vs `15551234567` reaching different logic).
- SS7/carrier interception exists but is rarely demonstrable in a bounty — report it as a risk note, not the primary finding.

## Tools

| Tool | Use |
|---|---|
| Burp Repeater/Turbo Intruder | replay, manipulation, fatigue |
| oathtool / totp.js | generate test TOTP codes |
| ffuf | SMS code brute force |
| jwt_tool | MFA "passed" tokens |

## Reporting Tips

ATO bypassing MFA = **Critical/High**. Structure: (1) normal MFA flow baseline, (2) the exact manipulated request, (3) the resulting authenticated session as a different state than expected (e.g. logged in without code, 2FA removed, new phone set). For MFA fatigue, include the request rate and the approved push.
