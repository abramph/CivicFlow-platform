# Flexible Organization Payment Links

Part B of the 2026-08-05 "Support Assistant and Flexible Payment Links" program.
Design decisions only — implementation follows this document.

## What audit found

- **`PaymentMethodConfig` already exists and is exactly the "organization
  payment-method configuration" this feature needs** (`prisma/schema.prisma:1089`):
  `{organizationId, method: DuesPaymentMethod, label, instructions, accountIdentifier,
  notes, isActive, sortOrder}`, unique on `(organizationId, method)`. `DuesPaymentMethod`
  already includes `CASH, CHECK, CREDIT_CARD, DEBIT_CARD, CARD, ACH, ZELLE, CASH_APP,
  VENMO, PAYPAL, STRIPE, ZEFFY, PAYROLL_CHECKOFF, OTHER`. `ensureDefaultPaymentMethods()`
  (`src/lib/payment-methods.ts`) already seeds one row per method (including an active
  `STRIPE` row) for any org that visits Settings → Payment Methods. **This PR does not
  create a competing config model** — it reuses `PaymentMethodConfig` as-is and adds one
  small join table connecting it to `PaymentLink`.
- **`PaymentMethodConfig` today only labels manually-recorded payments and drives a
  member-facing "Ways to Pay" display** (`PayableMethodsList.tsx`) — it has never been
  connected to `PaymentLink` or the Stripe checkout flow at all. That connection is
  this PR's actual new work.
- **`PayableMethodsList.tsx`'s `buildPayLink()`** already synthesizes Cash App/Venmo/
  PayPal universal-link URLs from an `accountIdentifier`, and already treats a
  staff-entered `https://` URL as a direct link — this is the existing precedent for
  "external redirect" payment methods, reused (and hardened — see URL Safety below)
  rather than reinvented.
- **The public Stripe-only flow is a single file pair**: `src/app/pay/[slug]/page.tsx`
  (server component, `PublicPaymentForm` client component) and
  `src/app/api/pay/[slug]/checkout/route.ts` (creates a Stripe Checkout session
  unconditionally — never checks whether the org actually has Stripe configured or
  wants it offered on this link).
- **The Stripe webhook** (`src/app/api/webhooks/stripe/route.ts`) creates a `Contribution`
  row on `checkout.session.completed` for the public-link path (a separate,
  authenticated `/api/member-portal/dues/checkout` path stamps `memberId` into
  metadata and applies to dues instead — untouched by this PR).
- **`PaymentReport` (member self-report → officer approval) is the existing
  offline-payment pipeline** — but `memberId` is a required field with a required
  relation, and its approval flow is wired to member-timeline events and member push
  notifications. It is fundamentally member-account-shaped and does not fit an
  anonymous public payer. Rather than loosen a required field on a working,
  authenticated flow, this PR adds one small, purpose-built, additive model for
  anonymous offline reports (see below) that reuses the *same* Contribution-creation
  and officer-notification pattern without touching `PaymentReport` itself.
- **No `payment_link`-specific RBAC permission exists** — all `PaymentLink` routes
  already reuse `contributions:read`/`contributions:write`. This PR keeps that
  (see RBAC below) and adds one permission for reviewing offline reports.
- **No existing external-URL safety layer** — `src/lib/deep-links.ts` only validates
  internal app-destination paths; `buildPayLink()`'s own `https://` passthrough has no
  host/protocol hardening beyond a bare regex. This PR adds one.

## Final product model

A **Payment Link** stays exactly what it is today (`PaymentLink` — title, description,
purpose, amount rules, attribution, expiration) — no changes to that model. What it
*offers* becomes configurable via a new join:

```
PaymentLinkMethod {
  id, paymentLinkId, paymentMethodConfigId
  @@unique([paymentLinkId, paymentMethodConfigId])
}
```

No snapshotting: a `PaymentLinkMethod` row is a live reference to the org's current
`PaymentMethodConfig` row, not a copy of its instructions. A payment link is a
short-lived, campaign-scoped artifact (not a permanent historical record the way a
receipt is) — if an org edits their Venmo handle, every link offering Venmo should show
the current handle, not a stale one. Storing a snapshot would duplicate data for no
real integrity benefit here (contrast with `ContributionReceipt`, which *does* need to
freeze historical values).

**Category is derived from the existing `method` enum, not a new column**:
- **Native online payment**: `STRIPE`
- **External redirect**: `PAYPAL`, `VENMO`, `CASH_APP` (has a real universal-link URL,
  or a staff-entered `https://` URL for any method)
- **Offline instructions**: `CASH`, `CHECK`, `ACH`, `ZELLE`, `PAYROLL_CHECKOFF`, `OTHER`,
  `CREDIT_CARD`/`DEBIT_CARD`/`CARD` (legacy, generic card labels with no processor)

## New model: anonymous offline payment report

```
PaymentLinkOfflineReport {
  id, organizationId, paymentLinkId, paymentMethodConfigId
  payerName, payerEmail, amount, referenceNumber?, message?, proofAttachmentId?
  status: pending | approved | rejected   (reuses PaymentReportStatus)
  reviewedById?, reviewedAt?, rejectionReason?
  resultingContributionId?   (set on approval)
  createdAt, updatedAt
}
```

