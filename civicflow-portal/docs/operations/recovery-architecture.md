# Recovery Architecture

Last verified: 2026-08-10.

## Production Architecture

Unestra production runs as a single DigitalOcean App Platform app:

- App Platform app: `civicflow-portal`, app ID `6e4f35b1-ad49-4c92-b025-97b7d12d7ace`, region `nyc`.
- Runtime component: one `apps-s-1vcpu-1gb` web service, `instance_count: 1`, HTTP port `3000`.
- Source: `github.com/abramph/CivicFlow-platform`, branch `main`, `deploy_on_push: true`.
- Build: `npm install --include=dev && prisma generate && npm run build`.
- Run: `npm run db:deploy && npm start`.
- Health check: `/api/health`, every 30s, 10s timeout, failure threshold 3.
- Domains: `app.getunestra.com` primary, `app.civicflowapp.com` alias.
- DNS: `app.getunestra.com` and `app.civicflowapp.com` CNAME to the DO App Platform hostname. `getunestra.com` nameservers resolve to Hostinger DNS parking (`aurora.dns-parking.com`, `nebula.dns-parking.com`).

Data and integrations:

- PostgreSQL: DO Managed PostgreSQL `civicflowprod`, ID `02f47c72-4bdb-4b6f-9105-a92502246128`, PostgreSQL 18, `nyc3`, `db-s-1vcpu-1gb`, one node.
- Object storage: DigitalOcean Spaces, `nyc3`, configured through `DO_SPACES_*` env vars. Application uploads use private ACL and reads use signed URLs.
- Email: Brevo SMTP via `nodemailer`, controlled by `ENABLE_EMAIL_SEND`.
- SMS: Twilio, feature-gated. App supports DB-encrypted platform SMS settings; legacy env vars may also exist.
- Billing: Stripe live keys and webhook secret in DO App Platform env vars.
- Push: Expo push through `expo-server-sdk`; mobile device tokens are stored in Postgres.
- Error monitoring: Sentry code integration exists in server/client/edge configs and API error handling. Current readable DO app spec did not show `NEXT_PUBLIC_SENTRY_DSN`; verify in DO console because prior launch handoff said Sentry was configured.
- GitHub: source of truth for code and deployment trigger.
- Hostinger: DNS hosting for `getunestra.com`; Hostinger credentials are outside the app spec.

## Backup Strategy

### PostgreSQL

Automatic DO Managed PostgreSQL backups are enabled and current.

Verified backups:

| Created UTC | Size GB |
| --- | ---: |
| 2026-08-03 01:33:12 | 0.045128 |
| 2026-08-04 01:33:12 | 0.045199 |
| 2026-08-05 01:33:13 | 0.045988 |
| 2026-08-06 01:33:12 | 0.046275 |
| 2026-08-07 01:33:11 | 0.046756 |
| 2026-08-08 01:33:10 | 0.046817 |
| 2026-08-09 01:33:11 | 0.046776 |
| 2026-08-10 01:33:11 | 0.046869 |

Observed retention: eight daily backup points, approximately seven days of recovery history. Latest verified recovery point was `2026-08-10 01:33:11 UTC`.

Restore validation:

- Temporary fork: `unestra-restore-test-20260810`.
- Restore source: latest available backup from `civicflowprod`.
- Restore time: 461.9 seconds from fork request to online cluster.
- Verified on restored cluster:
  - public schema tables: 92
  - Prisma migration rows: 61
  - latest migration finished: `2026-08-10 02:20:07.517687+00`
  - organizations: 11
  - OrgMembers: 521
  - PTA households: 8
  - communication campaigns: 19
  - audit events: 678
- Cleanup: temporary restore cluster deleted; follow-up `get` returned 404.

### Spaces

The app treats Spaces objects as private:

- `PutObjectCommand` uses `ACL: "private"`.
- Signed URLs are generated with `getSignedObjectUrl`.
- Object keys are generated with safe prefixes and UUIDs.

Bucket-level versioning, lifecycle rules, retention, and encryption could not be verified with the currently available read-only `doctl` commands. `doctl spaces` in this environment exposes key management, not bucket inspection. Treat Spaces recoverability as unverified until confirmed in the DO console or with an S3-compatible admin client.

