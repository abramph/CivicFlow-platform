"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PROGRAM_TYPE_LABELS: Record<string, string> = {
  DUES: "Membership dues (required)",
  VOLUNTARY_CONTRIBUTION: "Voluntary contribution",
  SUGGESTED_CONTRIBUTION: "Suggested contribution",
  ONE_TIME_GIVING: "One-time giving",
  PLEDGE_CAMPAIGN: "Pledge campaign",
  FUNDRAISER: "Fundraiser",
  SPECIAL_OFFERING: "Special offering",
  SPONSORSHIP: "Sponsorship",
  OTHER: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  DRAFT: "bg-slate-100 text-slate-600",
  INACTIVE: "bg-amber-100 text-amber-800",
  CLOSED: "bg-slate-200 text-slate-700",
  ARCHIVED: "bg-slate-200 text-slate-500",
};

interface FundView {
  id: string;
  name: string;
  description: string | null;
  status: string;
  isPublic: boolean;
  allowPledges: boolean;
  suggestedAmounts: number[];
  programCount: number;
  contributionCount: number;
}

interface ProgramView {
  id: string;
  name: string;
  type: string;
  obligationNature: string;
  status: string;
  fundName: string;
  allowedFrequencies: string[];
}

/** CORE-GIVE-A — module setup. The server enforces every rule (obligation
 * nature, fund lifecycle, permissions); this component narrates them. */
