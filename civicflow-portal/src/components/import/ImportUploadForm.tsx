"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import type { ImportKind } from "@prisma/client";
import { fieldClassName } from "@/components/forms/formStyles";
import { type ImportType, FIELD_DEFS, COMMON_ALIASES } from "@/lib/imports/field-defs";

/**
 * Resumable Import Program (PR C) — the same upload/map/submit flow PR A
 * shipped for Community members (as NewMemberImportForm), now parameterized
 * by kind so PTA households and HOA properties share it instead of getting
 * near-duplicate components. Field defs/aliases come from
 * src/lib/imports/field-defs.ts — the exact same entries the old `/import`
 * page's ImportPageClient.tsx already uses, not redesigned.
 */
const KIND_TO_FIELD_TYPE: Record<ImportKind, ImportType> = {
  COMMUNITY_MEMBERS: "members",
  PTA_HOUSEHOLDS: "pta-households",
  HOA_PROPERTIES: "hoa-properties",
};

function autoMap(headers: string[], fieldType: ImportType): Record<string, string> {
  const fields = FIELD_DEFS[fieldType].map((f) => f.key);
  const result: Record<string, string> = {};
  for (const header of headers) {
    const matched = COMMON_ALIASES[header.toLowerCase().trim()];
    if (matched && fields.includes(matched) && !Object.values(result).includes(matched)) {
      result[header] = matched;
    }
  }
  return result;
}

/** Community keeps its original "at least one of first/last name" rule
 * (both are marked required in FIELD_DEFS, but either alone is acceptable).
 * PTA/HOA require every field FIELD_DEFS marks required — householdName/
 * schoolYear/contactName, or addressLine1, respectively. */
function isMappingComplete(fieldType: ImportType, mapping: Record<string, string>): boolean {
  const mappedFields = new Set(Object.values(mapping));
  if (fieldType === "members") {
    return mappedFields.has("firstName") || mappedFields.has("lastName");
  }
  return FIELD_DEFS[fieldType].filter((f) => f.required).every((f) => mappedFields.has(f.key));
}

type Step = "upload" | "map" | "submitting";

export function ImportUploadForm({ kind }: { kind: ImportKind }) {
  const router = useRouter();
  const fieldType = KIND_TO_FIELD_TYPE[kind];
  const fieldDefs = FIELD_DEFS[fieldType];

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
      setMapping(autoMap(fileHeaders, fieldType));
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
      form.set("kind", kind);
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
          <p className="text-sm text-slate-700">Match each column in your file to a field.</p>
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
                  {fieldDefs.map((field) => (
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
              disabled={step === "submitting" || !isMappingComplete(fieldType, mapping)}
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
