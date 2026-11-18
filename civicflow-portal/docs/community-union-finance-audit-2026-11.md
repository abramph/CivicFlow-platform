# Community and Union membership / finance code audit — 2026-11-18

Scope: code inspection only, `main`. **No tests executed, no production data accessed.**

## Existing protections
- `src/app/api/payments/imports/route.ts` requires `dues:read` to list imports and `dues:write` to upload, rate-limits uploads, caps CSV text at 50 MiB, and derives organization ID from authenticated permission context.
- `src/lib/payment-reconciliation.ts` scopes member and dues-charge lookups by organization ID before posting.
- `src/app/api/member-portal/dues/checkout/route.ts` derives member ID from the authenticated member session; creates pending payment record before Stripe checkout and stores org/member identifiers server-side.
- `src/lib/dues-accrual.ts` limits organization-wide generation to that organization's members and checks for an existing period charge.

## Findings to validate/fix before finance release

### P1 — imported contribution campaign/event IDs not verified against organization
`postPaymentImportItem` checks member ownership, but `input.campaignId || item.matchedCampaignId` and `input.eventId || item.matchedEventId` are written to `contribution.create` without an explicit same-organization lookup. Depending on database constraints, a foreign-organization reference may be accepted or rejected. Enforce tenant ownership for both references and test with cross-org IDs.

### P1 — concurrent posting of the same import item
`postPaymentImportItem` checks `verificationStatus` before starting a transaction, then creates a dues payment/contribution and updates the import item inside a transaction without a conditional claim. Two concurrent requests could both observe VERIFIED and create duplicate financial records. Use a transaction-local compare-and-swap/conditional update, plus concurrency regression test.

### P1 — dues charge balance race
For imported dues payments, code reads `charge.amountPaid` before the transaction and writes a computed total inside it. Concurrent posts to the same charge can lose an increment and misstate payment status. Re-read/lock or use atomic increment and recompute status safely, then test parallel posts.

### P2 — CSV parser multiline quoted fields
`parsePaymentCsv` splits input by newline before parsing quotes. Legitimate CSV rows with quoted multiline memo fields may split into extra payment rows. Adopt a CSV parser that supports quoted newlines and add fixtures.

### P2 — duplicate import handling / batch reporting
`paymentImportItem.upsert` deduplicates by `(organizationId, sourceType, externalTransactionId)` with `update: {}`. Re-uploading a known transaction into a new batch leaves the new batch without that item. Confirm this is intended and display explicit duplicate/skipped counts rather than implying all rows imported.

### P2 — accrual period date arithmetic
`addMonths` uses JavaScript Date constructor with the original day number; Jan 31 + 1 month may overflow into March rather than February. Validate monthly and quarterly billing at month ends, leap years, and timezones. Existing-charge check is a read-then-create pattern; verify uniqueness constraint/idempotency under concurrent runs.

## Required staging scenarios
1. Two concurrent POST actions on one verified import item result in exactly one posted payment.
2. Two different import items pay the same dues charge concurrently: both payments counted; final status and amount correct.
3. Foreign-org campaign/event IDs are rejected with no contribution created.
4. Re-upload same payroll-checkoff transaction: no duplicate payment, visible duplicate count.
5. Quoted CSV memo with newline parses as one row.
6. Jan 31 monthly dues accrual, Feb 29 leap-year, quarterly period boundaries.
7. Cross-organization member and dues charge references rejected.
8. Stripe checkout payment amount, processing cost, and webhook ledger reconciliation verified in Stripe test mode.

## Release decision
**Not yet finance-release-ready.** These are potential defects inferred from code; confirm with tests and review data-model constraints before changing financial logic. No live financial records should be used for testing.
