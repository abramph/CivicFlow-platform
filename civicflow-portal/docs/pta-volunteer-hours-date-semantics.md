# Volunteer requirement period date-field semantics

`fix/pta-volunteer-financial-controls`, RV-3. Written to resolve a
contradiction the deployment-review report itself introduced: it described
posting as "rejected before `assessmentDate`" (an enforced rule) while also
describing "the UI's due-date text" as "informational-only" — read together,
those two sentences sound like they're describing the *same* field, which
would be a genuine contradiction (a field cannot be both enforced and
decorative). They are not the same field. `PtaVolunteerRequirementPeriod`
has five independent date fields; this note is the single canonical
definition of what each one actually does, so no future report (or UI
string) can blur them together again.

## The five fields

| Field | Review's term | Enforced or informational | What it actually controls |
|---|---|---|---|
| `startsOn` / `endsOn` | — | Enforced (structural) | The period's own existence window. Used for active-period conflict detection (`assertNoConflictingActivePeriod`) and to resolve "the current active period" (`getCurrentActivePeriod`). **Does not** filter which hour-entries count toward the period's total — see "which service hours count" below. |
| `volunteerDeadline` | volunteer-hours cutoff | **Informational** | Drives the family-facing "days remaining" countdown (`reports/family-summary.ts`) and the deadline-reminder notification (`notifications.ts: sendVolunteerHoursDeadlineReminders`), gated by `ptaVolunteerNotificationsEnabled`. Nothing server-side compares `now` against this field to reject an hour-entry, a buyout election, or a checkout. |
| `buyoutWindowStart` / `buyoutWindowEnd` | — | **Enforced** | `assertBuyoutWindowOpen` (`periods.ts`), called from every quote/election/checkout path. Open at `buyoutWindowStart` inclusive, closed at `buyoutWindowEnd` exclusive. |
| `assessmentDate` | assessment eligibility/effective date | **Enforced** | `assertAssessmentDue` (`assessments.ts`), called only from `postAssessmentBatch`. Gates **posting** only — `previewAssessmentBatch` has no date gate and never has side effects. Does not affect which hours count, does not affect payment due date, does not start any late-fee/notification clock. |
| `assessmentPaymentDueDate` | payment due date | **Informational** | Copied onto each `PtaVolunteerAssessmentCharge.dueDate` at post time (`assessments.ts:322`) and surfaced in the assessment-posted notice (`notifications.ts: sendVolunteerHoursAssessmentPostedNotices`) and on the family's posted-charge view. No code path compares `now` against it. Nothing "automatically happens" if it passes unpaid — no late fee, no auto-escalation, no re-assessment. |

Two of the review's four requested terms map directly (assessment
eligibility/effective date → `assessmentDate`; payment due date →
`assessmentPaymentDueDate`). The other two do not have a dedicated field
today, and this note says so explicitly rather than quietly implying one
exists:

- **"Volunteer-hours cutoff"** — there is no field that stops an hour-entry
  from being logged, submitted, or approved after a given date. Which
  *period* an entry's hours count toward is determined by which
  `requirementPeriodId` the entry (or the attendance/event it derives from)
  is associated with — an administrative/data linkage, not a date
  comparison. `volunteerDeadline` is the closest family-facing concept, but
  it is deliberately informational (see above) — a family can still log and
  get credit for hours after their personal deadline has passed, up until
  whatever administrative point the PTA actually stops accepting entries
  (today: no automated point at all; an admin would need to reject entries
  manually, or eventually close/archive the period).
- **"Grace-period end"** — not modeled. There is currently no gap tracked
  between `volunteerDeadline` and `assessmentDate`; an admin who wants a
  grace period simply sets `assessmentDate` later than `volunteerDeadline`
  by however many days they intend. If a future requirement needs the grace
  period itself to be a distinct, independently-configurable field (e.g. to
  show "X days of grace remaining" to a family, separately from the
  assessment date itself), that is a new field and a product decision, not
  something this correction invents unprompted.

## Per-field control matrix (the review's exact five questions)

| Field | Which hours count | When preview is allowed | When posting is allowed | When payment is due | Late fees / notifications |
|---|---|---|---|---|---|
| `volunteerDeadline` | No effect | No effect | No effect | No effect | Triggers the deadline-reminder notice (if `ptaVolunteerNotificationsEnabled`) |
| `assessmentDate` | No effect | Always allowed regardless | Blocked until `now >= assessmentDate` | No effect | No effect |
| `assessmentPaymentDueDate` | No effect | No effect | No effect | Displayed as the due date on the posted charge and its notice | No effect — no late fee or auto-escalation exists |

## Invariant this note exists to keep true

*No enforced field may be labeled informational, and no informational field
may silently block a server action.* Every field above is stated as one or
the other, and `__tests__/assessments.test.ts` now includes an explicit
regression proving `assessmentDate` and `assessmentPaymentDueDate` behave
independently — posting is accepted or rejected purely on `assessmentDate`,
with `assessmentPaymentDueDate` varied across null/past/future and having
zero effect on the outcome (see "RV-3" in that file). The admin settings UI
(`PtaVolunteerPeriodsManager.tsx`) already carried accurate, field-specific
labels before this note was written — its "Enforced server-side" /
"Informational" language already matched this table exactly; this note is
the first place that states it for all five fields together, cross-checked
against the code that implements each one, so nothing here required a UI
copy change.
