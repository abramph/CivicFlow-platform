# Backup Strategy, Restore Procedure, and Disaster Recovery

## What's backed up today

- **Database**: `civicflowprod`, a DigitalOcean Managed PostgreSQL cluster (region `nyc3`, tier
  `db-s-1vcpu-1gb`). Confirmed via `doctl databases backups list` that automated daily backups are
  real and active: BackupHour 1:33 UTC, roughly a 7-day rolling retention (8 daily backups on hand,
  spanning 2026-07-27 through 2026-08-03 as of the last check). Re-run `doctl databases backups list
  <cluster-id>` periodically to confirm this hasn't silently lapsed — this resolves the earlier
  uncertainty in this document (an initial `doctl` check errored in a different environment; a later
  check from a working environment confirmed backups are in fact enabled and current).
- **File storage**: attachments, receipts, and import files live in a DigitalOcean Spaces bucket
  (`DO_SPACES_BUCKET`). Spaces does **not** version or back up objects by default — deleting or
  overwriting an object is permanent unless bucket versioning is explicitly enabled. **Action item**:
  confirm whether versioning is enabled on the production bucket; if not, enable it, since member
  documents and payment receipts are not reproducible from the database alone.
- **Application code**: the full history lives in git (`github.com/abramph/CivicFlow-platform`) —
  effectively an unlimited-retention backup of everything except data and secrets.
- **Environment variables / secrets**: live only in the DO App Platform app spec. `doctl apps spec
  get 6e4f35b1-ad49-4c92-b025-97b7d12d7ace > app-spec-backup.yaml` produces a spec with secret
  *values* redacted (shown as encrypted `EV[...]` blobs which are only decryptable by DO for this
  specific app) — this is useful for restoring the *shape* of the config (which keys exist, which
  scopes) but **does not** back up the actual secret values. Keep an out-of-band, securely stored
  copy of the real secret values (a password manager or sealed vault entry), since losing the app
  entirely would mean re-entering every Stripe/Twilio/SMTP/DO Spaces credential from scratch.

## Restore procedure

### Database restore (point-in-time or from a snapshot)

1. In the DO control panel: Databases → `civicflowprod` → Backups → choose a restore point.
2. DO restores to a **new** cluster (it does not overwrite the live one in place) — this is the
   safe default since it lets you verify the restored data before cutting over.
3. Update `DATABASE_URL` (and `DATABASE_POOL_URL` if set) in the App Platform app spec to point at
   the restored cluster's connection string, then redeploy.
4. Run `npx prisma migrate deploy` against the restored cluster if any migrations were applied
   after the backup's timestamp but before the incident, so the schema matches what the app code
   expects.
5. Smoke-test core flows (login, dashboard, a dues/payment page) before treating the restored
   cluster as the new production database, then decommission the old one.

### File storage restore

If Spaces versioning is enabled, restore prior object versions via the Spaces console or `s3cmd`/
`doctl` (Spaces is S3-compatible). If not enabled, there is currently no way to recover an
accidentally deleted/overwritten object — this is the strongest argument for enabling versioning
before it's needed.

### Full application restore (disaster recovery)

If the entire App Platform app were lost:
1. Recreate the app from the git repo (`doctl apps create --spec <spec-file>` using a saved app
   spec, or via the DO console pointing at the GitHub repo/branch).
2. Restore all environment variables/secrets from your out-of-band secure copy (see above) — this
   is the step that actually determines recovery time, since it can't be automated from git or a
   redacted spec dump alone.
3. Point `DATABASE_URL` at either the live cluster (if the database itself wasn't affected) or a
   restored one (see above).
4. Redeploy and verify.

## Recommended improvements (not yet implemented)

- Confirm and document the exact database backup retention window and take/store a periodic
  manual snapshot before any risky migration, rather than relying solely on the automatic schedule.
- Enable Spaces bucket versioning if not already on.
- Store the real (non-redacted) environment variable values in a password manager or secrets vault
  outside of DigitalOcean, so a full account-level incident doesn't strand recovery on DO support.
- Periodically test a full restore-to-a-new-cluster exercise (not just trust that backups exist) —
  an untested backup is not a verified recovery capability.
