"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { fieldClassName } from "@/components/forms/formStyles";

const FIELD_DEFS: { key: string; label: string; required: boolean }[] = [
  { key: "firstName", label: "First Name", required: false },
  { key: "lastName", label: "Last Name", required: false },
  { key: "email", label: "Email", required: false },
  { key: "phone", label: "Phone", required: false },
  { key: "joinDate", label: "Join Date", required: false },
  { key: "address", label: "Street Address", required: false },
  { key: "city", label: "City", required: false },
  { key: "state", label: "State", required: false },
  { key: "zip", label: "ZIP Code", required: false },
];

const COMMON_ALIASES: Record<string, string> = {
  "first name": "firstName", first_name: "firstName", firstname: "firstName",
  "last name": "lastName", last_name: "lastName", lastname: "lastName",
  email: "email", "email address": "email", "e-mail": "email",
  phone: "phone", "phone number": "phone", mobile: "phone",
  "join date": "joinDate", joined: "joinDate", join_date: "joinDate",
  address: "address", street: "address", "street address": "address",
  city: "city", state: "state", zip: "zip", "zip code": "zip", "postal code": "zip",
};

function autoMap(headers: string[]): Record<string, string> {
  const fields = FIELD_DEFS.map((f) => f.key);
  const result: Record<string, string> = {};
  for (const header of headers) {
    const matched = COMMON_ALIASES[header.toLowerCase().trim()];
    if (matched && fields.includes(matched) && !Object.values(result).includes(matched)) {
      result[header] = matched;
    }
  }
  return result;
}

type Step = "upload" | "map" | "submitting";

export function NewMemberImportForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [matchedBatch, setMatchedBatch] = useState<{ batchId: string; status: string; totalRows: number; importedCount: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFileSelected(selected: File) {
    setError(null);
    setFile(selected);
    setMatchedBatch(null);
    try {
      const buffer = await selected.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { raw: false, defval: "" });
      if (rows.length === 0) {
        setError("File is empty or has no data rows.");
        return;
      }
      const fileHeaders = Object.keys(rows[0]);
      setHeaders(fileHeaders);
      setMapping(autoMap(fileHeaders));
      setStep("map");
    } catch {
      setError("Could not read that file. Please upload a CSV or Excel file.");
    }
  }

  async function submit(forceNewAnalysis: boolean) {
    if (!file) return;
    setStep("submitting");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mapping", JSON.stringify(mapping));
      if (forceNewAnalysis) form.set("forceNewAnalysis", "1");

      const response = await fetch("/api/imports", { method: "POST", body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Upload failed.");
        setStep("map");
        return;
      }
      if (payload.data?.matchedExistingBatch) {
        setMatchedBatch(payload.data.matchedExistingBatch);
        setStep("map");
        return;
      }
      router.push(`/imports/${payload.data.batchId}`);
    } catch {
      setError("Unable to connect. Please try again.");
      setStep("map");
    }
  }

  if (step === "upload") {
    return (
      <div className="space-y-3">
        {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void onFileSelected(selected);
          }}
          className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-emerald-700 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-800"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

      {matchedBatch ? (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">This file appears to match an earlier import.</p>
          <p>
            Previous status: {matchedBatch.status.replaceAll("_", " ")} — Processed {matchedBatch.importedCount} of {matchedBatch.totalRows} rows.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push(`/imports/${matchedBatch.batchId}`)}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Resume previous import
            </button>
            <button
              type="button"
              onClick={() => submit(true)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Start a new analysis
            </button>
            <button
              type="button"
              onClick={() => {
                setMatchedBatch(null);
                setStep("upload");
                setFile(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-700">Match each column in your file to a member field.</p>
          <div className="space-y-2">
            {headers.map((header) => (
              <div key={header} className="flex items-center gap-3">
                <span className="w-48 truncate text-sm font-medium text-slate-800">{header}</span>
                <select
                  className={fieldClassName}
                  value={mapping[header] ?? ""}
                  onChange={(event) => setMapping((current) => ({ ...current, [header]: event.target.value }))}
                >
                  <option value="">Don&apos;t import</option>
                  {FIELD_DEFS.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={step === "submitting" || !Object.values(mapping).includes("firstName") && !Object.values(mapping).includes("lastName")}
              onClick={() => submit(false)}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400"
            >
              {step === "submitting" ? "Uploading..." : "Upload and Analyze"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("upload");
                setFile(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Choose a different file
            </button>
          </div>
        </>
      )}
    </div>
  );
}
