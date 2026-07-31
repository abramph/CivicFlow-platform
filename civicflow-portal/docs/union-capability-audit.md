# Unestra Union — Capability Audit and Thin-Vertical Boundary

## Product boundary (the reason this document exists)

**UnionFlow is a separate, sibling APH Technologies product — not a module, edition, or vertical of Unestra.** Its own repository (`abramph/unionflow`), its own PostgreSQL/Prisma schema, its own authentication, its own customer base. This is stated as an explicit, authoritative architectural decision in `unestra-labs`'s `docs/architecture/aph-technologies-product-architecture.md`, written specifically to correct an earlier framing error that described UnionFlow as running "under" Unestra.

UnionFlow's existing schema already models real union governance and case-management concepts: `Grievance`, `DisciplineCase`, `Case`, `GrievanceDocument`, `Committee`, `Officer`, `StaffRep`, `ShopSteward`, `Vote`/`Election`, `Branch`/`District`/`BargainingUnit`, and a legacy `UnionRole` enum (steward, investigator, committee_chair, etc.). There is also an ADR-backed integration plan (`unestra-labs` ADRs 0052–0067) for how Labs should eventually connect Unestra to UnionFlow — via a **read-only shadow adapter**, explicitly not by rebuilding UnionFlow's domain inside Unestra.

**Decision: Unestra's `UNION` vertical stays thin.** It does not, and will not, duplicate grievances, stewards, committees, contracts, representation cases, or any other union operational workflow. Those remain UnionFlow's exclusive domain. Unestra's `UNION` vertical is, and remains, a relabeled experience built entirely on Unestra Core (dues, members, events, meetings, communications, reports) — see `docs/vertical-experience-layer.md`'s "Known limitations": *"Union and HOA have zero dedicated business logic — by design."* This audit does not change that.

## What a real union administratively needs, and how it maps

| Need | Disposition |
|---|---|
| Dues collection and tracking | **Reused, unchanged** — `DuesAccount`/`DuesCharge`/`DuesPayment`. |
| Member classification (active/retired/apprentice/journeyman) | **Reused, unchanged** — the existing per-organization `Category` model (`type: MEMBERSHIP`), the same mechanism every other vertical already uses. No new model. |
| Meetings, minutes, governance | **Reused, unchanged** — `Meeting`, `Attachment` (minutes). |
| Communications/announcements | **Reused, unchanged** — `CommunicationCampaign`. |
| Contract/document storage (a CBA PDF, side letters) | **Reused, unchanged** — the existing generic `Attachment` model (`entityType: ORGANIZATION` or `OTHER`) is sufficient for simple file storage. Structured contract *lifecycle* (effective/expiration dates, covered bargaining units, versioning) is explicitly **not** modeled here — that is exactly the kind of governance concept that belongs to UnionFlow's `Contract` model, not a parallel one in Unestra. |
| **Employer payroll-deduction dues ("checkoff"), remitted in bulk** | **The one approved gap — addressed by this PR.** Notably, UnionFlow's own schema has **no dues/payments model at all** (confirmed by `unestra-labs`'s read-only compatibility review of the `unionflow` repo — "no transaction model," called out as a real, current gap in that product). Unestra already has the strongest dues/payment infrastructure in the family; extending it to accept a bulk employer-remitted payment source is a genuine, low-risk strength to build on, not a duplication of anything UnionFlow already owns. |
| Grievances, discipline cases | **Explicitly out of scope, permanently.** UnionFlow's domain. |
| Stewards, committees, officer/representation roles | **Explicitly out of scope, permanently.** UnionFlow's domain — Unestra already has generic `Role`/`OrgRolePermissionSet` for its own staff permissions, which is a different concern from UnionFlow's representation-role modeling. |
| Elections/voting | **Explicitly out of scope, permanently.** UnionFlow's domain. |
| Bargaining units / worksites / branches | **Explicitly out of scope, permanently.** UnionFlow's domain (`BargainingUnit`, `Branch`, `District`). |

## What was built: Payroll Checkoff

Two additive Prisma enum values, nothing else:

- `DuesPaymentMethod.PAYROLL_CHECKOFF` — the payment-method label recorded on an actual `DuesPayment` row.
- `PaymentImportSourceType.PAYROLL_CHECKOFF` — the bulk-import source type for an employer's remittance file.

