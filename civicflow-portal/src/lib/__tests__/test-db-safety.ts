/**
 * fix/pta-treasurer-financial-controls — shared safety gate for any test
 * that wants a real Postgres connection. Deliberately reads ONLY a
 * dedicated, opt-in env var (never the ambient `DATABASE_URL`, which in
 * this repository's own `.env`/`.env.local` has pointed at production
 * before) and refuses to hand back a connection string for anything that
 * doesn't look like an obviously-disposable local database.
 *
 * This module never logs, returns-for-display, or otherwise prints the
 * password component of a connection string — callers get back the full
 * URL (because that's what PrismaClient needs to connect) or a thrown
 * SafetyRejection with a message built only from non-secret fields
 * (host/port/dbname), never the raw input string.
 */

export class TestDatabaseSafetyError extends Error {}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const FORBIDDEN_DB_NAMES = new Set(["defaultdb", "postgres"]);

export interface SafeTestDatabaseTarget {
  url: string;
  host: string;
  port: string;
  database: string;
}

/**
 * Reads `process.env[envVarName]` (NOT `DATABASE_URL`) and validates it
 * before returning. Returns `null` (meaning "skip, not configured") if the
 * variable is unset. Throws `TestDatabaseSafetyError` — never silently
 * proceeds — if the variable is set but fails any safety check.
 */
export function resolveSafeTestDatabaseUrl(envVarName: string, requiredDbNameSubstring: string): SafeTestDatabaseTarget | null {
  const raw = process.env[envVarName];
  if (!raw) return null;

  let host: string;
  let port: string;
  let database: string;
  try {
    const parsed = new URL(raw);
    host = parsed.hostname;
    port = parsed.port || "5432";
    database = parsed.pathname.replace(/^\//, "");
  } catch {
    throw new TestDatabaseSafetyError(`${envVarName} is not a valid connection URL.`);
  }

  if (!LOOPBACK_HOSTS.has(host)) {
    throw new TestDatabaseSafetyError(`Refusing to run: ${envVarName}'s host ("${host}") is not localhost/127.0.0.1/::1. Real-DB tests only ever run against a loopback database.`);
  }
  if (!database) {
    throw new TestDatabaseSafetyError(`Refusing to run: ${envVarName} has no database name in its path.`);
  }
  if (FORBIDDEN_DB_NAMES.has(database.toLowerCase())) {
    throw new TestDatabaseSafetyError(`Refusing to run: ${envVarName}'s database name ("${database}") is a forbidden default/admin database name, not a dedicated disposable one.`);
  }
  if (database.toLowerCase().includes("prod")) {
    throw new TestDatabaseSafetyError(`Refusing to run: ${envVarName}'s database name ("${database}") contains "prod".`);
  }
  if (!database.toLowerCase().includes(requiredDbNameSubstring.toLowerCase())) {
    throw new TestDatabaseSafetyError(
      `Refusing to run: ${envVarName}'s database name ("${database}") does not contain the required disposable-test marker "${requiredDbNameSubstring}". Create a dedicated database whose name makes that unambiguous, e.g. "civicflow_treasurer_integration_test".`
    );
  }

  return { url: raw, host, port, database };
}
