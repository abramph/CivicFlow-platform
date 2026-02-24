import { requirePortalSession } from "@/lib/session";

export default async function SettingsPage() {
  const session = await requirePortalSession();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="mt-1 text-sm text-slate-600">Current organization connection profile</p>
      </div>

      <div className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="font-medium text-slate-500">Organization ID</dt>
            <dd className="mt-1 rounded-md bg-slate-50 px-3 py-2 font-mono text-slate-800">{session.org_id}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">API Base URL</dt>
            <dd className="mt-1 rounded-md bg-slate-50 px-3 py-2 font-mono text-slate-800">{session.api_base}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">API Key</dt>
            <dd className="mt-1 rounded-md bg-slate-50 px-3 py-2 font-mono text-slate-800">Configured in session</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
