"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName } from "@/components/forms/formStyles";

type MemberRow = { id: string; firstName: string; lastName: string; currentStatus?: string };
const statuses = ["PRESENT", "ABSENT", "EXCUSED", "LATE", "VIRTUAL"] as const;

export function BulkMeetingAttendanceForm({ meetingId, members }: { meetingId: string; members: MemberRow[] }) {
  const router = useRouter();
  const [records, setRecords] = useState<Record<string, { selected: boolean; status: string }>>(
    Object.fromEntries(members.map((member) => [member.id, { selected: Boolean(member.currentStatus), status: member.currentStatus ?? "PRESENT" }]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedCount = Object.values(records).filter((record) => record.selected).length;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          records: Object.entries(records)
            .filter(([, record]) => record.selected)
            .map(([memberId, record]) => ({ memberId, attendanceStatus: record.status })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to save attendance.");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700">{selectedCount} members selected for attendance save.</p>
        <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">{saving ? "Saving..." : "Save Attendance"}</button>
      </div>
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr><th className="px-4 py-3">Attended</th><th className="px-4 py-3">Member</th><th className="px-4 py-3">Status</th></tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const record = records[member.id] ?? { selected: false, status: "PRESENT" };
              return (
                <tr key={member.id} className="border-t border-slate-100">
                  <td className="px-4 py-3"><input type="checkbox" checked={record.selected} onChange={(e) => setRecords((current) => ({ ...current, [member.id]: { ...record, selected: e.target.checked } }))} className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600" /></td>
                  <td className="px-4 py-3 font-medium text-slate-950">{member.lastName}, {member.firstName}</td>
                  <td className="px-4 py-3">
                    <select value={record.status} onChange={(e) => setRecords((current) => ({ ...current, [member.id]: { ...record, status: e.target.value } }))} className={fieldClassName}>
                      {statuses.map((status) => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </form>
  );
}