Recommendation: enable bucket versioning and lifecycle retention for production Spaces if not already enabled. This is the largest recoverability gap because uploaded files, receipts, imports, and attachments are not reproducible from PostgreSQL alone.

### Code

GitHub is the durable source for application code. Production deploys from `main`.

### Secrets

DO app spec output redacts secret values. The app spec is enough to recover key names/scopes, but not actual secret values. Keep the live secret values in an external password manager or sealed vault:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `MOBILE_JWT_SECRET`
- `ATTENDANCE_QR_SECRET`
- Stripe keys/webhook secrets
- Brevo SMTP credentials
- Spaces credentials
- Twilio/SMS credentials or SMS credential encryption key
- Sentry DSN and Sentry auth/source-map credentials if used
- Hostinger/DNS credentials
- GitHub and DigitalOcean account recovery credentials

## RPO and RTO

Current realistic RPO:

- PostgreSQL: up to 24 hours based on daily backup cadence, unless DO PITR offers finer restore points in the control panel. PITR was not independently proven via CLI.
- Spaces: unknown if versioning is disabled or unverified; worst-case object deletion overwrite loss is permanent.
- Code: near-zero, because GitHub is authoritative.
- Secrets: depends on external vault discipline; DO spec alone is not sufficient.

Current realistic RTO:

- Normal rollback to prior App Platform deployment: 10-30 minutes, assuming no migration rollback is required.
- Database restore to a forked cluster: observed 7.7 minutes for current data size, plus app spec update, redeploy, and smoke test. Plan for 30-60 minutes now.
- Full app recreation: hours, dominated by secret recovery, DNS verification, and provider webhook reconfiguration.

## Single Points of Failure

- One App Platform instance. A container/region/platform incident can take the app down.
- One PostgreSQL node. DO manages backups, but there is no read replica or multi-region failover.
- One Spaces bucket/region, with versioning unverified.
- Hostinger DNS is external to DO; DNS account loss or misconfiguration can break custom domains.
- Brevo SMTP, Twilio, Stripe, Expo Push, and Sentry are external provider dependencies.
- Secrets are not restorable from the redacted app spec alone.
- Sentry alerting status is ambiguous from the readable app spec; no verified paging/alerting channel exists in repo config.

## Database Restore Procedure

Do not overwrite production. Always restore to a new cluster first.

1. Confirm current production state:
   ```powershell
   doctl databases get 02f47c72-4bdb-4b6f-9105-a92502246128
   doctl databases backups 02f47c72-4bdb-4b6f-9105-a92502246128
   ```
2. Fork from latest backup:
   ```powershell
   doctl databases fork unestra-restore-YYYYMMDD \
     --restore-from-cluster-id 02f47c72-4bdb-4b6f-9105-a92502246128 \
     --wait
   ```
3. Or fork from a specific backup timestamp:
   ```powershell
   doctl databases fork unestra-restore-YYYYMMDD \
     --restore-from-cluster-id 02f47c72-4bdb-4b6f-9105-a92502246128 \
     --restore-from-timestamp "2026-08-10 01:33:11 +0000 UTC" \
     --wait
   ```
4. Verify restored schema and data:
   ```sql
   select count(*) from information_schema.tables where table_schema = 'public';
   select count(*), max(finished_at) from "_prisma_migrations";
   select count(*) from "Organization";
   select count(*) from "OrgMember";
   select count(*) from "AuditEvent";
   ```
5. If cutting over, update `DATABASE_URL` in DO App Platform to the restored cluster, redeploy, and run smoke checks.
6. Preserve the old production cluster until the restored app is verified.
7. Delete the restore-test cluster only after verification or after the incident is resolved.

## Rollback Strategy

Use the least destructive rollback that mitigates the incident:

1. Bad deploy, no migration: rollback to prior App Platform deployment.
2. Bad deploy with backward-compatible migration: rollback code only if old code is compatible with new schema.
3. Bad destructive migration or data corruption: stop writes if needed, restore PostgreSQL to a new cluster, point app at restored database, then redeploy.
4. Object loss: restore prior object versions only if Spaces versioning is enabled. If not enabled, recovery is not guaranteed.
