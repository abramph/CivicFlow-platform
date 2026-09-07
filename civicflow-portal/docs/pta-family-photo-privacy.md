# PTA family and student photos — delivery and retention

A family photo is household data and, in a K-12 product, effectively
children's data — and a **student photo is a child's image outright**. Two
properties are load-bearing and easy to lose by accident, so they are written
down here. As of Build 27 this contract covers BOTH photo kinds: the student
photo (`PtaStudent.photoUrl`, `src/lib/labs/pta/student-photo.ts`) shares the
family photo's validation pipeline (`photo-pipeline.ts`), delivery helper,
removal semantics, and audit rules — by construction, not by convention.

## 1. The bytes are served by an endpoint that authorized the caller

**Never** a signed object-storage URL, and **never** a redirect to storage.

A signed URL is a bearer credential. Once issued it works for anyone who holds
it, from any client, with no authorization check, no way to revoke it before it
expires, and it is served by a host that has no idea who is asking. That is the
wrong shape for this data even with a five-minute lifetime.

Every route that serves one of these photos goes through one helper,
`familyPhotoBytesResponse` in `src/lib/labs/pta/household-photo-response.ts`:

| Route | Audience | Auth |
|---|---|---|
| `GET /api/mobile/pta/household/photo` | the household's own parent | bearer token |
| `GET /api/labs/pta/households/[householdId]/photo` | officer with `pta:directory:read`, or the household's own linked parent | session |
| `GET /api/mobile/pta/students/[studentId]/photo` | a parent of the student's OWN household (linkage + household-membership check on the student) | bearer token |
| `GET /api/labs/pta/students/[studentId]/photo` | officer with `pta:directory:read`, or a parent of the student's own household | session |

A `studentId` is never an authorization input: the mobile route re-derives the
caller's household from their own `PtaHouseholdAdult` linkage and requires the
student to belong to it; any other family's student answers "not found",
never confirming existence. Student photo writes are officer-gated by
`pta:students:manage` (web) or the same own-household linkage (mobile parent
self-service).

Both:

* authorize **before** any storage access;
* resolve the household server-side — the mobile route from the token's own
  `PtaHouseholdAdult` linkage, so no household, attachment, object or student
  id is ever accepted from the client;
* return the server's own normalized content type (every stored photo is
  re-encoded to JPEG on upload, so this is never a client-declared value);
* set `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`;
* report a missing object as **404 "no photo"**, never a 5xx carrying a bucket
  name or object key.

The mobile client cannot let `<Image>` fetch this itself — React Native has no
dependable cross-platform way to attach an `Authorization` header to an image
request, and pushing a token into one risks sending it to whatever host the URI
names. `apiFetchImageDataUri` performs the authenticated fetch in code that can
only ever talk to `API_BASE_URL`, and returns a self-contained `data:` URI.

A loaded photo is held together with the organization it belongs to and
rendered only while that still matches the selected organization, so switching
organization cannot leave the previous family's photo on screen.

## 2. "Remove" means the object is deleted

Not hidden behind a soft-deleted row.

`deleteHouseholdPhoto` deletes the storage object **first**, and does not
swallow the failure:

* **storage delete fails** → nothing is changed, and the caller gets a
  retryable `PTA_HOUSEHOLD_PHOTO_DELETE_FAILED` (503). A caller is never told
  the photo is gone when it is not.
* **database update fails afterwards** → the object is already deleted, so the
  image cannot be served whatever the row says. `getHouseholdPhotoBytes` treats
  a missing object as "no photo", which makes this a recoverable
  missing-object state rather than a way to see the image again.

Repeat removals are idempotent, and a repeat also sweeps any object an earlier
partial failure left behind, so retrying is useful rather than a silent no-op.

Replacement uploads and activates the new photo first, so a failed upload
leaves the existing photo completely intact. Cleanup of the superseded object
is **not** fire-and-forget: if it fails, a
`pta.household.photo_object_cleanup_failed` audit event names the attachment
(never the raw key, never image bytes) and
`purgeOrphanedHouseholdPhotoObjects` re-attempts it.

## What must never appear in a log or audit record

Image bytes, storage object keys, signed URLs, bucket names, `Authorization`
headers, or family names. Audit metadata carries `attachmentId` instead — it is
enough to re-derive anything an operator needs, server-side.

## History

Both properties were absent before the Build 26 remediation. Delivery handed
out signed URLs from both routes (the web one as a 302), and removal called
`deleteObjectFromSpaces(...).catch(() => {})` *after* tombstoning the row, so a
storage outage reported success while the photo stayed in the bucket. The same
swallowed failure on the replacement path is how a superseded family image
could linger indefinitely with nothing recording it.
