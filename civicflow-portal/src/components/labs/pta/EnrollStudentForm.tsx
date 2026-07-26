"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ClassroomOption {
  id: string;
  name: string;
  gradeName: string;
}

export function EnrollStudentForm({
  studentId,
  schoolYear,
  classrooms,
  currentClassroomId,
}: {
  studentId: string;
  schoolYear: string;
  classrooms: ClassroomOption[];
  currentClassroomId?: string | null;
}) {
  const router = useRouter();
  const [classroomId, setClassroomId] = useState(currentClassroomId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!classroomId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/students/${studentId}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classroomId, schoolYear }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to enroll student.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (classrooms.length === 0) {
    return <p className="text-xs text-slate-500">No classrooms exist yet for {schoolYear} — set them up on the Academic page.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={classroomId} onChange={(e) => setClassroomId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
        <option value="">Select classroom…</option>
        {classrooms.map((c) => (
          <option key={c.id} value={c.id}>
            {c.gradeName} — {c.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending || !classroomId || classroomId === currentClassroomId}
        onClick={submit}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Saving..." : currentClassroomId ? "Transfer" : "Enroll"}
      </button>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </div>
  );
}