Mirrors `PaymentReport`'s approve/reject shape closely enough to reuse its UI
conventions, but is a distinct model because its subject is a public payer (name/email
strings), not an `OrgMember`, and its outcome is always a `Contribution` (a payment
link's offline report is never "applied to a member's dues charge" the way a member's
own self-report can be — a payment link has no member context to apply dues against).
Approval creates a `Contribution` (`source: "MANUAL"`, same shape the Stripe webhook
already uses for the online public path) and records `resultingContributionId` for
traceability. Reuses the `Attachment` model for proof upload (same pipeline as every
other attachment in this app).

## Payment behavior by category

- **Stripe**: unchanged Checkout-session creation, now gated on the link actually
  having a `PaymentLinkMethod` pointing at the org's active `STRIPE`
  `PaymentMethodConfig` row (previously unconditional).
- **External redirect**: the public page shows a "Pay with {label}" button/link built
  from the *hardened* version of `buildPayLink()` (below), opening in a new tab with an
  explicit "you're leaving Unestra" notice. Unestra does not know whether the payment
  completed — no automatic reconciliation, matching the task's explicit instruction.
- **Offline instructions**: the public page shows the org's `instructions`/
  `accountIdentifier` text and a "I've made this payment" button that opens the offline
  report form. Submitting creates a `pending` `PaymentLinkOfflineReport` and notifies
  the org's FINANCE/ORG_ADMIN/ORG_OWNER members (same notification pattern as
  `createPaymentReportAndNotify`). It is never marked paid until an officer approves it.

## URL safety (hardened `buildPayLink`)

Extracted to a shared `src/lib/payment-method-links.ts`, used by both the existing
`PayableMethodsList` and the new public payment page:
- Parses with `new URL()` rather than a bare regex — rejects anything that doesn't
  parse as an absolute URL.
- Protocol allowlist: `https:` only (`http:` rejected — every real-world payment
  processor link is https; this closes the door on `javascript:`/`data:`/`file:` etc.
  outright rather than trying to blocklist them).
- No new host allowlist for staff-entered custom URLs (an org may legitimately link to
  any processor) — but the public page always shows an explicit interstitial notice
  ("You're leaving Unestra to pay via {label} at {hostname}") so the payer sees exactly
  which external host they're about to visit before clicking through, and the link
  itself uses `rel="noopener noreferrer"`.

## Reports/reconciliation honesty

- **Stripe**: unchanged, fully automatic via the existing webhook.
- **External redirect**: no reconciliation at all — the public page and dashboard are
  explicit that Unestra has no visibility into whether these were completed.
- **Offline instructions**: `pending` until officer review; the payer's own
  confirmation ("I've made this payment") is explicitly worded as a submission for
  review, not a receipt — no `ContributionReceipt` exists until approval creates the
  `Contribution` and a receipt is separately, manually generated exactly like today's
  process for every other `Contribution`.

## RBAC

- `PaymentLink`/`PaymentLinkMethod` management: unchanged, still
  `contributions:read`/`contributions:write` (no new permission — this is additive
  configuration on an existing, already-permissioned resource).
- Configuring which methods an org *offers at all* (`PaymentMethodConfig` itself):
  unchanged, still `org_settings:read`/`org_settings:write`.
- Reviewing/approving a `PaymentLinkOfflineReport`: new permission
  `PAYMENT_LINK_REPORTS_REVIEW` ("payment_link_reports:review"), granted to the same
  roles that already review member `PaymentReport`s (`ORG_OWNER`, `ORG_ADMIN`,
  `FINANCE`) — mirrors the existing `dues:write` gate on `PaymentReport` approval, kept
  as a distinct permission rather than reusing `dues:write` since an offline
  payment-link report isn't necessarily dues-related.

## Migration and backward compatibility

Every existing `PaymentLink` row implicitly means "Stripe only" today. The migration:
1. For every organization with at least one `PaymentLink`, run
   `ensureDefaultPaymentMethods()` (idempotent — safe even if already run).
2. For every existing `PaymentLink`, create one `PaymentLinkMethod` row pointing at
   that org's `STRIPE` `PaymentMethodConfig` row.

After migration, every existing link behaves identically to today (Stripe Checkout,
same URL, same `useCount`/attribution/expiration/status) — the only change is that
behavior is now explicit (`PaymentLinkMethod` row) instead of implicit (hardcoded).

## Deliberately not built in this PR

Automatic reconciliation for external-redirect methods (no processor integration
exists to check); a new HOA assessment ledger (payment links stay general-purpose);
per-method "confirmation behavior"/"requires review" toggles on `PaymentMethodConfig`
(every offline report already universally requires officer review today, matching
existing `PaymentReport` behavior — no per-method override needed); mobile-native
payment-link handling (the mobile-web `/m/` pages already render payment links as
plain external links, unchanged); a host allowlist for staff-entered external URLs
(explicit user-facing interstitial notice is the chosen mitigation instead, since a
legitimate org may link to any real processor).
