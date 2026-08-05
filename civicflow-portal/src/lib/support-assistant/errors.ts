/**
 * Stable, machine-readable error codes for the Support Assistant.
 * Mirrors src/lib/labs/meeting-intelligence/errors.ts's pattern.
 */
export const SUPPORT_ASSISTANT_ERROR_CODES = [
  "SUPPORT_ASSISTANT_DISABLED",
  "SUPPORT_ASSISTANT_NOT_ENABLED",
  "SUPPORT_ASSISTANT_VALIDATION_ERROR",
  "SUPPORT_ASSISTANT_RATE_LIMITED",
  "SUPPORT_ASSISTANT_DAILY_LIMIT_REACHED",
  "SUPPORT_ASSISTANT_PROVIDER_TIMEOUT",
  "SUPPORT_ASSISTANT_PROVIDER_RATE_LIMITED",
  "SUPPORT_ASSISTANT_PROVIDER_ERROR",
  "SUPPORT_ASSISTANT_INVALID_PROVIDER_RESPONSE",
] as const;

export type SupportAssistantErrorCode = (typeof SUPPORT_ASSISTANT_ERROR_CODES)[number];

const STATUS_FOR_CODE: Record<SupportAssistantErrorCode, number> = {
  SUPPORT_ASSISTANT_DISABLED: 403,
  SUPPORT_ASSISTANT_NOT_ENABLED: 403,
  SUPPORT_ASSISTANT_VALIDATION_ERROR: 400,
  SUPPORT_ASSISTANT_RATE_LIMITED: 429,
  SUPPORT_ASSISTANT_DAILY_LIMIT_REACHED: 429,
  SUPPORT_ASSISTANT_PROVIDER_TIMEOUT: 504,
  SUPPORT_ASSISTANT_PROVIDER_RATE_LIMITED: 429,
  SUPPORT_ASSISTANT_PROVIDER_ERROR: 502,
  SUPPORT_ASSISTANT_INVALID_PROVIDER_RESPONSE: 502,
};

const RETRYABLE_CODES = new Set<SupportAssistantErrorCode>([
  "SUPPORT_ASSISTANT_PROVIDER_TIMEOUT",
  "SUPPORT_ASSISTANT_PROVIDER_RATE_LIMITED",
  "SUPPORT_ASSISTANT_PROVIDER_ERROR",
]);

export class SupportAssistantError extends Error {
  readonly code: SupportAssistantErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: SupportAssistantErrorCode, message: string) {
    super(message);
    this.name = "SupportAssistantError";
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
    this.retryable = RETRYABLE_CODES.has(code);
  }
}
