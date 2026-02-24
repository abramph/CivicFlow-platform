import { useEffect, useMemo, useState } from 'react';

const api = window.civicflow;

export function ExternalPaymentReport({ onNavigate, initialMemberId }) {
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [memberId, setMemberId] = useState(initialMemberId ? String(initialMemberId) : '');
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [suggestedAmount, setSuggestedAmount] = useState('');
  const [method, setMethod] = useState('CASHAPP');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [proofBase64, setProofBase64] = useState('');
  const [proofFilename, setProofFilename] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingMembers(true);
    api?.members?.list?.({ status: 'active' })
      .then((rows) => {
        if (cancelled) return;
        setMembers(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMembers(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (initialMemberId) setMemberId(String(initialMemberId));
  }, [initialMemberId]);

  useEffect(() => {
    let cancelled = false;
    const id = Number(memberId || 0);
    if (!id) {
      setSuggestedAmount('');
      return () => { cancelled = true; };
    }

    api?.getMemberDuesStatus?.(id)
      .then((status) => {
        if (cancelled) return;
        const balanceCents = Number(status?.balanceCents ?? 0);
        const suggested = balanceCents < 0 ? (Math.abs(balanceCents) / 100).toFixed(2) : '';
        setSuggestedAmount(suggested);
        if (!amountTouched) {
          setAmount(suggested);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestedAmount('');
        }
      });

    return () => { cancelled = true; };
  }, [memberId, amountTouched]);

  const selectedMemberName = useMemo(() => {
    const selected = members.find((m) => String(m.id) === String(memberId));
    if (!selected) return '';
    return `${selected.first_name || ''} ${selected.last_name || ''}`.trim();
  }, [members, memberId]);

  const handleProofUpload = (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Proof image must be PNG/JPG/WebP.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProofBase64(String(reader.result || ''));
      setProofFilename(file.name || 'proof-image');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    const numericMemberId = Number(memberId || 0);
    const numericAmount = Number(amount || 0);
    if (!numericMemberId) {
      setMessage({ type: 'error', text: 'Please select a member.' });
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setMessage({ type: 'error', text: 'Amount must be greater than 0.' });
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const result = await api?.payments?.createExternalPayment?.({
        memberId: numericMemberId,
        orgId: 1,
        amount: numericAmount,
        type: 'DUES',
        transaction_type: 'DUES',
        method,
        date,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        proofBase64: proofBase64 || null,
        proofFilename: proofFilename || null,
      });

      if (result?.error) throw new Error(result.error);

      setMessage({ type: 'success', text: 'Payment report submitted. It is now pending admin confirmation.' });
      setAmount('');
      setAmountTouched(false);
      setReference('');
      setNotes('');
      setProofBase64('');
      setProofFilename('');
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Unable to submit payment report.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Report External Payment</h1>
        <p className="text-slate-500 mt-1">Submit Cash App, Zelle, or Venmo dues for admin verification.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Member</label>
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            disabled={loadingMembers || submitting}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">Select member</option>
            {members.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {`${m.first_name || ''} ${m.last_name || ''}`.trim()}{m.email ? ` (${m.email})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => {
                setAmountTouched(true);
                setAmount(e.target.value);
              }}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              {suggestedAmount
                ? `Suggested due amount: $${suggestedAmount} (editable).`
                : 'Enter the amount you paid (editable).'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            >
              <option value="CASHAPP">Cash App</option>
              <option value="ZELLE">Zelle</option>
              <option value="VENMO">Venmo</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Reference (optional)</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            placeholder={selectedMemberName ? `Payment from ${selectedMemberName}` : ''}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Proof Image (optional)</label>
          <input
            type="file"
            accept="image/*"
            onChange={handleProofUpload}
            disabled={submitting}
            className="w-full text-sm text-slate-600"
          />
          {proofFilename && <p className="text-xs text-slate-500 mt-1">Attached: {proofFilename}</p>}
        </div>

        {message && (
          <div className={`rounded-lg px-4 py-3 text-sm ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {message.text}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || loadingMembers}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit for Admin Review'}
          </button>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('pending-payments')}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              View Pending Payments
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
