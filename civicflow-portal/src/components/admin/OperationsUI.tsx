import Link from "next/link";
import type { ReactNode } from "react";
import type { Metric, RiskSeverity, ServiceStatus } from "@/lib/platform-operations/types";

const STATUS_STYLES: Record<string, string> = {
  healthy: "bg-emerald-100 text-emerald-800",
  ok: "bg-emerald-100 text-emerald-800",
  active: "bg-emerald-100 text-emerald-800",
  degraded: "bg-amber-100 text-amber-800",
  attention: "bg-amber-100 text-amber-800",
  warning: "bg-amber-100 text-amber-800",
  unavailable: "bg-red-100 text-red-800",
  critical: "bg-red-100 text-red-800",
  not_configured: "bg-slate-200 text-slate-700",
  unknown: "bg-slate-200 text-slate-700",
  info: "bg-sky-100 text-sky-800",
};

/** Status is always conveyed by icon+text together here, never color alone (accessibility requirement). */
const STATUS_ICON: Record<string, string> = {
  healthy: "●",
  ok: "●",
  active: "●",
  degraded: "▲",
  attention: "▲",
  warning: "▲",
  unavailable: "✕",
  critical: "✕",
  not_configured: "○",
  unknown: "○",
  info: "ℹ",
};

export function StatusPill({ status, label }: { status: ServiceStatus | RiskSeverity | string; label?: string }) {
  const style = STATUS_STYLES[status] ?? "bg-slate-200 text-slate-700";
  const icon = STATUS_ICON[status] ?? "○";
  const text = label ?? status.replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${style}`}>
      <span aria-hidden="true">{icon}</span>
      {text}
    </span>
  );
}

/** Renders a Metric<T> safely — "Unavailable"/"Not configured" text, never a fabricated 0, with the data source visible on hover via title. */
export function MetricValue<T>({ metric, format }: { metric: Metric<T>; format: (value: T) => ReactNode }) {
  if (metric.status === "ok") {
    return (
      <span title={`Source: ${metric.source} · As of ${new Date(metric.asOf).toLocaleString()}`}>
        {format(metric.value)}
      </span>
    );
  }
  if (metric.status === "not_configured") {
    return (
      <span className="text-sm font-normal text-slate-500" title={metric.reason}>
        Not configured
      </span>
    );
  }
  return (
    <span className="text-sm font-normal text-slate-500" title={metric.reason}>
      Unavailable
    </span>
  );
}

export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-slate-950 hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-slate-900">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Pagination({
  basePath,
  searchParams,
  page,
  totalPages,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  page: number;
  totalPages: number;
}) {
  function hrefFor(targetPage: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value && key !== "page") params.set(key, value);
    }
    params.set("page", String(targetPage));
    return `${basePath}?${params.toString()}`;
  }

  if (totalPages <= 1) return null;

  const disabledClass = "rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-400";
  const enabledClass =
    "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600";

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
      <p className="text-sm text-slate-700">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        {/* A disabled control renders as a non-interactive <span>, not a
            styled-to-look-disabled <a> — aria-disabled on an anchor doesn't
            stop it from being keyboard-focusable and Enter-activatable, so
            that pattern alone doesn't actually satisfy "disabled". */}
        {page <= 1 ? (
          <span aria-disabled="true" className={disabledClass}>
            Previous
          </span>
        ) : (
          <Link href={hrefFor(page - 1)} className={enabledClass}>
            Previous
          </Link>
        )}
        {page >= totalPages ? (
          <span aria-disabled="true" className={disabledClass}>
            Next
          </span>
        ) : (
          <Link href={hrefFor(page + 1)} className={enabledClass}>
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <p className="font-semibold text-slate-900">{title}</p>
      {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
    </div>
  );
}

