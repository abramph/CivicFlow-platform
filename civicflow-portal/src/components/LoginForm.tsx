"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

export function LoginForm() {
  const [orgId, setOrgId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signIn("credentials", {
      redirect: false,
      org_id: orgId.trim(),
      api_key: apiKey.trim(),
      callbackUrl: "/dashboard",
    });

    if (!result || result.error) {
      setError("Invalid organization ID or API key.");
      setSubmitting(false);
      return;
    }

    window.location.href = result.url || "/dashboard";
  };

  return (
    <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-slate-900">CivicFlow Admin Portal</h1>
      <p className="mt-1 text-sm text-slate-600">Login with your organization API credentials.</p>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="org_id" className="mb-1 block text-sm font-medium text-slate-700">Organization ID</label>
          <input
            id="org_id"
            name="org_id"
            type="text"
            required
            value={orgId}
            onChange={(event) => setOrgId(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder="ulab"
          />
        </div>

        <div>
          <label htmlFor="api_key" className="mb-1 block text-sm font-medium text-slate-700">API Key</label>
          <input
            id="api_key"
            name="api_key"
            type="password"
            required
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder="Enter API key"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? "Logging in..." : "Login"}
        </button>
      </form>
    </div>
  );
}
