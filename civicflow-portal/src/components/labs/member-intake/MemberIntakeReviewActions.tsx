"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  submissionId: string;
  status: string;
  canReview: boolean;
  hasMatchedMember: boolean;
  candidateMemberIds: string[];
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Something went wrong. Please try again.");
  return data.data;
}

export function MemberIntakeReviewActions({ submissionId, status, canReview, hasMatchedMember, candidateMemberIds }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [linkMemberId, setLinkMemberId] = useState(candidateMemberIds[0] ?? "");

  if (!canReview) return null;

  const canApprove = status === "REVIEW_REQUIRED" || status === "VERIFICATION_REQUIRED";
  const canReject = status === "SUBMITTED" || status === "VERIFICATION_REQUIRED" || status === "REVIEW_REQUIRED";
  const canLink = status === "REVIEW_REQUIRED" && !hasMatchedMember;
  const canCreateNew = status === "REVIEW_REQUIRED";

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!canApprove && !canReject && !canLink && !canCreateNew) {
    return null;
  }

  return (
    <div className="space-y-4 border-t border-slate-100 pt-4">
      <div className="flex flex-wrap gap-2">
        {canApprove ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => postJson(`/api/member-intake/submissions/${submissionId}/approve`))}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {hasMatchedMember ? "Approve update" : "Approve & create member"}
          </button>
        ) : null}
        {canCreateNew ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => postJson(`/api/member-intake/submissions/${submissionId}/create-new`))}
            className="rounded-lg border border-emerald-700 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            Create as new member anyway
          </button>
        ) : null}
        {canReject ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => setShowReject((v) => !v)}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Reject
          </button>
        ) : null}
      </div>

      {canLink ? (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-semibold text-slate-900">Link to a specific member</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={linkMemberId}
              onChange={(e) => setLinkMemberId(e.target.value)}
              placeholder="Member ID"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            />
            <button
              type="button"
              disabled={pending || !linkMemberId.trim()}
              onClick={() => run(() => postJson(`/api/member-intake/submissions/${submissionId}/link`, { memberId: linkMemberId.trim() }))}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Link & apply
            </button>
          </div>
          {candidateMemberIds.length > 0 ? <p className="text-xs text-slate-500">Candidate IDs from matching: {candidateMemberIds.join(", ")}</p> : null}
        </div>
      ) : null}

      {showReject ? (
        <div className="space-y-2 rounded-lg border border-red-200 p-3">
          <label className="block space-y-1 text-sm font-medium text-slate-900">
            <span>Reason for rejecting</span>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200"
            />
          </label>
          <button
            type="button"
            disabled={pending || !rejectReason.trim()}
            onClick={() => run(() => postJson(`/api/member-intake/submissions/${submissionId}/reject`, { reason: rejectReason.trim() }))}
            className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            Confirm reject
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
