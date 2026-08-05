// Client-safe (no server-only imports) so both the API route/service layer
// and the termination dialog can share one source of truth for the reason list.
export const TERMINATION_REASONS = [
  { value: "MOVED_RELOCATED", label: "Moved / relocated" },
  { value: "RESIGNED_VOLUNTARY", label: "Resigned voluntarily" },
  { value: "NONPAYMENT_OF_DUES", label: "Non-payment of dues" },
  { value: "GOVERNING_DOCUMENT_VIOLATION", label: "Violation of governing documents / bylaws" },
  { value: "DECEASED", label: "Deceased" },
  { value: "NO_LONGER_ELIGIBLE", label: "No longer eligible for membership" },
  { value: "OTHER", label: "Other" },
] as const;

export type TerminationReasonCode = (typeof TERMINATION_REASONS)[number]["value"];
