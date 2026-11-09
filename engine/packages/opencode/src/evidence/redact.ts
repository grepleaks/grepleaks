/**
 * Redaction for HTTP evidence. Token, cookie and password values must never be
 * persisted in findings or rendered in reports.
 */

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i
const SENSITIVE_NAME = /(token|secret|password|passwd|api[_-]?key)/i

export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = SENSITIVE_HEADER.test(key) || SENSITIVE_NAME.test(key) ? "[redacted]" : value
  }
  return result
}

export function redactText(value: string | undefined): string | undefined {
  if (!value) return value
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)\s*[:=]\s*[^\s,;]+/gi, "$1: [redacted]")
    .replace(/([?&](?:token|access_token|id_token|refresh_token|api[_-]?key|password|secret)=)[^&\s]+/gi, "$1[redacted]")
}
