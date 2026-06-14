# CivicFlow — Security Guide

## Secret handling

### What must never be committed

| File / pattern | Reason |
|---|---|
| `.env`, `.env.*` (except `.env.example`) | Contains API keys, passwords, secrets |
| `*.db`, `*.sqlite`, `*.db-wal` | May contain PII or license data |
| `tools/private.pem` | Private signing key |
| `scripts/private/` | Any locally-generated keys |
| `civicflow-license-server/backups/` | DB snapshots with customer data |
| `logs/`, `*.log` | May contain sensitive request data |
| `release/`, `dist/`, `build/` | Binary artifacts |

All of the above are excluded by `.gitignore`. Run `git status` before every commit.

### Example files (safe to commit)

Every deployable unit has a `.env.example` with placeholder values only:

| Path | Purpose |
|---|---|
| `.env.example` | Desktop app |
| `civicflow-license-server/.env.example` | License server |
| `cloud-api/.env.example` | Cloud payment API |
| `civicflow-portal/.env.example` | Next.js SaaS portal |

---

## Production credentials

### Stripe keys
- Use **test keys** (`sk_test_*`, `pk_test_*`) in all development and CI environments.
- Use **live keys** only in production, set as encrypted environment variables in DigitalOcean App Platform or the VPS `.env` — never in code.
- Rotate any key that has been accidentally exposed (even for a short time).

### License server secrets
- `ADMIN_SESSION_SECRET` must be a cryptographically random string (≥ 32 bytes).  
  Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `ADMIN_PASSWORD` must be changed from the default before any public deployment.

### Database files
- The SQLite databases (`licenses.db`, `cloud.db`) contain customer email addresses, license keys, and activation records.
- Keep DB files on the VPS only.
- Restrict VPS SSH access to authorized keys; disable password auth.
- Schedule regular encrypted off-server backups.

---

## OWASP mitigations in place

| Risk | Mitigation |
|---|---|
| Injection | Parameterized SQL queries throughout (`better-sqlite3`, `sqlite3` prepared statements) |
| Broken auth | Admin UI uses session cookie auth; Stripe webhooks verified by signature |
| Sensitive data exposure | `.env` excluded from git; license keys masked in logs (`maskLicenseKey`) |
| Security misconfiguration | `x-powered-by` disabled; CORS origin locked per service |
| DoS | In-memory rate limiter (120 req/min/IP) in `cloud-api/server.js` |
| SSRF | License server only contacts Stripe API; no user-controlled URLs |

---

## Incident response

If a secret is accidentally committed:

1. **Immediately rotate** the exposed key (Stripe dashboard, SMTP provider, etc.).
2. Remove the secret from git history:
   ```bash
   git filter-repo --path .env --invert-paths
   # or use BFG Repo Cleaner
   ```
3. Force-push the cleaned history (coordinate with all collaborators).
4. Verify the key is gone: `git log --all --full-history -- .env`
5. Notify affected parties if customer data may have been exposed.

---

## Reporting a vulnerability

If you discover a security issue, please email **security@civicflowapp.com** directly.  
Do not open a public GitHub issue for security vulnerabilities.
