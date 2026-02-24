# Civicflow

Offline desktop app for community organizations. Manages members, events, campaigns, and finances with local SQLite storage and an offline-capable license system.

## Requirements

- Node.js 18+
- npm

## Development

```bash
npm install
npm run dev
```

## Build installers

```bash
npm run dist:win
npm run build:mac
```

Produces:
- **Windows**: `release/CivicFlow Setup <version>.exe`
- **macOS**: `release/CivicFlow-<version>.dmg` (must be built on macOS)

## License system

Civicflow requires a valid license to create, edit, export, or backup data. Viewing existing data is allowed without a license.

Set the activation server URL for desktop builds using `ACTIVATION_API_URL` (preferred) or `CIVICFLOW_LICENSE_SERVER_URL`.

Example:

```bash
ACTIVATION_API_URL=https://your-license-service.example.com npm run dist:win
```

Server-side validation mode is enabled automatically when either env var is set.
If neither is set, Civicflow falls back to local signed-key validation.

### Switch to server-side validation

1. Start the license server:

```bash
cd civicflow-license-server
npm install
npm run init
npm start
```

2. Build desktop app with server URL:

```bash
ACTIVATION_API_URL=http://localhost:4000 npm run dist:win
```

3. Install that build and activate with a key from the license server DB.

### Generate keys (one-time)

```bash
node scripts/generate-license.mjs --init
```

This creates `.license-keys/` with a private key and copies the public key to `src/main/license-public.pem`. **Never commit** `.license-keys/` or the private key.

### Generate a license

```bash
node scripts/generate-license.mjs "Customer Name" email@example.com 365
```

- **Customer Name**: Licensee name
- **email**: Optional
- **365**: Validity in days (omit for perpetual)

Output: `license-<customer>.json` in the project root.

### Assign licenses from CSV (license server)

Use the bundled SQLite license server to bulk insert license records:

```bash
cd civicflow-license-server
npm install
npm run init
npm run import:licenses ../scripts/licenses-example.csv
npm run list:licenses
npm start
```

CSV fields supported by `import:licenses`:
- `name` (or `org_name`) required
- `plan` optional (`Essential` or `Elite`)
- `days` optional (converted to expiry date from today)
- `expiry_date` optional (YYYY-MM-DD)
- `seats_allowed` optional
- `license_key` optional (auto-generated when omitted)

Show current licenses and active device assignments:

```bash
cd civicflow-license-server
npm run list:licenses
```

JSON output option:

```bash
cd civicflow-license-server
node list-licenses.js --json
```

Rotate existing keys to app format (`XXXX-XXXX-XXXX-XXXX`):

```bash
cd civicflow-license-server
npm run backup:db
npm run rotate:licenses:dry
npm run rotate:licenses
```

Use `rotate:licenses:dry` first to preview changes.
`rotate:licenses` also creates an automatic backup in `civicflow-license-server/backups/` before applying updates.

### Activate in-app

1. Open Civicflow → Settings
2. Paste the license JSON into the text area
3. Click **Activate License**

Or load a `.license` / `.json` file if you add file-picker support.

### Deactivate

Settings → License → Deactivate

## Data location

- **Windows**: `%APPDATA%/Civicflow/app.db`
- **macOS**: `~/Library/Application Support/Civicflow/app.db`

Logs: `{userData}/logs/civicflow.log`
