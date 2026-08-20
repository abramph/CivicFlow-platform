# Deployment Checklist

Last verified: 2026-08-10.

## Normal Deployment

1. Merge approved PR into `main`.
2. Confirm local main:
   ```powershell
   git switch main
   git fetch origin --prune
   git pull --ff-only origin main
   git status
   ```
3. DigitalOcean deploy-on-push starts automatically.
4. Watch deployment:
   ```powershell
   doctl apps list-deployments 6e4f35b1-ad49-4c92-b025-97b7d12d7ace --format ID,Phase,Progress,Cause --no-header
   ```
5. Check build logs if deployment stalls or fails.
6. Confirm deployment reaches `ACTIVE`.
7. Verify:
   ```powershell
   curl https://app.getunestra.com/api/health
   ```
8. Review runtime logs:
   ```powershell
   doctl apps logs 6e4f35b1-ad49-4c92-b025-97b7d12d7ace --type run --tail 200
   ```

## Migration Handling

Production run command includes `npm run db:deploy`, which runs `prisma migrate deploy` before `next start`.

Before merging any migration:

- Confirm migration is committed under `prisma/migrations`.
- Review SQL for destructive operations.
- Confirm rollback plan.
- Take or identify a recent database backup.
- For risky migrations, fork a backup to a temporary cluster and validate.

After deploy:

- Confirm logs show no unexpected migration failure.
- Confirm `/api/health`.
- Smoke-test the migrated feature.

## Smoke Tests

Minimum:

- Login as Platform Admin.
- Login/select organization as normal org admin.
- Open tenant dashboard.
- Open Platform Admin Data Health.
- Exercise one read path and one safe write path relevant to the release.
- Check provider-specific path if release touched provider code.

Launch-critical PTA smoke:

- PTA dashboard loads.
- Household/member page loads.
- Communication recipient preview works.
- Volunteer signup/assignment/cancellation logs appear for safe test data.
- Data Health has no unexpected critical findings.

## Rollback

Code-only rollback:

1. Use DO App Platform rollback to prior deployment or revert the commit and push `main`.
2. Wait for `ACTIVE`.
3. Verify `/api/health`.
4. Smoke-test affected flows.

Migration rollback:

- Do not assume old code can run against a newer schema.
- If migration was backward-compatible, code rollback may be enough.
- If migration corrupted or removed data, restore PostgreSQL to a new cluster and point the app at it.

Emergency rollback target:

- Previous known-good DO deployment.
- Previous known-good `main` SHA.
- Latest verified PostgreSQL backup or forked restore cluster.

## Expected Timeline

- Build and deploy: usually 5-15 minutes.
- Health stabilization: 1-3 minutes after `ACTIVE`.
- PostgreSQL restore fork at current data size: observed 7.7 minutes, plus redeploy and smoke test.
- Full disaster recovery: plan 30-60 minutes now if secrets are available; longer if secrets must be recovered from providers.
