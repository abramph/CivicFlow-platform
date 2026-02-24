import { useEffect, useState } from 'react';

const api = window.civicflow;

const TRANSACTION_TYPE_OPTIONS = [
  { value: 'DUES', label: 'Member Dues' },
  { value: 'DONATION', label: 'Donation' },
  { value: 'CAMPAIGN_CONTRIBUTION', label: 'Campaign Contribution' },
  { value: 'EVENT_REVENUE', label: 'Event Revenue' },
  { value: 'OTHER_INCOME', label: 'Other Income' },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: 'stripe', label: 'STRIPE' },
  { value: 'zelle', label: 'ZELLE' },
  { value: 'cashapp', label: 'CASHAPP' },
  { value: 'venmo', label: 'VENMO' },
  { value: 'cash', label: 'CASH' },
  { value: 'check', label: 'CHECK' },
  { value: 'other', label: 'OTHER' },
  { value: 'import', label: 'IMPORT' },
];

const CONTRIBUTOR_TYPE_OPTIONS = [
  { value: 'MEMBER', label: 'Member' },
  { value: 'NON_MEMBER', label: 'Non-member' },
];

export default function PaymentModal({
  open,
  onClose,
  onSuccess,
  context,
  members = [],
  allowMemberSelection = false,
}) {
  const [type, setType] = useState('DUES');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('stripe');
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [contributorType, setContributorType] = useState('MEMBER');
  const [contributorName, setContributorName] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [events, setEvents] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [orgPaymentDetails, setOrgPaymentDetails] = useState({ cashapp_handle: '', zelle_contact: '', venmo_handle: '', name: '' });
  const [proofBase64, setProofBase64] = useState('');
  const [proofFilename, setProofFilename] = useState('');

  const isEditMode = String(context?.mode || '').trim().toLowerCase() === 'edit';
  const lockContributorType = !allowMemberSelection && context?.memberId != null;
  const lockTransactionType = context?.campaignId != null || context?.eventId != null;
  const memberContextOnly = context?.memberId != null && context?.campaignId == null && context?.eventId == null;

  const normalizeMethodForSelect = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'other';
    if (raw === 'cash app' || raw === 'cash_app') return 'cashapp';
    return raw;
  };

  useEffect(() => {
    if (!open) return;
    const rawType = String(context?.transaction_type || context?.type || '').trim().toUpperCase();
    const hasCampaign = context?.campaignId != null;
    const hasEvent = context?.eventId != null;
    const hasMember = context?.memberId != null;
    let nextType = rawType || (hasMember ? 'DUES' : 'DONATION');
    if (hasCampaign) nextType = 'CAMPAIGN_CONTRIBUTION';
    if (hasEvent) nextType = 'EVENT_REVENUE';
    if (hasMember && !['DUES', 'DONATION'].includes(nextType)) nextType = 'DUES';
    setType(nextType);
    setAmount(context?.amount != null ? String(context.amount) : '');
    setDate(context?.date || new Date().toISOString().slice(0, 10));
    setPaymentMethod('stripe');
    setNotes('');
    setReference('');
    setSelectedMemberId(context?.memberId != null ? String(context.memberId) : '');
    setSelectedCampaignId(context?.campaignId != null ? String(context.campaignId) : '');
    setSelectedEventId(context?.eventId != null ? String(context.eventId) : '');
    const defaultContributorType = context?.memberId != null ? 'MEMBER' : 'NON_MEMBER';
    setContributorType(lockContributorType ? 'MEMBER' : defaultContributorType);
    setContributorName('');
    setSubmitting(false);
    setError(null);
    setProofBase64('');
    setProofFilename('');

    const loadEditTransaction = async () => {
      if (!isEditMode || !context?.transactionId) return;
      try {
        const tx = await api?.transactions?.getById?.(context.transactionId);
        if (!tx) {
          setError('Transaction not found.');
          return;
        }
        setType(String(tx.transaction_type || tx.type || 'DONATION').trim().toUpperCase());
        setAmount(((tx.amount_cents ?? 0) / 100).toFixed(2));
        setPaymentMethod(normalizeMethodForSelect(tx.payment_method));
        setDate(tx.occurred_on || new Date().toISOString().slice(0, 10));
        setNotes(tx.note || '');
        setReference(tx.reference || '');
        setSelectedMemberId(tx.member_id != null ? String(tx.member_id) : '');
        setSelectedCampaignId(tx.campaign_id != null ? String(tx.campaign_id) : '');
        setSelectedEventId(tx.event_id != null ? String(tx.event_id) : '');
        setContributorType(lockContributorType ? 'MEMBER' : (String(tx.contributor_type || '').trim().toUpperCase() || 'MEMBER'));
        setContributorName(tx.contributor_name || '');
      } catch (err) {
        setError(err?.message || 'Unable to load transaction.');
      }
    };

    api?.organization?.get?.()
      .then((org) => {
        setOrgPaymentDetails({
          cashapp_handle: org?.cashapp_handle || '',
          zelle_contact: org?.zelle_contact || '',
          venmo_handle: org?.venmo_handle || '',
          name: org?.name || '',
        });
      })
      .catch(() => {});
    Promise.all([
      api?.campaigns?.listActive?.(),
      api?.events?.listActive?.(),
    ])
      .then(([campaignData, eventData]) => {
        setCampaigns(Array.isArray(campaignData) ? campaignData : []);
        setEvents(Array.isArray(eventData) ? eventData : []);
      })
      .catch(() => {
        setCampaigns([]);
        setEvents([]);
      });

    loadEditTransaction();
  }, [open, context]);

  if (!open) return null;

  const handleClose = () => {
    if (submitting) return;
    onClose?.();
  };

  const validate = () => {
    const amountValue = Number(amount);
    const normalizedType = String(type || '').trim().toUpperCase();
    const normalizedContributorType = lockContributorType
      ? 'MEMBER'
      : String(contributorType || '').trim().toUpperCase();
    const memberId = normalizedContributorType === 'MEMBER'
      ? (selectedMemberId ? Number(selectedMemberId) : (context?.memberId != null ? Number(context.memberId) : null))
      : null;

    if (!normalizedType) return { error: 'Transaction type is required.' };
    if (!Number.isFinite(amountValue) || amountValue <= 0) return { error: 'Amount must be greater than 0.' };
    if (normalizedContributorType === 'MEMBER' && !memberId) return { error: 'Member is required for member contributions.' };
    if (!date) return { error: 'Date is required.' };
    if (memberContextOnly && !['DUES', 'DONATION'].includes(normalizedType)) {
      return { error: 'Member payments must be Dues or Donation.' };
    }

    const rawCampaignId = selectedCampaignId ? Number(selectedCampaignId) : null;
    const rawEventId = selectedEventId ? Number(selectedEventId) : null;
    const campaignId = Number.isFinite(rawCampaignId) ? rawCampaignId : null;
    const eventId = Number.isFinite(rawEventId) ? rawEventId : null;
    if (campaignId && eventId) return { error: 'Select either a campaign or an event, not both.' };
    if (campaignId && normalizedType !== 'CAMPAIGN_CONTRIBUTION') return { error: 'Campaign contributions must use Campaign Contribution type.' };
    if (eventId && normalizedType !== 'EVENT_REVENUE') return { error: 'Event payments must use Event Revenue type.' };
    if (normalizedType === 'CAMPAIGN_CONTRIBUTION' && !campaignId) return { error: 'Select a campaign for campaign contributions.' };
    if (normalizedType === 'EVENT_REVENUE' && !eventId) return { error: 'Select an event for event revenue.' };

    return {
      normalizedType,
      amountValue,
      memberId,
      campaignId,
      eventId,
      contributorType: normalizedContributorType,
      contributorName: (contributorName || '').trim() || null,
    };
  };

  const handleManualSubmit = async () => {
    const validated = validate();
    if (validated.error) {
      setError(validated.error);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api?.transactions?.addManualPayment?.({
        memberId: validated.memberId,
        orgId: context?.orgId ?? 1,
        amount: validated.amountValue,
        type: validated.normalizedType,
        transaction_type: validated.normalizedType,
        date,
        method: paymentMethod,
        notes,
        reference,
        campaignId: validated.campaignId,
        eventId: validated.eventId,
        contributorName: validated.contributorName,
      });
      if (result?.error) throw new Error(result.error);
      onSuccess?.({ ...validated, paymentMethod });
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Unable to save manual payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async () => {
    if (!context?.transactionId) {
      setError('Transaction ID is missing.');
      return;
    }
    const amountValue = Number(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError('Amount must be greater than 0.');
      return;
    }
    if (!date) {
      setError('Date is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api?.transactions?.updateById?.({
        id: context.transactionId,
        amount: amountValue,
        payment_method: paymentMethod,
        notes,
        date,
      });
      if (result?.error) throw new Error(result.error);
      onSuccess?.({ transactionId: context.transactionId, mode: 'edit' });
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Unable to update transaction.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStripeSubmit = async () => {
    const validated = validate();
    if (validated.error) {
      setError(validated.error);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api?.payments?.createCheckout?.({
        memberId: validated.memberId,
        orgId: context?.orgId ?? 1,
        amount: validated.amountValue,
        type: validated.normalizedType,
        transaction_type: validated.normalizedType,
        description: validated.normalizedType,
        campaignId: validated.campaignId,
        eventId: validated.eventId,
        contributorName: validated.contributorName,
        contributorType: validated.contributorType,
      });
      if (result?.error) throw new Error(result.error);
      if (!result?.url) throw new Error('No Stripe checkout URL returned.');
      window.open(result.url, '_blank');
      onSuccess?.({ ...validated, paymentMethod: 'stripe' });
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Unable to open Stripe checkout.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAutoPaySubmit = async () => {
    const validated = validate();
    if (validated.error) {
      setError(validated.error);
      return;
    }
    if (validated.normalizedType !== 'DUES') {
      setError('AutoPay is only available for DUES.');
      return;
    }
    if (validated.contributorType !== 'MEMBER') {
      setError('AutoPay requires a member contributor type.');
      return;
    }
    if (!validated.memberId) {
      setError('Member is required to enroll in AutoPay.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api?.payments?.createSubscription?.({
        memberId: validated.memberId,
        orgId: context?.orgId ?? 1,
        amount: validated.amountValue,
        interval: 'month',
        contributorType: validated.contributorType,
      });
      if (result?.error) throw new Error(result.error);
      if (!result?.url) throw new Error('No Stripe checkout URL returned.');
      window.open(result.url, '_blank');
      onSuccess?.({ ...validated, paymentMethod: 'stripe_subscription' });
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Unable to open Stripe subscription checkout.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExternalSubmit = async (method) => {
    const validated = validate();
    if (validated.error) {
      setError(validated.error);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api?.payments?.createExternalPayment?.({
        memberId: validated.memberId,
        orgId: context?.orgId ?? 1,
        amount: validated.amountValue,
        type: validated.normalizedType,
        transaction_type: validated.normalizedType,
        notes,
        method,
        reference,
        proofBase64: proofBase64 || null,
        proofFilename: proofFilename || null,
        campaignId: validated.campaignId,
        eventId: validated.eventId,
        contributorName: validated.contributorName,
        contributorType: validated.contributorType,
      });
      if (result?.error) throw new Error(result.error);
      onSuccess?.({ ...validated, paymentMethod: method.toLowerCase() });
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Unable to submit external payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleProofUpload = (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Proof image must be a PNG or JPG file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProofBase64(reader.result);
      setProofFilename(file.name);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6 max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-800">Payment</h3>
          <button type="button" onClick={handleClose} className="px-2 py-1 rounded hover:bg-slate-100 text-slate-500">
            Close
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">
            {error}
          </div>
        )}

        <div className="modal-body-scroll space-y-4">
          {!isEditMode && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Transaction Type</label>
              <div className="grid grid-cols-1 gap-2">
                {(memberContextOnly
                  ? TRANSACTION_TYPE_OPTIONS.filter((opt) => opt.value === 'DUES' || opt.value === 'DONATION')
                  : TRANSACTION_TYPE_OPTIONS
                ).map((option) => (
                  <label key={option.value} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="transactionType"
                      value={option.value}
                      checked={type === option.value}
                      onChange={(e) => {
                        if (lockTransactionType) return;
                        const next = e.target.value;
                        setType(next);
                        if (next === 'CAMPAIGN_CONTRIBUTION') setSelectedEventId('');
                        if (next === 'EVENT_REVENUE') setSelectedCampaignId('');
                        if (next === 'DUES' || next === 'DONATION') {
                          setSelectedCampaignId('');
                          setSelectedEventId('');
                        }
                      }}
                      className="h-4 w-4 text-emerald-600"
                      disabled={lockTransactionType}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {!isEditMode && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Contributor Type</label>
              <div className="grid grid-cols-2 gap-2">
                {CONTRIBUTOR_TYPE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="contributorType"
                      value={opt.value}
                      checked={contributorType === opt.value}
                      onChange={(e) => {
                        if (lockContributorType) return;
                        const next = e.target.value;
                        setContributorType(next);
                        if (next === 'MEMBER') {
                          setContributorName('');
                        } else {
                          setSelectedMemberId('');
                        }
                      }}
                      className="h-4 w-4 text-emerald-600"
                      disabled={lockContributorType}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {!isEditMode && allowMemberSelection && contributorType === 'MEMBER' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Member</label>
              <select
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">— Select Member —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {[m.first_name, m.last_name].filter(Boolean).join(' ') || `Member #${m.id}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!isEditMode && contributorType !== 'MEMBER' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Contributor Name</label>
              <input
                type="text"
                value={contributorName}
                onChange={(e) => setContributorName(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {!isEditMode && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Campaign (optional)</label>
              <select
                value={selectedCampaignId}
                onChange={(e) => {
                  setSelectedCampaignId(e.target.value);
                  if (e.target.value) setSelectedEventId('');
                  if (e.target.value && !lockTransactionType) setType('CAMPAIGN_CONTRIBUTION');
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">No campaign</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {!isEditMode && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Event (optional)</label>
              <select
                value={selectedEventId}
                onChange={(e) => {
                  setSelectedEventId(e.target.value);
                  if (e.target.value) setSelectedCampaignId('');
                  if (e.target.value && !lockTransactionType) setType('EVENT_REVENUE');
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">No event</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            >
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {isEditMode ? (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button
                type="button"
                onClick={handleEditSubmit}
                disabled={submitting}
                className="w-full px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                {submitting ? 'Saving…' : 'Save Changes'}
              </button>
            </>
          ) : paymentMethod === 'cash' || paymentMethod === 'check' || paymentMethod === 'other' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reference (optional)</label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button
                type="button"
                onClick={handleManualSubmit}
                disabled={submitting}
                className="w-full px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                {submitting ? 'Saving…' : 'Save Manual Payment'}
              </button>
            </>
          ) : paymentMethod === 'stripe' ? (
            <>
              <button
                type="button"
                onClick={handleStripeSubmit}
                disabled={submitting}
                className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                {submitting ? 'Opening…' : 'Proceed to secure checkout'}
              </button>
              <button
                type="button"
                onClick={handleAutoPaySubmit}
                disabled={submitting}
                className="w-full px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                {submitting ? 'Opening…' : 'Enroll in AutoPay'}
              </button>
              <p className="text-xs text-slate-500">
                AutoPay bills monthly. ACH bank verification can take a few business days.
              </p>
            </>
          ) : paymentMethod === 'import' ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Use the Import Transactions page to upload CSV imports.
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {paymentMethod === 'cashapp' ? (
                  <>
                    <div className="font-semibold">Send via Cash App</div>
                    <div className="mt-1">
                      {orgPaymentDetails.cashapp_handle
                        ? `Cash App handle: ${orgPaymentDetails.cashapp_handle}`
                        : 'Cash App handle not configured.'}
                    </div>
                  </>
                ) : paymentMethod === 'zelle' ? (
                  <>
                    <div className="font-semibold">Send via Zelle</div>
                    <div className="mt-1">
                      {orgPaymentDetails.zelle_contact
                        ? `Zelle contact: ${orgPaymentDetails.zelle_contact}`
                        : 'Zelle contact not configured.'}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-semibold">Send via Venmo</div>
                    <div className="mt-1">
                      {orgPaymentDetails.venmo_handle
                        ? `Send payment to: @${orgPaymentDetails.venmo_handle.replace(/^@/, '')}`
                        : 'Venmo handle not configured.'}
                    </div>
                  </>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reference (optional)</label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Upload proof (optional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleProofUpload}
                  className="w-full text-sm text-slate-600"
                />
              </div>
              <button
                type="button"
                onClick={() => handleExternalSubmit(
                  paymentMethod === 'cashapp' ? 'CASHAPP' : (paymentMethod === 'zelle' ? 'ZELLE' : 'VENMO')
                )}
                disabled={submitting}
                className="w-full px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'I Have Sent Payment'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
