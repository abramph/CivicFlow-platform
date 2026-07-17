/**
 * Redacts known-sensitive keys from arbitrary JSON metadata before it is
 * ever rendered in the Operations Center audit view. Applied to
 * AuditEvent.before/after (Json?) and anywhere else provider-adjacent
 * metadata might carry a secret-shaped field.
 *
 * Deny-list, not allow-list: audit metadata shapes vary across ~15 action
 * types, so a fixed field allow-list would silently miss a new sensitive
 * field added later. Instead, redact by *key name pattern* — this must stay
 * defensive as new action types are added.
 */

const SENSITIVE_KEY_PATTERN =
  /password|passwordhash|secret|token|apikey|api_key|authtoken|auth_token|credential|cookie|session|signature|webhooksecret|webhook_secret|privatekey|private_key|clientsecret|client_secret|accesstoken|access_token|refreshtoken|refresh_token/i;

const REDACTED = "[redacted]";

/** True if a field name looks like it holds a secret, regardless of casing/separators. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Deep-redacts an arbitrary JSON value (as stored in AuditEvent.before/after).
 * Non-object inputs pass through unchanged. Arrays are walked element-wise.
 * Never mutates the input.
 */
export function redactSensitiveFields(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[max depth exceeded]";

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = redactSensitiveFields(val, depth + 1);
      }
    }
    return result;
  }

  return value;
}

/** Convenience wrapper for AuditEvent.before/after, which are `Json | null`. */
export function redactAuditMetadata(metadata: unknown): unknown {
  if (metadata === null || metadata === undefined) return metadata;
  return redactSensitiveFields(metadata);
}
