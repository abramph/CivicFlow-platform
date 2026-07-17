/**
 * Shared types for the APH Operations Center data layer
 * (src/lib/platform-operations/*.ts). Server-only.
 *
 * Every module in this directory returns plain, typed, pre-shaped objects —
 * never a raw Prisma model — so a page component can never accidentally pass
 * an over-fetched Prisma record (with fields like passwordHash, mfaSecret,
 * encrypted credentials, etc.) into a Client Component or JSON response.
 */

/** How a data point was obtained, shown next to every metric that isn't a trivial DB count. */
export type DataSource = "database" | "stripe" | "twilio" | "brevo" | "expo" | "health-check" | "derived";

/** Whether a value reflects a live check ("live"), a stored/derived record ("cached"), a config-presence check standing in for a live probe ("inferred"), or couldn't be determined at all ("unavailable"). */
export type Freshness = "live" | "cached" | "inferred" | "unavailable";

export interface SourcedValue<T> {
  value: T;
  source: DataSource;
  freshness: Freshness;
  /** ISO timestamp this value was computed/checked, for "as of" display. */
  asOf: string;
}

/** A metric that may not be calculable — callers must render "Unavailable"/"Not configured", never a fabricated 0. */
export type Metric<T> =
  | { status: "ok"; value: T; source: DataSource; asOf: string }
  | { status: "unavailable"; reason: string; source: DataSource }
  | { status: "not_configured"; reason: string };

export interface PaginationInput {
  page: number;
  pageSize: number;
}

export interface PaginationResult {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface PagedResult<T> {
  items: T[];
  pagination: PaginationResult;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_REPORTING_WINDOW_DAYS = 30;

/** Clamps arbitrary page/pageSize input (e.g. from a query string) to safe, bounded values. */
export function normalizePagination(input: { page?: unknown; pageSize?: unknown }): PaginationInput {
  const pageRaw = Number(input.page);
  const pageSizeRaw = Number(input.pageSize);

  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1
      ? Math.min(Math.floor(pageSizeRaw), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  return { page, pageSize };
}

export function paginationResult(input: PaginationInput, totalCount: number): PaginationResult {
  return {
    page: input.page,
    pageSize: input.pageSize,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / input.pageSize)),
  };
}

export type RiskSeverity = "info" | "warning" | "critical";

export interface OperationalRisk {
  id: string;
  severity: RiskSeverity;
  title: string;
  explanation: string;
  affectedEntity: { type: string; id: string; label: string } | null;
  firstDetectedAt: string | null;
  href: string;
  source: DataSource;
}

export type ServiceStatus = "healthy" | "degraded" | "unavailable" | "not_configured" | "unknown";

export interface ServiceHealth {
  service: string;
  status: ServiceStatus;
  checkedAt: string;
  responseTimeMs: number | null;
  message: string;
  freshness: Freshness;
}
