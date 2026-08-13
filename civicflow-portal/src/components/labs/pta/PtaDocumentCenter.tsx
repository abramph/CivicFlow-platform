"use client";

import { useState } from "react";
import { AttachmentManager } from "@/components/forms/AttachmentManager";

export const DOCUMENT_CATEGORIES = [
  { slug: "governance", label: "Governance" },
  { slug: "board", label: "Board" },
  { slug: "meetings", label: "Meetings" },
  { slug: "finance", label: "Finance" },
  { slug: "committees", label: "Committees" },
  { slug: "events", label: "Events" },
  { slug: "volunteers", label: "Volunteers" },
  { slug: "transition", label: "Transition" },
  { slug: "historical", label: "Historical" },
] as const;

/**
 * PTA Vertical 2.0, PR PTA-D — the Document Center: organization-owned files
 * organized by folder. Rides the existing attachment pipeline (private
 * storage, signed downloads, soft delete, audit) via the
 * ORGANIZATION_DOCUMENT entity type; the folder is the attachment `purpose`.
 * Documents belong to the organization, not to whoever uploaded them.
 */
export function PtaDocumentCenter({ organizationId, canWrite }: { organizationId: string; canWrite: boolean }) {
  const [category, setCategory] = useState<string>(DOCUMENT_CATEGORIES[0].slug);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Document folders">
        {DOCUMENT_CATEGORIES.map((item) => (
          <button
            key={item.slug}
            type="button"
            role="tab"
            aria-selected={category === item.slug}
            onClick={() => setCategory(item.slug)}
            className={
              category === item.slug
                ? "rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white"
                : "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
            }
          >
            {item.label}
          </button>
        ))}
      </div>
      <AttachmentManager
        key={category}
        entityType="ORGANIZATION_DOCUMENT"
        entityId={organizationId}
        purpose={category}
        filterByPurpose
        canWrite={canWrite}
        titleLabel="Document title"
      />
    </div>
  );
}
