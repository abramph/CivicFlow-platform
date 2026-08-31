"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface AgreementVersionLike {
  id: string;
  title: string;
  versionNumber: number;
  content: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt: string | null;
  archivedAt: string | null;
}

export interface AgreementStatusCountsLike {
  notYetAccepted: number;
  accepted: number;
  offerWindowOpen: number;
  offerWindowExpired: number;
  volunteerElection: number;
  partialBuyoutElection: number;
  fullBuyoutElection: number;
}

export interface AgreementPolicyLike {
  agreementRequired: boolean;
  agreementVersionId: string | null;
  contractLinkedBuyoutEnabled: boolean;
  contractLinkedEligibilityDays: number | null;
  contractLinkedUsesAcceptanceRate: boolean;
}

/**
 * feature/pta-family-agreement-buyout, FA-5. Admin configuration for the
 * PTA Volunteer Commitment Agreement: draft/publish/archive versions,
 * assign one to this period, and configure contract-linked buyout policy.
 * Deliberately does NOT expose any way to accept on a family's behalf, edit
 * a published version's text, or backdate an acceptance — those are
 * structural gaps (the API has no such endpoint at all), not merely
 * omitted UI.
 */
export function PtaVolunteerAgreementManager({
  periodId,
  versions,
  policy,
  statusCounts,
  timezone,
}: {
  periodId: string;
  versions: AgreementVersionLike[];
  policy: AgreementPolicyLike;
  statusCounts: AgreementStatusCountsLike;
  timezone: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [policyForm, setPolicyForm] = useState(policy);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState("");

  async function submitJson(url: string, method: string, body?: unknown) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Something went wrong.");
        return null;
      }
      router.refresh();
      return data.data;
    } catch {
      setError("Unable to connect. Please try again.");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function createDraft() {
    if (!draftTitle.trim() || !draftContent.trim()) return;
    const created = await submitJson(`/api/labs/pta/volunteer-hours/periods/${periodId}/agreements`, "POST", {
      title: draftTitle,
      content: draftContent,
    });
    if (created) {
      setDraftTitle("");
      setDraftContent("");
    }
  }

  async function saveEdit(versionId: string) {
    await submitJson(`/api/labs/pta/volunteer-hours/periods/${periodId}/agreements/${versionId}`, "PATCH", {
      title: draftTitle,
      content: draftContent,
    });
    setEditingId(null);
  }

  async function publish(versionId: string) {
    await submitJson(`/api/labs/pta/volunteer-hours/periods/${periodId}/agreements/${versionId}/publish`, "POST");
  }

  /** FA2 §5: the currently-required version can't archive without an atomic
   * replacement — clicking Archive on it opens an inline picker instead of
   * submitting immediately; every other version archives right away. */
  function isActivelyRequired(versionId: string) {
    return policy.agreementRequired && policy.agreementVersionId === versionId;
  }

  async function archive(versionId: string, withReplacementId?: string) {
    if (isActivelyRequired(versionId) && !withReplacementId) {
      setArchivingId(versionId);
      setReplacementId("");
      return;
    }
    const result = await submitJson(`/api/labs/pta/volunteer-hours/periods/${periodId}/agreements/${versionId}/archive`, "POST", {
      replacementVersionId: withReplacementId,
    });
    if (result) {
      setArchivingId(null);
      setReplacementId("");
    }
  }

  async function savePolicy() {
    await submitJson(`/api/labs/pta/volunteer-hours/periods/${periodId}/agreement-policy`, "PUT", policyForm);
  }

  const publishedVersions = versions.filter((v) => v.status === "PUBLISHED");

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Agreement policy for this period</h3>
        <p className="mt-1 text-xs text-slate-500">
          Times shown/entered here are the organization&apos;s own time zone ({timezone}), not your browser&apos;s.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={policyForm.agreementRequired}
              onChange={(e) => setPolicyForm({ ...policyForm, agreementRequired: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>Require acceptance before any election</span>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Assigned published version</span>
            <select
              value={policyForm.agreementVersionId ?? ""}
              onChange={(e) => setPolicyForm({ ...policyForm, agreementVersionId: e.target.value || null })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">None</option>
              {publishedVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber} — {v.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={policyForm.contractLinkedBuyoutEnabled}
              onChange={(e) => setPolicyForm({ ...policyForm, contractLinkedBuyoutEnabled: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>Offer contract-linked buyout after acceptance</span>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Eligibility window (days after acceptance)</span>
            <input
              type="number"
              min={1}
              value={policyForm.contractLinkedEligibilityDays ?? ""}
              onChange={(e) => setPolicyForm({ ...policyForm, contractLinkedEligibilityDays: e.target.value ? Number(e.target.value) : null })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900 md:col-span-2">
            <input
              type="checkbox"
              checked={policyForm.contractLinkedUsesAcceptanceRate}
              onChange={(e) => setPolicyForm({ ...policyForm, contractLinkedUsesAcceptanceRate: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>Freeze the rate active at the moment of acceptance (unchecked: use the current rate when the family elects)</span>
          </label>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={savePolicy}
          className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          Save policy
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Household status</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">Not yet accepted</dt>
            <dd className="font-semibold">{statusCounts.notYetAccepted}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Accepted</dt>
            <dd className="font-semibold">{statusCounts.accepted}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Offer window open</dt>
            <dd className="font-semibold">{statusCounts.offerWindowOpen}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Offer window expired</dt>
            <dd className="font-semibold">{statusCounts.offerWindowExpired}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Volunteer election</dt>
            <dd className="font-semibold">{statusCounts.volunteerElection}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Partial-buyout election</dt>
            <dd className="font-semibold">{statusCounts.partialBuyoutElection}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Full-buyout election</dt>
            <dd className="font-semibold">{statusCounts.fullBuyoutElection}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Agreement versions</h3>
        <div className="mt-3 space-y-3">
          {versions.map((v) => (
            <div key={v.id} className="rounded border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-900">
                  v{v.versionNumber} — {v.title}{" "}
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      v.status === "PUBLISHED" ? "bg-emerald-100 text-emerald-800" : v.status === "DRAFT" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {v.status}
                  </span>
                </span>
                <div className="flex gap-2">
                  {v.status === "DRAFT" ? (
                    <>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setEditingId(v.id);
                          setDraftTitle(v.title);
                          setDraftContent(v.content);
                        }}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => publish(v.id)}
                        className="rounded bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-800"
                      >
                        Publish
                      </button>
                    </>
                  ) : v.status === "PUBLISHED" ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => archive(v.id)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold hover:bg-slate-50"
                    >
                      Archive
                    </button>
                  ) : null}
                </div>
              </div>
              {archivingId === v.id ? (
                <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2">
                  <p className="text-xs text-amber-900">
                    This version is currently required by this period. Choose a replacement published version to assign atomically as you
                    archive it.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      value={replacementId}
                      onChange={(e) => setReplacementId(e.target.value)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="">Choose a replacement version…</option>
                      {publishedVersions
                        .filter((pv) => pv.id !== v.id)
                        .map((pv) => (
                          <option key={pv.id} value={pv.id}>
                            v{pv.versionNumber} — {pv.title}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={pending || !replacementId}
                      onClick={() => archive(v.id, replacementId)}
                      className="rounded bg-amber-700 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                    >
                      Archive with replacement
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setArchivingId(null);
                        setReplacementId("");
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {editingId === v.id ? (
                <div className="mt-2 space-y-2">
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <textarea
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    rows={6}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => saveEdit(v.id)}
                      className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                    >
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{v.content.slice(0, 300)}{v.content.length > 300 ? "…" : ""}</p>
              )}
            </div>
          ))}
        </div>

        {editingId === null ? (
          <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
            <p className="text-xs font-medium text-slate-700">New draft version</p>
            <input
              placeholder="Title"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <textarea
              placeholder="Agreement text (plain text)"
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={6}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={pending || !draftTitle.trim() || !draftContent.trim()}
              onClick={createDraft}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Create draft
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