Both are wired through the **existing** `PaymentImportBatch`/`PaymentImportItem` reconciliation pipeline (`src/lib/payment-reconciliation.ts`, `/api/payments/imports`) — the same pipeline every other bulk-import source (Zelle, Cash App, Venmo, bank CSV) already uses. No new payment model, no new reconciliation logic, no new authorization mechanism.

### Where it is reachable

- `PaymentImportCreateForm.tsx` (officer-facing bulk-import UI) — selectable as an import source.
- `POST /api/payments/imports` — accepts `sourceType: "PAYROLL_CHECKOFF"`.
- `src/lib/payment-reconciliation.ts`'s `methodBySource` map and `postPaymentImportItem()` — a checkoff-sourced item posts as a `DuesPayment` (or `Contribution`) with `method`/`paymentMethod: "PAYROLL_CHECKOFF"`.

### Where it is deliberately NOT reachable

Employer payroll checkoff is never member-initiated — an individual member does not "choose" checkoff as a payment method; their employer does it automatically on the union's behalf. Accordingly, `PAYROLL_CHECKOFF` does not appear in, and was not added to:

- The org's configurable, member-payable payment-method list (`src/lib/payment-methods.ts`'s `defaultPaymentMethods`, `PaymentMethodsManager.tsx`, `/api/settings/payment-methods`).
- The member-facing payable-methods list (`PayableMethodsList.tsx`).
- Contribution forms (`ContributionCreateForm.tsx`, `ContributionEditForm.tsx`).
- Manual single-payment entry (the officer-facing "record one payment by hand" form/API, `RecordDuesPaymentForm.tsx` / `/api/dues/payments`) or its PTA/member-report equivalents (`MemberReportPaymentForm.tsx`, `PtaReportPaymentForm.tsx`).
- Stripe Checkout or payment links (these don't expose a `DuesPaymentMethod` picker at all — Stripe manages its own payment-method selection).

This boundary is enforced by a permanent regression-guard test (`src/lib/__tests__/payroll-checkoff-member-facing-omission.test.ts`), not just a one-time manual check — it fails the build if `PAYROLL_CHECKOFF` is ever added back to any of those files.

## UI wording

Customer-facing copy always renders **"Payroll Checkoff"**, never the raw enum literal `PAYROLL_CHECKOFF`. The one existing UI surface that lists import sources (`PaymentImportCreateForm.tsx`) already title-cases by replacing underscores with spaces for every source in that list — consistent with every other value there (e.g. `MANUAL_CSV` → "MANUAL CSV").

## Explicitly deferred / not built in this PR

- **Employer remittance automation** — no payroll-provider API integration, no ADP/Paychex/etc. connector, no ACH/NACHA file processing. This PR only adds the *data model and reconciliation path* for a human officer to upload an employer-provided file; how that file gets from the employer to the officer is unchanged (email attachment, portal upload, etc., exactly like every other existing bulk-import source).
- **Member self-service payroll setup** — a member cannot enroll themselves in payroll checkoff through Unestra; that's an employer/HR-side action entirely outside this product.
- **Manual, one-by-one entry of a "Payroll Checkoff" payment** — deliberately deferred. Checkoff is inherently a bulk, employer-remitted concept; a future PR could add it to the manual dropdowns if real usage shows an officer genuinely needs to record an individual correction that way.
- **Any UnionFlow schema, data migration, or shadow-adapter code.** Out of scope by design — see "Product boundary" above.

## Known limitations

- A `PaymentReport` (a member's own self-reported "I paid you" claim) still cannot use `PAYROLL_CHECKOFF` as its claimed method, by design (see `DUES_PAYMENT_METHODS` in `src/lib/payment-reports.ts`, deliberately unchanged) — this is consistent with checkoff never being member-initiated.
- No bulk/duplicate-detection UI beyond what already exists for every other import source (the existing `organizationId_sourceType_externalTransactionId` unique constraint prevents duplicate rows on re-import; there's no dedicated "this looks like a checkoff resubmission" warning beyond that).
- No per-capita-tax remittance reporting (money the union itself owes its parent/international body) — a real, distinct union administrative need, but a reporting concern layered on existing `Expenditure`/`Category` data, not a payments gap; not addressed here.

## Recommended next Union step

Nothing in the Union vertical's own domain is queued next — by design, the vertical stays thin. If UnionFlow's own roadmap later calls for a read-only shadow-classification integration with Unestra (per `unestra-labs` ADRs 0052–0067), that work belongs in `unestra-labs`/`unionflow`, not here.
