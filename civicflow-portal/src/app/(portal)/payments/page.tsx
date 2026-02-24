import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approvePayment, getPayments, rejectPayment, sendReceiptEmail } from "@/lib/apiClient";
import { requirePortalSession } from "@/lib/session";

function toCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const params = await searchParams;
  const session = await requirePortalSession();
  const payments = await getPayments(session);

  async function syncAction() {
    "use server";
    revalidatePath("/payments");
    redirect("/payments?msg=Cloud%20data%20synced");
  }

  async function approveAction(formData: FormData) {
    "use server";
    const id = String(formData.get("id") || "").trim();
    const memberName = String(formData.get("member_name") || "").trim();
    const invoiceId = String(formData.get("invoice_id") || "").trim();
    const method = String(formData.get("method") || "").trim();
    const amount = Number(formData.get("amount") || 0);
    const memberEmail = String(formData.get("member_email") || "").trim();
    if (!id) {
      redirect("/payments?err=Missing%20payment%20id");
    }

    try {
      await approvePayment(session, id);
      await sendReceiptEmail(session, {
        cloud_id: id,
        member_name: memberName,
        invoice_id: invoiceId,
        method,
        amount,
        member_email: memberEmail,
      }).catch(() => null);
      revalidatePath("/payments");
      revalidatePath("/dashboard");
      revalidatePath("/analytics");
      redirect("/payments?msg=Payment%20approved");
    } catch (error) {
      const message = encodeURIComponent((error as Error)?.message || "Failed to approve payment");
      redirect(`/payments?err=${message}`);
    }
  }

  async function rejectAction(formData: FormData) {
    "use server";
    const id = String(formData.get("id") || "").trim();
    if (!id) {
      redirect("/payments?err=Missing%20payment%20id");
    }

    try {
      await rejectPayment(session, id);
      revalidatePath("/payments");
      revalidatePath("/dashboard");
      revalidatePath("/analytics");
      redirect("/payments?msg=Payment%20rejected");
    } catch (error) {
      const message = encodeURIComponent((error as Error)?.message || "Failed to reject payment");
      redirect(`/payments?err=${message}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Payments</h2>
          <p className="mt-1 text-sm text-slate-600">Payment confirmations from cloud API</p>
        </div>
        <form action={syncAction}>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Sync Cloud Data
          </button>
        </form>
      </div>

      {params.msg ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{params.msg}</div>
      ) : null}
      {params.err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{params.err}</div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3">Member Name</th>
              <th className="px-4 py-3">Invoice ID</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-500">No pending payments found.</td>
              </tr>
            ) : payments.map((row) => {
              const rowId = String(row.cloud_id || row.id || "");
              return (
                <tr key={rowId || `${row.invoice_id}-${row.created_at}`} className="border-t border-slate-100">
                  <td className="px-4 py-3">{row.member_name || "—"}</td>
                  <td className="px-4 py-3">{row.invoice_id || "—"}</td>
                  <td className="px-4 py-3">{toCurrency(Number(row.amount || 0))}</td>
                  <td className="px-4 py-3">{String(row.method || "—").toUpperCase()}</td>
                  <td className="px-4 py-3">{row.paid_date || row.created_at || "—"}</td>
                  <td className="px-4 py-3">{String(row.status || "NEW").toUpperCase()}</td>
                  <td className="px-4 py-3">{String(row.source || "CLOUD").toUpperCase()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <form action={approveAction}>
                        <input type="hidden" name="id" value={rowId} />
                        <input type="hidden" name="member_name" value={row.member_name || ""} />
                        <input type="hidden" name="invoice_id" value={row.invoice_id || ""} />
                        <input type="hidden" name="method" value={row.method || ""} />
                        <input type="hidden" name="amount" value={String(row.amount || 0)} />
                        <input type="hidden" name="member_email" value={row.member_email || ""} />
                        <button
                          type="submit"
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          Approve
                        </button>
                      </form>

                      <form action={rejectAction}>
                        <input type="hidden" name="id" value={rowId} />
                        <button
                          type="submit"
                          className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                        >
                          Reject
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
