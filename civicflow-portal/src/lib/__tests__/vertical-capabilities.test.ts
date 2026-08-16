import { describe, expect, it } from "vitest";
import { getVerticalCapabilities, hasVerticalCapability } from "@/lib/vertical-capabilities";

describe("vertical-capabilities: HOA (PR #43 foundation)", () => {
  it("enables properties and propertyResidents for HOA", () => {
    const capabilities = getVerticalCapabilities("HOA");
    expect(capabilities.properties).toBe(true);
    expect(capabilities.propertyResidents).toBe(true);
  });

  it("enables violations and architecturalRequests but not maintenanceRequests yet -- that model doesn't exist until a later PR", () => {
    const capabilities = getVerticalCapabilities("HOA");
    expect(capabilities.violations).toBe(true);
    expect(capabilities.architecturalRequests).toBe(true);
    expect(capabilities.maintenanceRequests).toBe(false);
  });
});

describe("vertical-capabilities: Community/PTA/Union never get HOA property capabilities", () => {
  it("Community has neither properties nor propertyResidents", () => {
    expect(hasVerticalCapability("COMMUNITY", "properties")).toBe(false);
    expect(hasVerticalCapability("COMMUNITY", "propertyResidents")).toBe(false);
  });

  it("PTA has neither -- it has ptaHouseholds instead", () => {
    expect(hasVerticalCapability("PTA", "properties")).toBe(false);
    expect(hasVerticalCapability("PTA", "propertyResidents")).toBe(false);
    expect(hasVerticalCapability("PTA", "ptaHouseholds")).toBe(true);
  });

  it("Union has neither -- it has payrollCheckoff instead", () => {
    expect(hasVerticalCapability("UNION", "properties")).toBe(false);
    expect(hasVerticalCapability("UNION", "propertyResidents")).toBe(false);
    expect(hasVerticalCapability("UNION", "payrollCheckoff")).toBe(true);
  });

  it("Church has no vertical-level capability flags -- giving is gated by real Fund/ContributionProgram data, same as Community", () => {
    const capabilities = getVerticalCapabilities("CHURCH");
    expect(Object.values(capabilities).every((v) => v === false)).toBe(true);
  });
});

describe("vertical-capabilities: getVerticalCapabilities always returns every known flag", () => {
  it("never requires an ?? false fallback from the caller", () => {
    for (const vertical of ["COMMUNITY", "PTA", "UNION", "HOA", "CHURCH"] as const) {
      const capabilities = getVerticalCapabilities(vertical);
      expect(typeof capabilities.properties).toBe("boolean");
      expect(typeof capabilities.propertyResidents).toBe("boolean");
      expect(typeof capabilities.violations).toBe("boolean");
      expect(typeof capabilities.architecturalRequests).toBe("boolean");
      expect(typeof capabilities.maintenanceRequests).toBe("boolean");
      expect(typeof capabilities.payrollCheckoff).toBe("boolean");
      expect(typeof capabilities.ptaHouseholds).toBe("boolean");
    }
  });
});
