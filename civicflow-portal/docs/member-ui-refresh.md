# Member Profile, Reports, and Directory UI Refresh

Part C of the 2026-08-04 Member Administration program. Design decisions only —
implementation follows this document.

## What audit found

- **Existing design system is minimal but consistent**: `src/components/app/PageChrome.tsx`
  exports `PageHeader`, `SectionCard`, `StatCard` — used everywhere, no component
  library (no shadcn/ui), Tailwind v4 CSS-first config, a single emerald-700 accent
  on a slate neutral scale. **No `StatusBadge`, `Timeline`, or `ProfileHeader`
  component exists** — status values render as plain text (`formatEnumLabel`), and
  two separate pages hand-roll near-identical timeline list markup
  (`members/[id]/page.tsx`'s "Member Timeline" section and `members/[id]/timeline/page.tsx`).
- **No dark theme, deliberately.** `globals.css`'s own comment explains a past
  incident: a leftover `prefers-color-scheme: dark` override made body text
  invisible on light cards. This refresh stays single-theme, consistent with that
  decision — it is not an oversight to fix.
- **Existing accessibility baseline is already decent**: filter inputs already use
  visible focus rings (`focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200`),
  tables already use `overflow-x-auto` for horizontal scroll on narrow viewports.
  This refresh extends that baseline rather than replacing it.
- **PDF/report generation is already synchronous in production today**, handling
  18 report types with no incident. The task's "background jobs if the architecture
  doesn't support sync generation" is conditional — sync generation is the
  existing, working architecture, so this PR does not introduce a job queue.

## Reuse over reinvention

- **Color palette**: extends the existing emerald-700/slate scale — no new accent
  color, no design-token rewrite. `StatusBadge` uses semantic colors (green/amber/
  slate/red) already present elsewhere in Tailwind's default palette, not a new
  brand color.
- **Report categorization**: extends the "Member Rosters" card pattern introduced
  in Part B (`src/app/reports/page.tsx`) to every report type, rather than
  inventing a second card layout.
- **Timeline**: one new `Timeline` component replaces both hand-rolled call sites
  (`members/[id]/page.tsx` and `members/[id]/timeline/page.tsx`), consuming the
  same `MemberTimelineEvent` shape both already query.

## New shared components (`src/components/app/`)

- **`StatusBadge`**: a colored pill that always renders a text label alongside
  color — never color alone, so status is legible without color perception. Maps
  every `MembershipStatus` value plus a `delinquent` variant to a semantic color;
  vertical-agnostic (takes a pre-formatted label string, doesn't know about
  `OrgMember`).
- **`Timeline`**: renders a list of `{ id, title, description, occurredAt,
  eventTypeLabel }` entries — the exact shape both existing call sites already
  have after mapping their Prisma rows.
- **`ProfileHeader`**: name, optional status badge, and a quick-actions row —
  generalizes the ad hoc header markup already at the top of the member profile
  page.

## Real design decisions

- **Member Profile page becomes tabbed** (Overview / Dues / Contributions /
  Communications & Attendance / Documents), replacing one long scroll of ~10
  section cards. Tab labels stay fixed across verticals (dues/contributions apply
  to every vertical); only the page's terminology (via `getVerticalTerminology`)
  and which sections show data change.
- **Reports page groups all 22 report types into categories** (Member Rosters,
  Financial, Membership & Dues, Communications & Attendance, Compliance) as cards,
  with the existing flat dropdown kept as-is underneath for anyone who prefers it
  — this is additive, not a removal of the existing control.
- **Members directory gets two more summary cards** (Delinquent, Terminated) next
  to the existing Filtered/All/Active/Categories row, and the Status column
  switches from plain text to `StatusBadge`.

## Accessibility

- `StatusBadge` never conveys status by color alone (text label always present).
- New interactive elements (tab buttons) get visible `focus-visible` rings and
  `aria-selected`/`role="tab"` wiring; tab panels get `role="tabpanel"` and
  `aria-labelledby`.
- Report category cards and roster cards are real `<a>`/`<Link>` elements (already
  true in Part B), not click-handlers on non-interactive `<div>`s.
- No color pairing introduced with contrast below WCAG AA (4.5:1) against white —
  verified against Tailwind's emerald-700/amber-700/red-700/slate-700 swatches,
  all of which the app already uses elsewhere at normal text size.

## Performance

- Tabs are rendered client-side from data already fetched server-side in one
  request (no new round-trips per tab).
- No new N+1 queries: the two new Members-directory summary cards reuse the same
  `prisma.orgMember.count()` pattern already used for the existing two cards, run
  in the same `Promise.all`.
- Report category cards reuse Part B's existing per-bucket count queries where
  applicable; non-roster category cards show no live count (avoiding 18 additional
  count queries on every Reports page load for numbers most users won't need
  before clicking through).

## Deliberately not built

A dark theme (explicitly rejected, see above); a new component/design-token
library beyond the three components above; background job infrastructure for
report generation (sync generation is the existing, working architecture);
tab state persisted across page loads (resets to Overview on navigation, which
matches how every other page in this app already behaves — no existing precedent
for persisting UI-only state).
