import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertNotProduction } from "../../../prisma/seed-demo-guard";

describe("assertNotProduction — fictional demo-seed safety guard", () => {
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.DATABASE_URL = originalUrl;
  });

  it("throws when DATABASE_URL points at the known production host", () => {
    process.env.DATABASE_URL =
      "postgresql://doadmin:x@civicflowprod-do-user-38042660-0.g.db.ondigitalocean.com:25060/defaultdb?sslmode=require";
    expect(() => assertNotProduction()).toThrow(/production/i);
  });

  it("does not throw for a local/disposable database URL", () => {
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/civicflow_dev?schema=public";
    expect(() => assertNotProduction()).not.toThrow();
  });

  it("does not throw when DATABASE_URL is unset", () => {
    delete process.env.DATABASE_URL;
    expect(() => assertNotProduction()).not.toThrow();
  });
});
