# Unestra — Rollback Plan

## Application rollback

DigitalOcean App Platform's dashboard has a one-click "Rollback to previous deployment" action (Apps → civicflow-portal → Deployments → select a prior successful deployment → Rollback). This is the fastest option when available and doesn't require touching git.

If you'd rather do it from the repository (or the dashboard rollback isn't available for the situation):

```bash
git revert <bad-merge-commit-sha> -m 1   # -m 1 if it was a merge commit
git push origin main
```

Pushing the revert to `main` triggers a normal DigitalOcean auto-deploy of the reverted code, same as any other merge — see `docs/production-release-process.md`.

**Verify after either method:**

```bash
curl https://app.getunestra.com/api/health
doctl apps get-deployment <app-id> <new-deployment-id>
```

## Database rollback

This project's migration convention (see the additive-only pattern used in the PTA volunteer-hours migration, `civicflow-portal/prisma/migrations/20260725114304_add_pta_volunteer_hours_tracking/`) is **additive-only**: new tables, new nullable/defaulted columns, new enum values — never a destructive `DROP COLUMN`/`DROP TABLE` in the same release that also ships the code depending on the old shape. This means:

- **The common case doesn't need a database rollback at all.** If application code is reverted, the additive schema changes from the same release are almost always harmless to leave in place (unused tables/columns don't break anything), and can be cleaned up in a later, separate migration once you're sure nothing needs them.
- **A destructive migration should never have shipped without a documented backfill/rollback plan of its own** — if one did and needs reverting, that requires a hand-written down-migration or a restore from backup, not a generic procedure. Treat that as an incident, not routine rollback.

**Backups**: production runs on DigitalOcean Managed PostgreSQL, which takes automatic daily backups with point-in-time recovery (confirm current retention window in the DigitalOcean dashboard under the database cluster's Backups tab — this wasn't independently re-verified in this pass). A full restore-from-backup is the last resort for a genuinely destructive schema or data incident, not a first response to "the last deploy broke something."

## When to roll back vs. fix forward

| Situation | Action |
|---|---|
| Health check failing, app not responding | Roll back immediately (dashboard or git revert), investigate after |
| A specific feature broke but the app is otherwise healthy | Usually fix-forward with a small patch is faster and lower-risk than a rollback + re-deploy cycle |
| A migration is mid-failure on deploy | DO's health check will keep the previous instance's traffic-serving version up until the new one passes health checks or fails — a stuck migration blocks the *new* deployment from going live, it does not take down the currently-running one. Check `doctl apps logs <app-id> --deployment <deployment-id> --type run` for the exact migration error before deciding. |
| Suspected tenant-isolation or auth regression | Roll back immediately — this class of bug is not something to leave live while investigating |

## What this plan does not cover

- Mobile app rollback: there is no way to "roll back" a build already in Apple/Google review or already installed on users' devices. See `docs/app-store-review-protection.md`. A bad mobile release is fixed by shipping a new build through the normal review process, not by rollback.
- Desktop app rollback: the signed macOS DMG and Windows installer are versioned release artifacts (see `docs/macos-release-checklist.md`); "rolling back" means pointing users at a previous release download, not an automated mechanism.