export function GivingSetupManager({
  settings,
  slug = "",
  funds,
  programs,
  viewer,
}: {
  settings: {
    contributionsEnabled: boolean;
    terminology: string;
    householdGivingEnabled: boolean;
    householdGivingPrivacyMode: string;
    publicGivingEnabled: boolean;
    publicGivingMessage: string | null;
  };
  slug?: string;
  funds: FundView[];
  programs: ProgramView[];
  viewer: { canManageFunds: boolean; canManagePrograms: boolean };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminology, setTerminology] = useState(settings.terminology);

  const [fundName, setFundName] = useState("");
  const [fundDescription, setFundDescription] = useState("");
  const [fundSuggested, setFundSuggested] = useState("");

  const [publicMessage, setPublicMessage] = useState(settings.publicGivingMessage ?? "");
  const [publicCampaigns, setPublicCampaigns] = useState<
    { id: string; name: string; goal: number | null; showPublicProgress: boolean }[] | null
  >(null);

  const [programName, setProgramName] = useState("");
  const [programFundId, setProgramFundId] = useState("");
  const [programType, setProgramType] = useState("VOLUNTARY_CONTRIBUTION");

  async function call(path: string, init?: RequestInit): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save.");
        return false;
      }
      return true;
    } catch {
      setError("Unable to connect. Please try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function saveSettings(body: Record<string, unknown>) {
    if (await call("/api/giving/settings", { method: "PUT", body: JSON.stringify(body) })) router.refresh();
  }

  async function addFund() {
    const suggested = fundSuggested
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);
    const ok = await call("/api/funds", {
      method: "POST",
      body: JSON.stringify({ name: fundName.trim(), description: fundDescription.trim() || null, suggestedAmounts: suggested }),
    });
    if (ok) {
      setFundName("");
      setFundDescription("");
      setFundSuggested("");
      router.refresh();
    }
  }

  async function setFundStatus(fundId: string, status: string) {
    if (await call(`/api/funds/${fundId}`, { method: "PATCH", body: JSON.stringify({ status }) })) router.refresh();
  }

  async function loadPublicCampaigns() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/giving/public-campaigns");
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to load campaigns.");
        return;
      }
      setPublicCampaigns(data.data);
    } finally {
      setPending(false);
    }
  }

  async function togglePublicCampaign(campaignId: string, showPublicProgress: boolean) {
    if (await call("/api/giving/public-campaigns", { method: "PATCH", body: JSON.stringify({ campaignId, showPublicProgress }) })) {
      await loadPublicCampaigns();
    }
  }

  async function setFundPublic(fundId: string, isPublic: boolean) {
    if (await call(`/api/funds/${fundId}`, { method: "PATCH", body: JSON.stringify({ isPublic }) })) router.refresh();
  }

  async function addProgram() {
    const ok = await call("/api/contribution-programs", {
      method: "POST",
      body: JSON.stringify({ name: programName.trim(), fundId: programFundId, type: programType }),
    });
    if (ok) {
      setProgramName("");
      router.refresh();
    }
  }

  const inputClass =
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
  const activeFunds = funds.filter((fund) => fund.status === "ACTIVE" || fund.status === "DRAFT" || fund.status === "INACTIVE");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        {viewer.canManageFunds ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => saveSettings({ contributionsEnabled: !settings.contributionsEnabled })}
              className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
                settings.contributionsEnabled
                  ? "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                  : "bg-emerald-700 text-white hover:bg-emerald-800"
              }`}
            >
              {settings.contributionsEnabled ? "Disable module" : "Enable Contributions & Giving"}
            </button>
            {settings.contributionsEnabled ? (
              <label className="space-y-1 text-sm font-medium text-slate-900">
                <span>What your organization calls it</span>
                <div className="flex gap-2">
                  <input value={terminology} onChange={(event) => setTerminology(event.target.value)} list="giving-terminology" className={inputClass + " w-48"} />
                  <datalist id="giving-terminology">
                    <option value="Giving" />
                    <option value="Contributions" />
                    <option value="Support" />
                  </datalist>
                  <button
                    type="button"
                    disabled={pending || terminology.trim() === settings.terminology}
                    onClick={() => saveSettings({ contributionTerminology: terminology.trim() || null })}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </label>
            ) : null}
          </>
        ) : null}
        {!settings.contributionsEnabled ? (
          <p className="text-sm text-slate-600">
            The module is off. Nothing giving-related is visible to members or staff until it is enabled here.
          </p>
        ) : null}
      </div>

      {settings.contributionsEnabled && viewer.canManageFunds ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Household giving privacy</h3>
          <p className="mt-1 text-xs text-slate-600">
            Sharing an address is not consent to share money. Each option below states exactly who can see what —
            the default keeps every member&apos;s giving private, and finance staff visibility is unaffected either way.
          </p>
          <div className="mt-3 space-y-2">
            {[
              {
                value: "INDIVIDUAL_PRIVATE",
                label: "Individual private (default)",
                detail:
                  "Household membership changes nothing about giving. No member ever sees another household member's giving.",
              },
              {
                value: "HOUSEHOLD_STATEMENT_ONLY",
                label: "Household totals",
                detail:
                  "Household members see each member's ANNUAL TOTAL and a combined household total. Individual transactions stay private.",
              },
              {
                value: "HOUSEHOLD_SHARED",
                label: "Fully shared",
                detail:
                  "Household members see each other's individual contributions — every gift, its date, amount, and designation. Choose this only if your members expect it.",
              },
            ].map((option) => (
              <label key={option.value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="household-privacy-mode"
                  checked={
                    option.value === "INDIVIDUAL_PRIVATE"
                      ? !settings.householdGivingEnabled || settings.householdGivingPrivacyMode === "INDIVIDUAL_PRIVATE"
                      : settings.householdGivingEnabled && settings.householdGivingPrivacyMode === option.value
                  }
                  disabled={pending}
                  onChange={() =>
                    saveSettings({
                      householdGivingEnabled: option.value !== "INDIVIDUAL_PRIVATE",
                      householdGivingPrivacyMode: option.value,
                    })
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-slate-900">{option.label}</span>
                  <span className="block text-xs text-slate-600">{option.detail}</span>
                </span>
              </label>
            ))}
            {!settings.householdGivingEnabled ? (
              <p className="text-xs text-slate-500">
                Household giving is currently off — households (managed under Giving Operations) affect nothing until a
                shared option is chosen here.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {settings.contributionsEnabled && viewer.canManageFunds ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Public giving page</h3>
          <p className="mt-1 text-xs text-slate-600">
            An optional public page where anyone can give — no account required. It shows only funds marked
            &ldquo;Public&rdquo; and campaigns you explicitly publish. Off by default; the link 404s until enabled.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => saveSettings({ publicGivingEnabled: !settings.publicGivingEnabled })}
              className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
                settings.publicGivingEnabled
                  ? "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                  : "bg-emerald-700 text-white hover:bg-emerald-800"
              }`}
            >
              {settings.publicGivingEnabled ? "Unpublish page" : "Publish public giving page"}
            </button>
            {settings.publicGivingEnabled && slug ? (
              <code className="rounded-lg bg-white px-3 py-2 text-xs text-slate-800 ring-1 ring-slate-200">
                {typeof window !== "undefined" ? window.location.origin : ""}/give/{slug}
              </code>
            ) : null}
          </div>
          {settings.publicGivingEnabled ? (
            <div className="mt-3 space-y-3">
              <label className="block space-y-1 text-sm font-medium text-slate-900">
                <span>Welcome message (shown to the public)</span>
                <div className="flex gap-2">
                  <input
                    value={publicMessage}
                    onChange={(event) => setPublicMessage(event.target.value)}
                    maxLength={600}
                    className={inputClass}
                    placeholder="Your generosity powers everything we do."
                  />
                  <button
                    type="button"
                    disabled={pending || publicMessage.trim() === (settings.publicGivingMessage ?? "")}
                    onClick={() => saveSettings({ publicGivingMessage: publicMessage.trim() || null })}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </label>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Public campaign progress</h4>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={loadPublicCampaigns}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {publicCampaigns === null ? "Load campaigns" : "Refresh"}
                  </button>
                </div>
                {publicCampaigns !== null ? (
                  publicCampaigns.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-500">No active campaigns.</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {publicCampaigns.map((campaign) => (
                        <li key={campaign.id} className="flex items-center justify-between text-sm">
                          <span className="text-slate-800">
                            {campaign.name}
                            {campaign.goal ? ` · goal $${campaign.goal.toLocaleString()}` : ""}
                          </span>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => togglePublicCampaign(campaign.id, !campaign.showPublicProgress)}
                            className={`rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                              campaign.showPublicProgress
                                ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            {campaign.showPublicProgress ? "Shown publicly" : "Show publicly"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    Only the goal and total raised ever appear publicly — never individual gifts.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {settings.contributionsEnabled ? (
        <>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Funds</h3>
            <p className="text-xs text-slate-500">Where money is designated. Funds with history can be closed or archived — never deleted.</p>
            {funds.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">No funds yet — most organizations start with a General Fund.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {funds.map((fund) => (
                  <li key={fund.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {fund.name}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[fund.status] ?? ""}`}>
                          {fund.status.toLowerCase()}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {fund.programCount} program(s) · {fund.contributionCount} contribution(s)
                        {fund.suggestedAmounts.length ? ` · suggested: ${fund.suggestedAmounts.map((amount) => `$${amount}`).join(", ")}` : ""}
                      </p>
                    </div>
                    {viewer.canManageFunds ? (
                      <div className="flex gap-2">
                        {fund.status === "ACTIVE" ? (
                          <>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => setFundPublic(fund.id, !fund.isPublic)}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                              fund.isPublic
                                ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                            title="Public funds appear on the public giving page"
                          >
                            {fund.isPublic ? "Public" : "Make public"}
                          </button>
                          <button type="button" disabled={pending} onClick={() => setFundStatus(fund.id, "CLOSED")} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                            Close
                          </button>
                          </>
                        ) : fund.status === "CLOSED" ? (
                          <>
                            <button type="button" disabled={pending} onClick={() => setFundStatus(fund.id, "ACTIVE")} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                              Reopen
                            </button>
                            <button type="button" disabled={pending} onClick={() => setFundStatus(fund.id, "ARCHIVED")} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                              Archive
                            </button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {viewer.canManageFunds ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="space-y-1 text-sm font-medium text-slate-900">
                  <span>Fund name</span>
                  <input value={fundName} onChange={(event) => setFundName(event.target.value)} placeholder="General Fund" className={inputClass + " w-52"} />
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-900">
                  <span>Description</span>
                  <input value={fundDescription} onChange={(event) => setFundDescription(event.target.value)} className={inputClass + " w-64"} />
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-900">
                  <span>Suggested amounts ($, comma-separated)</span>
                  <input value={fundSuggested} onChange={(event) => setFundSuggested(event.target.value)} placeholder="25, 50, 100" className={inputClass + " w-48"} />
                </label>
                <button
                  type="button"
                  disabled={pending || !fundName.trim()}
                  onClick={addFund}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  Add fund
                </button>
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Programs</h3>
            <p className="text-xs text-slate-500">
              The giving experiences you offer. Only a dues program can be a required obligation — every other type is voluntary and can never
              create a balance owed.
            </p>
            {programs.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">No programs yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {programs.map((program) => (
                  <li key={program.id} className="py-2">
                    <p className="text-sm font-medium text-slate-900">
                      {program.name}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[program.status] ?? ""}`}>
                        {program.status.toLowerCase()}
                      </span>
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          program.obligationNature === "REQUIRED" ? "bg-red-100 text-red-800" : "bg-sky-100 text-sky-800"
                        }`}
                      >
                        {program.obligationNature === "REQUIRED" ? "Required obligation" : "Voluntary"}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {PROGRAM_TYPE_LABELS[program.type] ?? program.type} · fund: {program.fundName}
                      {program.allowedFrequencies.length ? ` · ${program.allowedFrequencies.join("/").toLowerCase()}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {viewer.canManagePrograms && activeFunds.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="space-y-1 text-sm font-medium text-slate-900">
                  <span>Program name</span>
                  <input value={programName} onChange={(event) => setProgramName(event.target.value)} placeholder="Sunday Giving" className={inputClass + " w-52"} />
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-900">
                  <span>Fund</span>
                  <select value={programFundId} onChange={(event) => setProgramFundId(event.target.value)} className={inputClass + " w-48"}>
                    <option value="">Choose…</option>
                    {activeFunds.map((fund) => (
                      <option key={fund.id} value={fund.id}>
                        {fund.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-900">
                  <span>Type</span>
                  <select value={programType} onChange={(event) => setProgramType(event.target.value)} className={inputClass + " w-56"}>
                    {Object.entries(PROGRAM_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={pending || !programName.trim() || !programFundId}
                  onClick={addProgram}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  Add program
                </button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
