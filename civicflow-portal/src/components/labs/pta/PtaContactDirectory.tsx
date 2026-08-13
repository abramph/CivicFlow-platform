"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORY_SUGGESTIONS = [
  "School administration",
  "District",
  "State PTA",
  "Council",
  "Accountant",
  "Insurance",
  "Bank",
  "Venue",
  "Photographer",
  "Fundraising vendor",
  "Food vendor",
  "Printing",
];

interface ContactView {
  id: string;
  name: string;
  contactPerson: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  category: string | null;
  notes: string | null;
  isVendor: boolean;
  rating: number | null;
  isActive: boolean;
  lastReviewedAt: string | null;
}

interface VendorHistoryView {
  totalSpend: number;
  expenditureCount: number;
  events: string[];
  recent: { id: string; date: string; amount: number; description: string; eventTitle: string | null }[];
}

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** PTA-I — §23 directory + §24 vendor history. Vendor spend loads on demand
 * from the ledger (name-matched); ratings are internal officer assessments. */
export function PtaContactDirectory({ contacts, canWrite }: { contacts: ContactView[]; canWrite: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<VendorHistoryView | null>(null);

  const [name, setName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("");
  const [isVendor, setIsVendor] = useState(false);
  const [notes, setNotes] = useState("");

  async function call(path: string, init?: RequestInit): Promise<{ ok: boolean; data?: unknown }> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save.");
        return { ok: false };
      }
      return { ok: true, data: data.data };
    } catch {
      setError("Unable to connect. Please try again.");
      return { ok: false };
    } finally {
      setPending(false);
    }
  }

  async function openContact(contactId: string) {
    if (openId === contactId) {
      setOpenId(null);
      setHistory(null);
      return;
    }
    const result = await call(`/api/contacts/${contactId}`);
    if (result.ok) {
      const data = result.data as { totalSpend: number; expenditureCount: number; events: string[]; recent: VendorHistoryView["recent"] };
      setOpenId(contactId);
      setHistory({ totalSpend: data.totalSpend, expenditureCount: data.expenditureCount, events: data.events, recent: data.recent });
    }
  }

  async function addContact() {
    const result = await call("/api/contacts", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        contactPerson: contactPerson.trim() || null,
        role: role.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        category: category.trim() || null,
        notes: notes.trim() || null,
        isVendor,
      }),
    });
    if (result.ok) {
      setShowAdd(false);
      setName("");
      setContactPerson("");
      setRole("");
      setPhone("");
      setEmail("");
      setCategory("");
      setIsVendor(false);
      setNotes("");
      router.refresh();
    }
  }

  async function patchContact(contactId: string, body: Record<string, unknown>) {
    const result = await call(`/api/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify(body) });
    if (result.ok) router.refresh();
  }

  const inputClass =
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

  const active = contacts.filter((contact) => contact.isActive);
  const inactive = contacts.filter((contact) => !contact.isActive);

  return (
    <div className="space-y-5">
      {canWrite ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => setShowAdd((value) => !value)}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {showAdd ? "Cancel" : "Add contact or vendor"}
        </button>
      ) : null}

      {showAdd ? (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Organization / company</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Contact person</span>
            <input value={contactPerson} onChange={(event) => setContactPerson(event.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Role</span>
            <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Principal, Sales rep, Agent…" className={inputClass} />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Category</span>
            <input value={category} onChange={(event) => setCategory(event.target.value)} list="pta-contact-categories" className={inputClass} />
            <datalist id="pta-contact-categories">
              {CATEGORY_SUGGESTIONS.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Phone</span>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" checked={isVendor} onChange={(event) => setIsVendor(event.target.checked)} className="h-4 w-4" />
            <span>This is a vendor (tracks spend and event history)</span>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900 sm:col-span-2">
            <span>Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className={inputClass} />
          </label>
          <div>
            <button
              type="button"
              disabled={pending || !name.trim()}
              onClick={addContact}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Save contact
            </button>
          </div>
        </div>
      ) : null}

      {active.length === 0 ? (
        <p className="text-sm text-slate-600">No contacts yet — this directory carries over from board to board once you build it.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {active.map((contact) => (
            <li key={contact.id} className="py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={() => openContact(contact.id)} className="text-left">
                  <p className="text-sm font-medium text-slate-900">
                    {contact.name}
                    {contact.isVendor ? (
                      <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">Vendor</span>
                    ) : null}
                    {contact.rating ? <span className="ml-2 text-xs text-amber-600">{"★".repeat(contact.rating)}</span> : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    {[contact.category, contact.contactPerson, contact.role, contact.phone, contact.email].filter(Boolean).join(" · ") || "No details yet"}
                  </p>
                </button>
                {canWrite ? (
                  <div className="flex items-center gap-2">
                    {contact.isVendor ? (
                      <select
                        value={contact.rating ?? ""}
                        onChange={(event) => patchContact(contact.id, { rating: event.target.value ? Number(event.target.value) : null })}
                        disabled={pending}
                        aria-label="Internal rating"
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        <option value="">No rating</option>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <option key={value} value={value}>
                            {value}/5
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => patchContact(contact.id, { markReviewed: true })}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      title={contact.lastReviewedAt ? `Last reviewed ${new Date(contact.lastReviewedAt).toLocaleDateString()}` : "Never reviewed"}
                    >
                      Mark reviewed
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => patchContact(contact.id, { isActive: false })}
                      className="text-xs font-semibold text-slate-400 hover:text-red-700 disabled:opacity-50"
                    >
                      Deactivate
                    </button>
                  </div>
                ) : null}
              </div>
              {openId === contact.id && history ? (
                <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm">
                  {contact.notes ? <p className="mb-2 whitespace-pre-wrap text-slate-700">{contact.notes}</p> : null}
                  {contact.isVendor ? (
                    <>
                      <p className="font-semibold text-slate-900">
                        {money(history.totalSpend)} across {history.expenditureCount} expenditure(s)
                        {history.events.length ? ` · events: ${history.events.join(", ")}` : ""}
                      </p>
                      {history.recent.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                          {history.recent.map((row) => (
                            <li key={row.id}>
                              {new Date(row.date).toLocaleDateString()} — {money(row.amount)} — {row.description}
                              {row.eventTitle ? ` (${row.eventTitle})` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500">No matched expenditures yet — spend appears when expenditures name this vendor.</p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">
                      {history.expenditureCount > 0
                        ? `${money(history.totalSpend)} in matched expenditures.`
                        : "Not a vendor — no spend tracking."}
                    </p>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {inactive.length > 0 && canWrite ? (
        <details className="text-sm text-slate-500">
          <summary className="cursor-pointer font-semibold">Inactive ({inactive.length})</summary>
          <ul className="mt-1 space-y-1">
            {inactive.map((contact) => (
              <li key={contact.id} className="flex items-center gap-2">
                {contact.name}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => patchContact(contact.id, { isActive: true })}
                  className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50"
                >
                  Reactivate
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
