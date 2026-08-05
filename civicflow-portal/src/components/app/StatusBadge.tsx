import { formatEnumLabel } from "@/lib/formatting";

type StatusTone = "positive" | "caution" | "critical" | "neutral";

const TONE_CLASSES: Record<StatusTone, string> = {
  positive: "border-emerald-300 bg-emerald-50 text-emerald-800",
  caution: "border-amber-300 bg-amber-50 text-amber-800",
  critical: "border-red-300 bg-red-50 text-red-800",
  neutral: "border-slate-300 bg-slate-100 text-slate-700",
};

const MEMBERSHIP_STATUS_TONE: Record<string, StatusTone> = {
  active: "positive",
  pending: "caution",
  inactive: "neutral",
  deactivated: "neutral",
  retired: "neutral",
  suspended: "caution",
  terminated: "critical",
  delinquent: "critical",
};

/**
 * A colored pill that always renders a text label alongside color -- status
 * must never be conveyed by color alone. Pass a raw membershipStatus (or
 * "delinquent") for automatic tone mapping, or an explicit `tone` for
 * anything else (e.g. a workflow status this component doesn't know about).
 */
export function StatusBadge({
  status,
  label,
  tone,
}: {
  status?: string;
  label?: string;
  tone?: StatusTone;
}) {
  const resolvedTone = tone ?? (status ? (MEMBERSHIP_STATUS_TONE[status] ?? "neutral") : "neutral");
  const resolvedLabel = label ?? formatEnumLabel(status);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[resolvedTone]}`}
    >
      {resolvedLabel}
    </span>
  );
}
