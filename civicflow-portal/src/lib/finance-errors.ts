/** PTA-H Finance Lite — typed error for budget/reimbursement operations,
 * mapped to HTTP by withApiErrorHandling (same pattern as
 * GovernanceDocumentError / MeetingOperationError). */
export class FinanceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "FinanceError";
    this.status = status;
  }
}
