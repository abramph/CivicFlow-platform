"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ToggleDef {
  key:
    | "platformEnabled"
    | "testMode"
    | "maintenanceMode"
    | "outboundPaused"
    | "mfaSmsEnabled"
    | "orgMessagingEnabled";
  label: string;
  helper: string;
}

const TOGGLES: ToggleDef[] = [
  { key: "platformEnabled", label: "SMS Platform Enabled", helper: "Master switch — off stops every send except internal testing." },
  { key: "testMode", label: "Test Mode (Safe Launch)", helper: "Only the test phone numbers below can receive SMS while this is on." },
  { key: "maintenanceMode", label: "Maintenance Mode", helper: "Temporarily halts all sends for maintenance." },
  { key: "outboundPaused", label: "Outbound Paused", helper: "Pauses all outbound messages without changing any other setting." },
  { key: "mfaSmsEnabled", label: "MFA Text Messages", helper: "Allows SMS-based MFA/backup codes to be sent." },
  { key: "orgMessagingEnabled", label: "Organization Messaging", helper: "Allows orgs to send dues reminders, campaigns, and announcements via SMS." },
];

export function SmsGlobalControls({
  platformEnabled,
  testMode,
  maintenanceMode,
  outboundPaused,
  mfaSmsEnabled,
  orgMessagingEnabled,
  testPhoneNumbers,
  carrierFeePercent,
}: {
  platformEnabled: boolean;
  testMode: boolean;
  maintenanceMode: boolean;
  outboundPaused: boolean;
  mfaSmsEnabled: boolean;
  orgMessagingEnabled: boolean;
  testPhoneNumbers: string[];
  carrierFeePercent: number;
}) {
  const router = useRouter();
  const values: Record<ToggleDef["key"], boolean> = {
    platformEnabled,
    testMode,
    maintenanceMode,
    outboundPaused,
    mfaSmsEnabled,
    orgMessagingEnabled,
  };
  const [pending, setPending] = useState<string | null>(null);
  const [testNumbersText, setTestNumbersText] = useState(testPhoneNumbers.join("\n"));
  const [carrierFee, setCarrierFee] = useState(String(carrierFeePercent));
  const [error, setError] = useState<string | null>(null);

  async function updateSettings(body: Record<string, unknown>, pendingKey: string) {
    setPending(pendingKey);
    setError(null);
    try {
      const res = await fetch("/api/admin/sms/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save changes.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="grid gap-3 md:grid-cols-2">
        {TOGGLES.map((toggle) => (
          <div key={toggle.key} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-900">{toggle.label}</p>
              <p className="text-xs text-slate-600">{toggle.helper}</p>
            </div>
            <button
              type="button"
              disabled={pending === toggle.key}
              onClick={() => updateSettings({ [toggle.key]: !values[toggle.key] }, toggle.key)}
              aria-pressed={values[toggle.key]}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition disabled:opacity-60 ${
                values[toggle.key] ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"
              }`}
            >
              {values[toggle.key] ? "On" : "Off"}
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 px-4 py-3">
        <p className="text-sm font-medium text-slate-900">Safe Launch test phone numbers</p>
        <p className="text-xs text-slate-600">One E.164 number per line. Only these numbers receive SMS while Test Mode is on.</p>
        <textarea
          rows={3}
          value={testNumbersText}
          onChange={(e) => setTestNumbersText(e.target.value)}
          placeholder={"+15551234567\n+15559876543"}
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
        />
        <button
          type="button"
          disabled={pending === "testPhoneNumbers"}
          onClick={() =>
            updateSettings(
              { testPhoneNumbers: testNumbersText.split("\n").map((v) => v.trim()).filter(Boolean) },
              "testPhoneNumbers"
            )
          }
          className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          Save Test Numbers
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 px-4 py-3">
        <p className="text-sm font-medium text-slate-900">Estimated carrier fee</p>
        <p className="text-xs text-slate-600">
          Twilio&apos;s Messages API doesn&apos;t expose carrier fees separately from message price — this is a
          configurable estimate used only for the cost dashboard.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            value={carrierFee}
            onChange={(e) => setCarrierFee(e.target.value)}
            className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          />
          <span className="text-sm text-slate-600">%</span>
          <button
            type="button"
            disabled={pending === "carrierFeePercent"}
            onClick={() => updateSettings({ carrierFeePercent: Number(carrierFee) || 0 }, "carrierFeePercent")}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
