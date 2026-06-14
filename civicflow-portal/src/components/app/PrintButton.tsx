"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
    >
      Print
    </button>
  );
}
