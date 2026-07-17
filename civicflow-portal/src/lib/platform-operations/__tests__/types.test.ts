import { describe, expect, it } from "vitest";
import { normalizePagination, paginationResult, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../types";

describe("normalizePagination", () => {
  it("defaults page to 1 and pageSize to the default when nothing is provided", () => {
    expect(normalizePagination({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it("accepts valid numeric strings (as query params always are)", () => {
    expect(normalizePagination({ page: "3", pageSize: "10" })).toEqual({ page: 3, pageSize: 10 });
  });

  it("clamps an oversized pageSize to MAX_PAGE_SIZE", () => {
    expect(normalizePagination({ pageSize: "999999" }).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("rejects a zero or negative page, falling back to 1", () => {
    expect(normalizePagination({ page: "0" }).page).toBe(1);
    expect(normalizePagination({ page: "-5" }).page).toBe(1);
  });

  it("rejects a zero or negative pageSize, falling back to the default", () => {
    expect(normalizePagination({ pageSize: "0" }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePagination({ pageSize: "-1" }).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("rejects non-numeric input, falling back to defaults", () => {
    expect(normalizePagination({ page: "abc", pageSize: "xyz" })).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it("floors fractional input", () => {
    expect(normalizePagination({ page: "2.9" }).page).toBe(2);
  });
});

describe("paginationResult", () => {
  it("computes totalPages by ceiling division", () => {
    expect(paginationResult({ page: 1, pageSize: 25 }, 51).totalPages).toBe(3);
    expect(paginationResult({ page: 1, pageSize: 25 }, 50).totalPages).toBe(2);
    expect(paginationResult({ page: 1, pageSize: 25 }, 1).totalPages).toBe(1);
  });

  it("always reports at least 1 page, even with zero results", () => {
    expect(paginationResult({ page: 1, pageSize: 25 }, 0).totalPages).toBe(1);
  });

  it("echoes back the requested page and pageSize alongside the computed total", () => {
    const result = paginationResult({ page: 2, pageSize: 10 }, 35);
    expect(result).toEqual({ page: 2, pageSize: 10, totalCount: 35, totalPages: 4 });
  });
});
