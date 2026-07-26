"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface GradeOption {
  id: string;
  name: string;
}
interface TeacherOption {
  id: string;
  name: string;
}

export function CreateClassroomForm({ schoolYear, grades, teachers }: { schoolYear: string; grades: GradeOption[]; teachers: TeacherOption[] }) {
  const router = useRouter();
  const [gradeId, setGradeId] = useState(grades[0]?.id ?? "");
  const [name, setName] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/labs/pta/classrooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gradeId, name, schoolYear, teacherId: teacherId || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create classroom.");
        return;
      }
      setName("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (grades.length === 0) {
    return <p className="text-xs text-slate-500">Add a grade first before creating a classroom.</p>;
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Grade</span>
        <select value={gradeId} onChange={(e) => setGradeId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {grades.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Classroom name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Room 12" className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Teacher (optional)</span>
        <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">None</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <button type="button" disabled={pending || !name.trim() || !gradeId} onClick={submit} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
        {pending ? "Adding..." : "Add classroom"}
      </button>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </div>
  );
}
