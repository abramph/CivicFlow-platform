"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface GroupView {
  id: string;
  name: string;
  description: string | null;
  kindLabel: string;
  status: string;
  members: { id: string; name: string; isLeader: boolean }[];
  /** The signed-in user leads this group (server-computed). */
  callerLeads: boolean;
}

/** CORE-GIVE-I (§40/§41) — group roster UI. The server enforces every rule;
 * leaders see membership controls only on the groups they lead. */
export function GroupsManager({
  groupsLabel,
  groups,
  members,
  viewer,
}: {
  groupsLabel: string;
  groups: GroupView[];
  members: { id: string; name: string }[];
  viewer: { canManage: boolean; canManageMembers: boolean };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kindLabel, setKindLabel] = useState("Group");
  const [memberPick, setMemberPick] = useState<Record<string, string>>({});

  async function call(path: string, body: Record<string, unknown>, method = "POST"): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
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

  async function addGroup() {
    if (await call("/api/groups", { name: name.trim(), kindLabel: kindLabel.trim() || "Group" })) {
      setName("");
      router.refresh();
    }
  }

  async function membership(groupId: string, memberId: string, action: string) {
    if (!memberId) return;
    if (await call(`/api/groups/${groupId}/members`, { memberId, action })) router.refresh();
  }

  const active = groups.filter((group) => group.status === "ACTIVE");
  const archived = groups.filter((group) => group.status === "ARCHIVED");

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p> : null}

      {viewer.canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={`New ${groupsLabel.toLowerCase().replace(/s$/, "")} name`}
            className="w-56 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          />
          <input
            value={kindLabel}
            onChange={(event) => setKindLabel(event.target.value)}
            list="group-kind-labels"
            className="w-36 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
            aria-label="Group kind label"
          />
          <datalist id="group-kind-labels">
            <option value="Group" />
            <option value="Ministry" />
            <option value="Committee" />
            <option value="Chapter" />
            <option value="Working Group" />
          </datalist>
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={addGroup}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      ) : null}

      {active.length === 0 ? <p className="text-sm text-slate-600">No {groupsLabel.toLowerCase()} yet.</p> : null}
      <ul className="space-y-3">
        {active.map((group) => {
          const canEditRoster = viewer.canManageMembers || group.callerLeads;
          return (
            <li key={group.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">
                  {group.name}
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{group.kindLabel}</span>
                  {group.callerLeads ? (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                      You lead this group
                    </span>
                  ) : null}
                </p>
                {viewer.canManage ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => call(`/api/groups/${group.id}`, { status: "ARCHIVED" }, "PATCH").then((ok) => ok && router.refresh())}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                  >
                    Archive
                  </button>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {group.members.length === 0 ? (
                  <span className="text-xs text-slate-500">No members yet.</span>
                ) : (
                  group.members.map((member) => (
                    <span
                      key={member.id}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                        member.isLeader ? "bg-emerald-50 font-semibold text-emerald-900" : "bg-slate-100 text-slate-800"
                      }`}
                    >
                      {member.name}
                      {member.isLeader ? " · Leader" : ""}
                      {viewer.canManageMembers ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => membership(group.id, member.id, member.isLeader ? "remove-leader" : "make-leader")}
                          className="text-slate-500 hover:text-emerald-700"
                          aria-label={`${member.isLeader ? "Remove leadership from" : "Make leader:"} ${member.name}`}
                          title={member.isLeader ? "Remove leadership" : "Make leader"}
                        >
                          ★
                        </button>
                      ) : null}
                      {canEditRoster ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => membership(group.id, member.id, "remove")}
                          className="font-semibold text-slate-500 hover:text-red-700"
                          aria-label={`Remove ${member.name} from ${group.name}`}
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))
                )}
              </div>
              {canEditRoster ? (
                <div className="mt-2 flex items-center gap-2">
                  <select
                    value={memberPick[group.id] ?? ""}
                    onChange={(event) => setMemberPick((prev) => ({ ...prev, [group.id]: event.target.value }))}
                    className="w-56 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    aria-label={`Add member to ${group.name}`}
                  >
                    <option value="">Add a member…</option>
                    {members
                      .filter((member) => !group.members.some((existing) => existing.id === member.id))
                      .map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={pending || !(memberPick[group.id] ?? "")}
                    onClick={() => membership(group.id, memberPick[group.id] ?? "", "add")}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {archived.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Archived</h3>
          <ul className="mt-1 space-y-1">
            {archived.map((group) => (
              <li key={group.id} className="flex items-center justify-between text-sm text-slate-500">
                <span>
                  {group.name} · {group.members.length} member{group.members.length === 1 ? "" : "s"}
                </span>
                {viewer.canManage ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => call(`/api/groups/${group.id}`, { status: "ACTIVE" }, "PATCH").then((ok) => ok && router.refresh())}
                    className="text-xs font-semibold text-emerald-700 hover:underline"
                  >
                    Restore
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
