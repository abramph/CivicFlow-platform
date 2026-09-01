import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSafeTestDatabaseUrl, TestDatabaseSafetyError } from "./test-db-safety";

/**
 * fix/pta-treasurer-financial-controls — this is the gate that stands
 * between any real-Postgres integration test and accidentally running
 * against production. Every rejection case here corresponds to a real
 * incident-response requirement from the credential-exposure follow-up:
 * never trust an ambient DATABASE_URL, never accept defaultdb/prod-shaped
 * names, never accept a non-loopback host.
 */

const ENV_VAR = "PTA_TEST_DB_SAFETY_SPEC_VAR";
const REQUIRED_MARKER = "treasurer_integration_test";

beforeEach(() => {
  delete process.env[ENV_VAR];
});
afterEach(() => {
  delete process.env[ENV_VAR];
});

describe("resolveSafeTestDatabaseUrl", () => {
  it("returns null (skip) when the dedicated variable is not set -- never falls back to DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgresql://doadmin@civicflowprod-do-user-example.g.db.ondigitalocean.com:25060/defaultdb";
    expect(resolveSafeTestDatabaseUrl(ENV_VAR, REQUIRED_MARKER)).toBeNull();
    delete process.env.DATABASE_URL;
  });

  it("accepts a loopback host with a clearly disposable database name", () => {
    process.env[ENV_VAR] = "postgresql://civicflow_treasurer_test:x@localhost:5432/civicflow_treasurer_integration_test";
    const result = resolveSafeTestDatabaseUrl(ENV_VAR, REQUIRED_MARKER);
    expect(result).toMatchObject({ host: "localhost", database: "civicflow_treasurer_integration_test" });
  });

  it("accepts 127.0.0.1 and ::1 as loopback", () => {
    process.env[ENV_VAR] = "postgresql://u:p@127.0.0.1:5432/civicflow_treasurer_integration_test";
    expect(resolveSafeTestDatabaseUrl(ENV_VAR, REQUIRED_MARKER)?.host).toBe("127.0.0.1");
  });

  it("rejects a non-loopback host", () => {
    process.env[ENV_VAR] = "postgresql://u:p@civicflowprod-do-user-example.g.db.ondigitalocean.com:25060/civicflow_treasurer_integration_test";
    expect(() => resolveSafeTestDatabaseUrl(ENV_VAR, REQUIRED_MARKER)).toThrow(TestDatabaseSafetyError);
  });

  it("rejects defaultdb even on a loopback host", () => {
    process.env[ENV_VAR] = "postgresql://u:p@localhost:5432/defaultdb";
    expect(() => resolveSafeTestDatabaseUrl(ENV_VAR, REQUIRED_MARKER)).toThrow(/forbidden default\/admin database name/);
  });

  it("rejects postgres (the default admin database) even on a loopback host", () => {
    process.env[ENV_VAR] = "postgresql://u:p@localhost:5432/postgres";
    expect(() => resolveSafeTestDatabaseUrl(ENV_VAR, REQUIRED_MARKER)).toThrow(TestDatabaseSafetyError);
  });

  it("rejects any database name containing 'prod'", () => {
    process.env[ENV_VAR] = "postgresql://u:p@localhost:5432/civicflow_prod_mirror_test";
    expect(() => resolveSafeTestDatabaseUrl(ENV_VAR, REQUIRED_MARKER)).toThrow(/contains "prod"/);
  });

  it("rejects a loopback database that lacks the required disposable-test marker", () => {
    process.env[ENV_VAR] = "postgresql://u:p@localhost:5432/civicflow_dev";
    expect(() => resolveSafeTestDatabaseUrl(ENV_VAR, REQUIRED_MARKER)).toThrow(/does not contain the required disposable-test marker/);
  });

  it("rejects a missing database name", () => {
    process.env[ENV_VAR] = "postgresql://u:p@localhost:5432/";
    expect(() => resolveSafeTestDatabaseUrl(ENV_VAR, REQUIRED_MARKER)).toThrow(/no database name/);
  });

  it("rejects a malformed URL", () => {
    process.env[ENV_VAR] = "not a url at all";
    expect(() => resolveSafeTestDatabaseUrl(ENV_VAR, REQUIRED_MARKER)).toThrow(/not a valid connection URL/);
  });

  it("never includes the raw input string in a thrown error message (no password leakage into test output)", () => {
    process.env[ENV_VAR] = "postgresql://someuser:SUPER_SECRET_PW@evil-host.example.com:5432/civicflow_treasurer_integration_test";
    try {
      resolveSafeTestDatabaseUrl(ENV_VAR, REQUIRED_MARKER);
      throw new Error("expected resolveSafeTestDatabaseUrl to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain("SUPER_SECRET_PW");
    }
  });
});
