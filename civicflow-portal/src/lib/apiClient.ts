export type PortalSession = {
  org_id: string;
  api_key: string;
  api_base: string;
};

export type PaymentRow = {
  id?: number | string;
  cloud_id?: string;
  invoice_id?: string;
  member_name?: string;
  amount?: number;
  method?: string;
  paid_date?: string;
  created_at?: string;
  status?: string;
  source?: string;
  member_email?: string;
};

async function request<T>(session: PortalSession, path: string, init: RequestInit = {}): Promise<T> {
  const url = `${String(session.api_base || "").replace(/\/+$/, "")}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": session.api_key,
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return payload as T;
}

export async function getPayments(session: PortalSession): Promise<PaymentRow[]> {
  const payload = await request<PaymentRow[] | { submissions?: PaymentRow[] }>(session, "/payment-submissions?status=NEW");
  const rows = Array.isArray(payload) ? payload : (Array.isArray(payload?.submissions) ? payload.submissions : []);
  return rows.map((row) => ({
    ...row,
    status: String(row?.status || "NEW").toUpperCase(),
    source: String(row?.source || "CLOUD").toUpperCase(),
  }));
}

export async function getAnalytics(session: PortalSession): Promise<{
  total_payments: number;
  total_amount: number;
  payments_by_method: Array<{ method: string; count: number; total: number }>;
  monthly_totals: Array<{ month: string; count: number; total: number }>;
}> {
  const payload = await request<{
    total_payments?: number;
    total_amount?: number;
    payments_by_method?: Array<{ method?: string; count?: number; total?: number }>;
    monthly_totals?: Array<{ month?: string; count?: number; total?: number }>;
  }>(session, "/analytics/summary");

  return {
    total_payments: Number(payload?.total_payments || 0),
    total_amount: Number(payload?.total_amount || 0),
    payments_by_method: Array.isArray(payload?.payments_by_method)
      ? payload.payments_by_method.map((row) => ({
        method: String(row?.method || "UNKNOWN").toUpperCase(),
        count: Number(row?.count || 0),
        total: Number(row?.total || 0),
      }))
      : [],
    monthly_totals: Array.isArray(payload?.monthly_totals)
      ? payload.monthly_totals.map((row) => ({
        month: String(row?.month || "N/A"),
        count: Number(row?.count || 0),
        total: Number(row?.total || 0),
      }))
      : [],
  };
}

export async function approvePayment(session: PortalSession, id: string) {
  try {
    return await request<{ success?: boolean }>(session, "/payment-submissions/approve", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  } catch (error) {
    const message = String((error as Error)?.message || "");
    if (!message.includes("404")) {
      throw error;
    }

    return request<{ success?: boolean; updated?: number }>(session, "/payment-submissions/mark-synced", {
      method: "POST",
      body: JSON.stringify({ ids: [id] }),
    });
  }
}

export async function rejectPayment(session: PortalSession, id: string) {
  return request<{ success?: boolean }>(session, "/payment-submissions/reject", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export async function sendReceiptEmail(session: PortalSession, payment: PaymentRow) {
  return request<{ success?: boolean; error?: string }>(session, "/payment-submissions/send-receipt", {
    method: "POST",
    body: JSON.stringify({
      member_name: payment.member_name,
      email: payment.member_email,
      amount: Number(payment.amount || 0),
      method: payment.method,
      invoice_id: payment.invoice_id || payment.cloud_id,
    }),
  });
}
