"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { fieldClassName, helperTextClassName } from "@/components/forms/formStyles";

interface MaskedSmsCredentialsView {
  accountSid: string | null;
  apiKey: string | null;
  authTokenConfigured: boolean;
  apiSecretConfigured: boolean;
  messagingServiceSid: string | null;
  tollFreeNumber: string | null;
  verifyServiceSidConfigured: boolean;
  source: "database" | "env" | "unconfigured";
}

type TestConnectionResult = {
  success: boolean;
  error?: string;
  accountFriendlyName?: string;
  accountStatus?: string;
  messagingServiceFriendlyName?: string;
};

const SOURCE_LABEL: Record<MaskedSmsCredentialsView["source"], string> = {
  database: "Configured via this dashboard",
  env: "Falling back to environment variables (legacy)",
  unconfigured: "Not configured",
};

export function SmsCredentialsPanel({ credentials }: { credentials: MaskedSmsCredentialsView }) {
  const router = useRouter();
  const [form, setForm] = useState({
    accountSid: "",
    authToken: "",
    apiKey: "",
    apiSecret: "",
    messagingServiceSid: "",
    tollFreeNumber: "",
    verifyServiceSid: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const body = Object.fromEntries(Object.entries(form).filter(([, value]) => value.trim() !== ""));
    if (Object.keys(body).length === 0) {
      setError("Enter at least one field to update.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/sms/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save credentials.");
        return;
      }
      setSaved(true);
      setForm({ accountSid: "", authToken: "", apiKey: "", apiSecret: "", messagingServiceSid: "", tollFreeNumber: "", verifyServiceSid: "" });
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/sms/test-connection", { method: "POST" });
      const data = await res.json().catch(() => null);
      setTestResult(data?.data ?? { success: false, error: "Unable to reach the test-connection endpoint." });
    } catch {
      setTestResult({ success: false, error: "Unable to connect. Please try again." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Account SID</p>
          <p className="font-mono text-slate-900">{credentials.accountSid ?? "Not configured"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">API Key</p>
          <p className="font-mono text-slate-900">{credentials.apiKey ?? "Not configured"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Auth Token</p>
          <p className="text-slate-900">{credentials.authTokenConfigured ? "Configured" : "Not configured"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">API Secret</p>
          <p className="text-slate-900">{credentials.apiSecretConfigured ? "Configured" : "Not configured"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Messaging Service SID</p>
          <p className="font-mono text-slate-900">{credentials.messagingServiceSid ?? "Not set"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Toll-Free Number</p>
          <p className="font-mono text-slate-900">{credentials.tollFreeNumber ?? "Not set"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Verify Service SID</p>
          <p className="text-slate-900">{credentials.verifyServiceSidConfigured ? "Configured" : "Not set"} <span className="text-xs text-slate-500">(future use)</span></p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">SMS Provider</p>
          <p className="text-slate-900">Twilio</p>
        </div>
        <div className="md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source</p>
          <p className="text-slate-900">{SOURCE_LABEL[credentials.source]}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={testing}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
        {testResult ? (
          <div
            className={`rounded-lg px-3 py-2 text-sm ${
              testResult.success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
            }`}
          >
            {testResult.success ? (
              <>
                Connected{testResult.accountFriendlyName ? ` — ${testResult.accountFriendlyName}` : ""}
                {testResult.accountStatus ? ` (${testResult.accountStatus})` : ""}
                {testResult.messagingServiceFriendlyName ? ` · Messaging Service: ${testResult.messagingServiceFriendlyName}` : ""}
              </>
            ) : (
              testResult.error || "Connection failed."
            )}
          </div>
        ) : null}
      </div>

      <form className="space-y-3" method="post" onSubmit={handleSave}>
        <p className="text-sm font-medium text-slate-900">Update credentials</p>
        <p className={helperTextClassName}>Leave a field blank to keep its current value.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1 text-sm text-slate-700">
            <span>Account SID</span>
            <input className={fieldClassName} value={form.accountSid} onChange={(e) => setField("accountSid", e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          </label>
          <label className="block space-y-1 text-sm text-slate-700">
            <span>Auth Token</span>
            <input type="password" className={fieldClassName} value={form.authToken} onChange={(e) => setField("authToken", e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm text-slate-700">
            <span>API Key</span>
            <input className={fieldClassName} value={form.apiKey} onChange={(e) => setField("apiKey", e.target.value)} placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          </label>
          <label className="block space-y-1 text-sm text-slate-700">
            <span>API Secret</span>
            <input type="password" className={fieldClassName} value={form.apiSecret} onChange={(e) => setField("apiSecret", e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm text-slate-700">
            <span>Messaging Service SID</span>
            <input className={fieldClassName} value={form.messagingServiceSid} onChange={(e) => setField("messagingServiceSid", e.target.value)} placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          </label>
          <label className="block space-y-1 text-sm text-slate-700">
            <span>Toll-Free Number</span>
            <input className={fieldClassName} value={form.tollFreeNumber} onChange={(e) => setField("tollFreeNumber", e.target.value)} placeholder="+18005551234" />
          </label>
          <label className="block space-y-1 text-sm text-slate-700">
            <span>Verify Service SID <span className="text-xs text-slate-400">(future use)</span></span>
            <input className={fieldClassName} value={form.verifyServiceSid} onChange={(e) => setField("verifyServiceSid", e.target.value)} placeholder="VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          </label>
        </div>

        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        {saved ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Credentials saved.</div> : null}

        <button
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Credentials"}
        </button>
      </form>
    </div>
  );
}
