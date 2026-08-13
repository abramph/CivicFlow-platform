"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ReportView {
  schoolYear: string | null;
  totals: { approvedMinutes: number; approvedEntries: number; distinctVolunteers: number };
  byEvent: { label: string; minutes: number; volunteers: number }[];
  byCommittee: { label: string; minutes: number; volunteers: number }[];
  topVolunteers: { name: string; minutes: number; entries: number }[];
  unfilledOpportunities: { title: string; startAt: string | null; openSpots: number; totalCapacity: number }[];
  participationByMonth: { month: string; minutes: number; volunteers: number }[];
}

function hours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

function downloadCsv(fileName: string, header: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** PTA-G — §16 volunteer reports with per-section CSV export and the
 * reminder "send now" control. Server enforces permissions; CSVs are built
 * client-side from the same data already on screen. */
export function PtaVolunteerReports({ report }: { report: ReportView }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendReminders() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/labs/pta/volunteers/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to send reminders.");
        return;
      }
      const result = data.data as { sent: number; skippedNoEmail: number; failed: number };
      setMessage(
        `Reminders sent: ${result.sent}.` +
          (result.skippedNoEmail ? ` ${result.skippedNoEmail} volunteer(s) have no email on file.` : "") +
          (result.failed ? ` ${result.failed} failed — they will be retried automatically.` : "")
      );
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const sectionTitle = "text-sm font-semibold text-slate-900";
  const table = "min-w-full divide-y divide-slate-200 text-sm";
  const th = "py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
  const td = "py-2 pr-4 text-slate-800";
  const csvButton = "rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-2xl font-bold text-slate-900">{hours(report.totals.approvedMinutes)}</p>
          <p className="text-xs text-slate-500">approved volunteer hours</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-2xl font-bold text-slate-900">{report.totals.distinctVolunteers}</p>
          <p className="text-xs text-slate-500">volunteers credited</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-2xl font-bold text-slate-900">{report.totals.approvedEntries}</p>
          <p className="text-xs text-slate-500">approved entries</p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={sendReminders}
          className="ml-auto rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          Send shift reminders now
        </button>
      </div>
      {message ? <p className="text-sm font-medium text-emerald-700">{message}</p> : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <h3 className={sectionTitle}>Hours by event</h3>
            <button type="button" className={csvButton} onClick={() => downloadCsv("volunteer-hours-by-event.csv", ["Event", "Hours", "Volunteers"], report.byEvent.map((row) => [row.label, hours(row.minutes), row.volunteers]))}>
              CSV
            </button>
          </div>
          {report.byEvent.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">No approved hours yet.</p>
          ) : (
            <table className={table}>
              <thead><tr><th className={th}>Event</th><th className={th}>Hours</th><th className={th}>Volunteers</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {report.byEvent.slice(0, 15).map((row) => (
                  <tr key={row.label}><td className={td}>{row.label}</td><td className={td}>{hours(row.minutes)}</td><td className={td}>{row.volunteers}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h3 className={sectionTitle}>Hours by committee</h3>
            <button type="button" className={csvButton} onClick={() => downloadCsv("volunteer-hours-by-committee.csv", ["Committee", "Hours", "Volunteers"], report.byCommittee.map((row) => [row.label, hours(row.minutes), row.volunteers]))}>
              CSV
            </button>
          </div>
          {report.byCommittee.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">No committee-linked hours yet.</p>
          ) : (
            <table className={table}>
              <thead><tr><th className={th}>Committee</th><th className={th}>Hours</th><th className={th}>Volunteers</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {report.byCommittee.map((row) => (
                  <tr key={row.label}><td className={td}>{row.label}</td><td className={td}>{hours(row.minutes)}</td><td className={td}>{row.volunteers}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h3 className={sectionTitle}>Most active volunteers</h3>
            <button type="button" className={csvButton} onClick={() => downloadCsv("most-active-volunteers.csv", ["Volunteer", "Hours", "Entries"], report.topVolunteers.map((row) => [row.name, hours(row.minutes), row.entries]))}>
              CSV
            </button>
          </div>
          <p className="text-xs text-slate-500">Coordination view for officers — not shown to members.</p>
          {report.topVolunteers.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">No approved hours yet.</p>
          ) : (
            <table className={table}>
              <thead><tr><th className={th}>Volunteer</th><th className={th}>Hours</th><th className={th}>Entries</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {report.topVolunteers.map((row) => (
                  <tr key={row.name}><td className={td}>{row.name}</td><td className={td}>{hours(row.minutes)}</td><td className={td}>{row.entries}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h3 className={sectionTitle}>Unfilled opportunities</h3>
            <button type="button" className={csvButton} onClick={() => downloadCsv("unfilled-opportunities.csv", ["Opportunity", "Starts", "Open spots", "Capacity"], report.unfilledOpportunities.map((row) => [row.title, row.startAt ? new Date(row.startAt).toLocaleDateString() : "", row.openSpots, row.totalCapacity]))}>
              CSV
            </button>
          </div>
          {report.unfilledOpportunities.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">Every open opportunity is fully staffed.</p>
          ) : (
            <table className={table}>
              <thead><tr><th className={th}>Opportunity</th><th className={th}>Starts</th><th className={th}>Open spots</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {report.unfilledOpportunities.map((row) => (
                  <tr key={`${row.title}-${row.startAt}`}>
                    <td className={td}>{row.title}</td>
                    <td className={td}>{row.startAt ? new Date(row.startAt).toLocaleDateString() : "—"}</td>
                    <td className={td}>
                      {row.openSpots} of {row.totalCapacity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className={sectionTitle}>Participation by month</h3>
          <button type="button" className={csvButton} onClick={() => downloadCsv("participation-by-month.csv", ["Month", "Hours", "Volunteers"], report.participationByMonth.map((row) => [row.month, hours(row.minutes), row.volunteers]))}>
            CSV
          </button>
        </div>
        {report.participationByMonth.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">No approved hours yet.</p>
        ) : (
          <div className="flex items-end gap-2 overflow-x-auto pt-2">
            {report.participationByMonth.map((row) => {
              const max = Math.max(...report.participationByMonth.map((r) => r.minutes), 1);
              return (
                <div key={row.month} className="flex flex-col items-center gap-1">
                  <span className="text-xs text-slate-600">{hours(row.minutes)}h</span>
                  <div className="w-10 rounded-t bg-emerald-600" style={{ height: `${Math.max(6, Math.round((row.minutes / max) * 120))}px` }} />
                  <span className="text-xs text-slate-500">{row.month}</span>
                  <span className="text-[10px] text-slate-400">{row.volunteers} vol.</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
