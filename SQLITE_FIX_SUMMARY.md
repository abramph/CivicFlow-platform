# SQLite "no such column: now" Error - Complete Fix

## Problem
SQLite error: `SqliteError: no such column: "now"` originating from compiled build output (`.vite/build/main.cjs`).

## Root Cause
1. **Stale compiled code** in build output containing old SQL with bare `now` instead of `datetime('now')`
2. **Existing database** may have been created with old schema using `DEFAULT now` instead of `CURRENT_TIMESTAMP`

## Fixes Applied

### ✅ 1. All SQL DEFAULT Clauses Fixed
- Changed all `DEFAULT (datetime('now'))` to `DEFAULT CURRENT_TIMESTAMP`
- Updated in:
  - `src/db/migrations.js`
  - `src/db/migrations/001_initial_schema.sql`
  - `src/db/migrations/010_meetings_attendance.sql`
  - `src/main/db.js`

### ✅ 2. All UPDATE Statements Verified
- All UPDATE queries correctly use `datetime('now')` or `datetime("now")`
- Logo upload handler: ✅ `updated_at = datetime("now")`
- All other handlers: ✅ `updated_at = datetime('now')`

### ✅ 3. Build Artifacts Cleaned
- Created cleanup script: `scripts/clean-and-reset.cjs`
- Deleted `.vite/` and `out/` directories

## Required Steps to Complete Fix

### Step 1: Reset Database (CRITICAL)
The existing database may have old schema. Delete it:

**Windows:**
```
C:\Users\<YourUsername>\AppData\Roaming\Civicflow\app.db
```

**macOS/Linux:**
```
~/.config/Civicflow/app.db
```

**Steps:**
1. Close CivicFlow app completely
2. Navigate to the directory above
3. Delete the `Civicflow` folder (or just `app.db` inside it)
4. App will recreate database with correct schema on next launch

### Step 2: Full Clean Rebuild
```bash
# Clean build artifacts
npm run clean:all

# Or manually:
npm run clean
node scripts/clean-and-reset.cjs

# Rebuild everything
npm install
npx electron-rebuild
npm run build
npm run dist
```

### Step 3: Verify Build Output
After build completes, verify `.vite/build/main.cjs` contains:
- ✅ `datetime('now')` or `datetime("now")` in UPDATE statements
- ✅ `CURRENT_TIMESTAMP` in DEFAULT clauses
- ❌ NO bare `now` without quotes or function

## Verification Checklist

- [ ] Build artifacts cleaned (`.vite/`, `out/`, `dist/`, `build/` deleted)
- [ ] Database file deleted from userData directory
- [ ] `npm install` completed successfully
- [ ] `npx electron-rebuild` completed successfully
- [ ] `npm run build` completed without errors
- [ ] `.vite/build/main.cjs` contains no bare `now`
- [ ] Logo upload works without SQLite errors
- [ ] Setup page completes successfully
- [ ] Expenditures timestamps work correctly

## Expected Result

✅ Logo upload succeeds  
✅ No SQLite errors  
✅ Setup page completes  
✅ All timestamps populate correctly  
✅ Expenditures + all features work correctly

## Notes

- `date('now', ...)` in seed data is **correct** - that's SQLite's date function
- `Date.now()` in JavaScript code is **correct** - that's JavaScript, not SQL
- Only SQL DEFAULT clauses and UPDATE statements needed fixing
