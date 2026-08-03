# CSV Import Column Mapping — Direction Fix (found during PR #44 review)

## The bug

The Import Data page (`/import`) lets an officer map their file's actual column headers to the app's canonical field names (e.g. their CSV's "Parent Email Address" column maps to the canonical `contactEmail` field). The resulting `mapping` object sent to `/api/import` is keyed `{csvHeader: canonicalField}` — confirmed by the UI's own reverse-lookup used to render the "mapped to" summary (`Object.entries(mapping).find(([, v]) => v === field.key)`).

Every importer (`importMembers`, `importContributions`, and initially the new `importPtaHouseholds`/`importHoaProperties`) read a row like this:

```ts
const get = (field: string) => pickStr(row, mapping[field] ?? field);
```

This indexes `mapping` **by canonical field name**, which is backwards — `mapping` is keyed by header, not by field. `mapping[field]` is essentially always `undefined`, so `get()` silently fell through to `row[field]` — reading `row["contactEmail"]` directly, which only works if the CSV's own header happened to be spelled exactly like the canonical field name.

**Why it was never caught**: every existing test constructed its row fixtures with the canonical field name already used as the row's own key (`{ firstName: "...", lastName: "..." }`), which happens to make the fallback path succeed by coincidence. None exercised a *real* remapping — a CSV header that doesn't textually match its target field.

**Real-world impact**: any officer who mapped a differently-named column (anything other than a header that happens to already read `firstName`, `email`, etc.) would have that field imported as blank, silently, with no error.

## The fix

`src/lib/member-import.ts` now exports `buildFieldGetter(mapping)`, which builds the correct **reverse** map once (`{canonicalField: csvHeader}`) and returns a `(row, field) => string` getter. All four importers (`importMembers`, `importContributions`, `importPtaHouseholds`, `importHoaProperties`) use it instead of the ad hoc `mapping[field] ?? field` pattern.

## Compatibility impact

None. Column mappings are never persisted (no `ImportMapping`/saved-template model exists anywhere) — every upload rebuilds its mapping fresh, so there was nothing saved to become incompatible. No documentation or import template anywhere referenced the old (broken) behavior either.

## Regression coverage

`src/lib/__tests__/member-import.test.ts` and `src/lib/__tests__/vertical-import.test.ts` each include a test using deliberately mismatched headers (e.g. "Given Name"/"Family Name"/"Email Address" for Members; "Parent Email Address"/"Street Number and Name" for PTA/HOA) that fails if the mapping direction is ever reversed again.
