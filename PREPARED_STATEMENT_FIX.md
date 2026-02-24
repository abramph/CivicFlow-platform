# SQLite Prepared Statement Cache Fix

## Problem
Persistent `SqliteError: no such column: "now"` caused by cached prepared statements in better-sqlite3.

## Root Cause
better-sqlite3 caches prepared statements internally by SQL string. If an old SQL statement with bare `now` (without quotes) was executed before the fix, it may still be cached in memory.

## Fixes Applied

### ✅ 1. All SQL Statements Verified
- Logo upload handler: Uses `datetime('now')` ✅
- All UPDATE statements: Use `datetime('now')` or `datetime("now")` ✅
- All INSERT statements: Now explicitly set `updated_at = datetime('now')` ✅

### ✅ 2. Prepared Statements Created Fresh
- All `db.prepare()` calls are inside handler functions (not cached outside)
- Each handler creates fresh prepared statements on every call
- Added comments to document this pattern

### ✅ 3. INSERT Statements Updated
- Changed INSERT to explicitly include `updated_at = datetime('now')`
- Ensures consistency and avoids relying on DEFAULT values

## Required Steps (MANDATORY)

### Step 1: Hard Stop All Processes
**CRITICAL - Do this first!**

1. Stop Vite dev server (Ctrl+C)
2. Close Electron app completely
3. Close VS Code / Cursor
4. Open Task Manager (Windows) or Activity Monitor (Mac)
5. End ALL `node.exe` or `electron.exe` processes
6. Verify no processes are running

### Step 2: Delete All Build + Cache Output
```bash
# Run cleanup script
npm run clean:all

# Or manually delete:
# - .vite/
# - dist/
# - out/
# - build/
# - node_modules/.cache (if exists)
```

### Step 3: Delete SQLite Database File
**This is REQUIRED to clear cached prepared statements!**

**Windows:**
```
C:\Users\<YourUsername>\AppData\Roaming\Civicflow\app.db
```

**macOS:**
```
~/Library/Application Support/Civicflow/app.db
```

**Linux:**
```
~/.config/Civicflow/app.db
```

**Steps:**
1. Navigate to the directory above
2. Delete the entire `Civicflow` folder (or just `app.db`)
3. This clears all cached prepared statements

### Step 4: Clean Reinstall & Rebuild
```bash
# Clean install
npm install

# Rebuild native modules
npx electron-rebuild

# Build the app
npm run build

# Or for development
npm run dev
```

### Step 5: Verify Build Output
After build, search `.vite/build/main.cjs` for:
- ❌ NO bare `now` (without quotes or function)
- ✅ Only `datetime('now')` or `datetime("now")`
- ✅ Only `CURRENT_TIMESTAMP` in DEFAULT clauses

## Why This Works

1. **Fresh Prepared Statements**: Each handler creates new prepared statements, avoiding stale cache
2. **Explicit Timestamps**: INSERT statements now explicitly set `updated_at`, ensuring consistency
3. **Database Reset**: Deleting the database clears all cached prepared statements in better-sqlite3
4. **Clean Build**: Removing build artifacts ensures no old compiled SQL survives

## Verification Checklist

- [ ] All processes stopped (no node.exe/electron.exe running)
- [ ] Build artifacts deleted (.vite/, dist/, out/, build/)
- [ ] Database file deleted from userData directory
- [ ] `npm install` completed
- [ ] `npx electron-rebuild` completed
- [ ] `npm run build` completed without errors
- [ ] `.vite/build/main.cjs` contains no bare `now`
- [ ] Logo upload works without errors
- [ ] Setup page completes successfully

## Expected Result

✅ Logo upload succeeds  
✅ No SQLite errors  
✅ Setup page completes  
✅ All timestamps work correctly  
✅ App remains stable

## Technical Notes

- better-sqlite3 caches prepared statements internally by SQL string
- Changing the SQL string (even slightly) forces a new cache entry
- Deleting the database clears all in-memory caches
- Prepared statements are created fresh in each handler (not cached outside)
