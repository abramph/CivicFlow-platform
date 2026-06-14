export const fieldClassName =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

export const fieldErrorClassName =
  "border-red-400 focus:border-red-600 focus:ring-red-200";

export const helperTextClassName = "text-xs leading-5 text-slate-600";

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
