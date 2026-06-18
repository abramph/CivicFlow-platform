import { useEffect, useState } from 'react';
import MemberSearchSelect from './MemberSearchSelect';
import * as moneyUtils from '../shared/money.js';

const api = window.civicflow;
const { formatMoneyInputFromCents, parseMoneyValue } = moneyUtils;

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
  { value: 'zeffy', label: 'ZEFFY' },
  { value: 'cash', label: 'CASH' },
  { value: 'check', label: 'CHECK' },
  { value: 'other', label: 'OTHER' },
  { value: 'import', label: 'IMPORT' },
];

const ATTRIBUTION_OPTIONS = [
  { value: 'MEMBER', label: 'Member' },
  { value: 'NON_MEMBER', label: 'No member attribution / external donor' },
];

const buildExplicitContributorName = ({ contributorName, campaignId, eventId }) => {
  const trimmed = String(contributorName || '').trim();
  if (trimmed) return trimmed;
  if (eventId) return 'Unattributed external donor (event contribution)';
  if (campaignId) return 'Unattributed external donor (campaign contribution)';
  return 'Unattributed external donor';
};

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
  const [attributionTarget, setAttributionTarget] = useState('MEMBER');
  const [contributorName, setContributorName] = useState('');
  const [editContributorMode, setEditContributorMode] = useState('CUSTOM');
  const [campaigns, setCampaigns] = useState([]);
  const [events, setEvents] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [orgPaymentDetails, setOrgPaymentDetails] = useState({ cashapp_handle: '', zelle_contact: '', venmo_handle: '', name: '' });
  const [proofBase64, setProofBase64] = useState('');
  const [proofFilename, setProofFilename] = useState('');

  const isEditMode = String(context?.mode || '').trim().toLowerCase() === 'edit';
  const lockContributorType = !allowMemberSelection && context?.memberId != null;
  const lockTransactionType = context?.campaignId != null || context?.eventId != null;
  const memberContextOnly = context?.memberId != null && context?.campaignId == null && context?.eventId == null;
  const normalizedType = String(type || '').trim().toUpperCase();
  const isDuesType = normalizedType === 'DUES';
  const isCampaignOrEventType = ['CAMPAIGN_CONTRIBUTION', 'EVENT_REVENUE'].includes(normalizedType);
  const isScopedContributionContext = isCampaignOrEventType || context?.campaignId != null || context?.eventId != null;
  const canSelectMember = isEditMode || allowMemberSelection;
  const submissionSource = String(
    context?.source
      || (context?.eventId != null ? 'EVENT'
        : context?.campaignId != null ? 'CAMPAIGN'
        : context?.memberId != null ? 'MEMBER_PROFILE'
        : 'LOCAL')
  ).trim();
  const extractPrimitiveValue = (input) => {
    if (input == null) return input;
    if (input instanceof Date) return input;
    if (Array.isArray(input)) return null;
    if (typeof input === 'object') {
      if (Object.prototype.hasOwnProperty.call(input, 'value')) {
        return input.value ?? input.id ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'id')) {
        return input.id ?? null;
      }
      return null;
    }
    return input;
  };
  const normalizeMemberSelection = (input) => {
    const raw = extractPrimitiveValue(input);
    if (raw == null) return '';
    const text = String(raw).trim();
    return text || '';
  };

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
    setSelectedMemberId(context?.memberId != null ? normalizeMemberSelection(context.memberId) : '');
    setSelectedCampaignId(context?.campaignId != null ? String(context.campaignId) : '');
    setSelectedEventId(context?.eventId != null ? String(context.eventId) : '');
    const defaultAttribution = nextType === 'DUES'
      ? 'MEMBER'
      : hasCampaign || hasEvent
      ? 'MEMBER'
      : (context?.memberId != null ? 'MEMBER' : 'NON_MEMBER');
    setAttributionTarget(lockContributorType ? 'MEMBER' : defaultAttribution);
    setContributorName('');
    setEditContributorMode('CUSTOM');
    setSubmitting(false);
    setError(null);
    setSuccessMessage('');
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
        setAmount(formatMoneyInputFromCents(tx.amount_cents ?? 0));
        setPaymentMethod(normalizeMethodForSelect(tx.payment_method));
        setDate(tx.occurred_on || new Date().toISOString().slice(0, 10));
        setNotes(tx.note || '');
        setReference(tx.reference || '');
        setSelectedMemberId(tx.member_id != null ? String(tx.member_id) : '');
        setSelectedCampaignId(tx.campaign_id != null ? String(tx.campaign_id) : '');
        setSelectedEventId(tx.event_id != null ? String(tx.event_id) : '');
        const inferredAttribution = tx.member_id != null
          ? 'MEMBER'
          : 'NON_MEMBER';
        setAttributionTarget(lockContributorType ? 'MEMBER' : inferredAttribution);
        setContributorName(tx.contributor_name || '');
        setEditContributorMode(tx.member_id != null ? 'MEMBER' : 'CUSTOM');
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

  useEffect(() => {
    if (isEditMode && isDuesType) {
      setEditContributorMode('MEMBER');
    }
  }, [isEditMode, isDuesType]);

  if (!open) return null;

  const handleClose = () => {
    if (submitting) return;
    onClose?.();
  };

  const validate = () => {
    const amountValue = parseMoneyValue(amount);
    const normalizedType = String(type || '').trim().toUpperCase();
    const normalizedAttribution = lockContributorType ? 'MEMBER' : String(attributionTarget || '').trim().toUpperCase();
    const memberId = normalizedAttribution === 'MEMBER'
      ? (normalizeMemberSelection(selectedMemberId)
        ? Number(normalizeMemberSelection(selectedMemberId))
        : (context?.memberId != null ? Number(normalizeMemberSelection(context.memberId)) : null))
      : null;
    const rawCampaignId = (normalizedType === 'CAMPAIGN_CONTRIBUTION' || context?.campaignId != null)
      ? Number(selectedCampaignId || context?.campaignId || 0)
      : null;
    const rawEventId = (normalizedType === 'EVENT_REVENUE' || context?.eventId != null)
      ? Number(selectedEventId || context?.eventId || 0)
      : null;
    const campaignId = Number.isFinite(rawCampaignId) && rawCampaignId > 0 ? rawCampaignId : null;
    const eventId = Number.isFinite(rawEventId) && rawEventId > 0 ? rawEventId : null;

    if (!normalizedType) return { error: 'Transaction type is required.' };
    if (!Number.isFinite(amountValue) || amountValue <= 0) return { error: 'Amount must be greater than 0.' };
    if (normalizedType === 'DUES' && normalizedAttribution !== 'MEMBER') return { error: 'Dues payments must be attributed to a member.' };
    if (normalizedAttribution === 'MEMBER' && !memberId) return { error: 'Member is required for member contributions.' };
    if (normalizedAttribution === 'NON_MEMBER' && !isScopedContributionContext && !String(contributorName || '').trim()) {
      return { error: 'Non-member name is required.' };
    }
    if (!date) return { error: 'Date is required.' };
    if (memberContextOnly && !['DUES', 'DONATION'].includes(normalizedType)) {
      return { error: 'Member payments must be Dues or Donation.' };
    }

    if (campaignId && eventId) return { error: 'Select either a campaign or an event, not both.' };
    if (campaignId && normalizedType !== 'CAMPAIGN_CONTRIBUTION') return { error: 'Campaign contributions must use Campaign Contribution type.' };
    if (eventId && normalizedType !== 'EVENT_REVENUE') return { error: 'Event payments must use Event Revenue type.' };
    if (normalizedType === 'CAMPAIGN_CONTRIBUTION' && !campaignId) return { error: 'Select a campaign for campaign contributions.' };
    if (normalizedType === 'EVENT_REVENUE' && !eventId) return { error: 'Select an event for event revenue.' };

    const normalizedContributorType = normalizedAttribution === 'NON_MEMBER' ? 'NON_MEMBER' : 'MEMBER';
    const normalizedContributorName = normalizedContributorType === 'NON_MEMBER'
      ? buildExplicitContributorName({ contributorName, campaignId, eventId })
      : null;

    return {
      normalizedType,
      amountValue,
      memberId,
      campaignId,
      eventId,
      contributorType: normalizedContributorType,
      contributorName: normalizedContributorName,
    };
  };

  const isAttributionSelected = () => {
    const target = lockContributorType ? 'MEMBER' : attributionTarget;
    if (target === 'MEMBER') {
      return !!(selectedMemberId || context?.memberId);
    }
    if (target === 'NON_MEMBER') {
      return isScopedContributionContext || String(contributorName || '').trim().length > 0;
    }
    return false;
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
        source: submissionSource,
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
    const amountValue = parseMoneyValue(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError('Amount must be greater than 0.');
      return;
    }
    if (!date) {
      setError('Date is required.');
      return;
    }

    const payload = {
      id: context.transactionId,
      amount: amountValue,
      payment_method: paymentMethod,
      notes,
      date,
    };

    const contributorMode = isDuesType ? 'MEMBER' : editContributorMode;
    if (contributorMode === 'MEMBER') {
      const normalizedMemberId = normalizeMemberSelection(selectedMemberId);
      if (!normalizedMemberId) {
        setError('Select a member contributor.');
        return;
      }
      payload.memberId = normalizedMemberId;
      payload.contributor_name = null;
      payload.contributor_type = 'MEMBER';
    } else {
      const customName = String(contributorName || '').trim();
      if (!customName) {
        setError('Contributor name is required.');
        return;
      }
      payload.memberId = null;
      payload.contributor_name = customName;
      payload.contributor_type = 'NON_MEMBER';
    }
    const normalizedDate = new Date(date);
    if (Number.isNaN(normalizedDate.getTime())) {
      setError('Date is invalid.');
      return;
    }
    const toNullableString = (value) => {
      const raw = extractPrimitiveValue(value);
      if (raw == null) return null;
      const text = String(raw).trim();
      return text ? text : null;
    };
    const toNullableIdString = (value) => {
      const raw = extractPrimitiveValue(value);
      if (raw == null) return null;
      const text = String(raw).trim();
      return text ? text : null;
    };

    const normalizedPayload = {
      id: Number(extractPrimitiveValue(payload.id)),
      amount: parseMoneyValue(extractPrimitiveValue(payload.amount)),
      payment_method: toNullableString(payload.payment_method),
      notes: toNullableString(payload.notes),
      date: normalizedDate.toISOString(),
      memberId: payload.memberId == null ? null : toNullableIdString(payload.memberId),
      contributorId: null,
      contributor_name: toNullableString(payload.contributor_name),
      contributor_type: toNullableString(payload.contributor_type),
    };

    // Defensive guardrail: never forward nested objects into IPC/database payloads.
    delete normalizedPayload.member;
    delete normalizedPayload.contributor;
    delete normalizedPayload.selectedMember;
    delete normalizedPayload.selectedContributor;
    console.log('transaction update payload', normalizedPayload);
    console.log('payload types', {
      id: normalizedPayload.id == null ? 'null' : typeof normalizedPayload.id,
      amount: normalizedPayload.amount == null ? 'null' : typeof normalizedPayload.amount,
      date: normalizedPayload.date == null ? 'null' : typeof normalizedPayload.date,
      memberId: normalizedPayload.memberId == null ? 'null' : typeof normalizedPayload.memberId,
      notes: normalizedPayload.notes == null ? 'null' : typeof normalizedPayload.notes,
      contributor_name: normalizedPayload.contributor_name == null ? 'null' : typeof normalizedPayload.contributor_name,
      contributor_type: normalizedPayload.contributor_type == null ? 'null' : typeof normalizedPayload.contributor_type,
    });

    setSubmitting(true);
    setError(null);
    setSuccessMessage('');
    try {
      const result = await api?.transactions?.updateById?.(normalizedPayload);
      if (result?.error) throw new Error(result.error);
      setSuccessMessage('Contributor updated successfully.');
      window.setTimeout(() => {
        onSuccess?.({ transactionId: context.transactionId, mode: 'edit' });
        onClose?.();
      }, 650);
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
        source: submissionSource,
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
        source: submissionSource,
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
        source: submissionSource,
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

  const submitDisabled = submitting || (!isEditMode && !isAttributionSelected());

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
        {successMessage && (
          <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800 text-sm">
            {successMessage}
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
                        if (next === 'DUES') {
                          setAttributionTarget('MEMBER');
                        }
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
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {isScopedContributionContext ? 'Credit this contribution to member' : 'Attribution'}
              </label>
              <div className="grid grid-cols-1 gap-2">
                {ATTRIBUTION_OPTIONS.filter((opt) => !isDuesType || opt.value === 'MEMBER').map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="attributionTarget"
                      value={opt.value}
                      checked={(lockContributorType ? 'MEMBER' : attributionTarget) === opt.value}
                      onChange={(e) => {
                        if (lockContributorType) return;
                        const next = e.target.value;
                        setAttributionTarget(next);
                        if (next === 'MEMBER') {
                          setContributorName('');
                        } else {
                          setSelectedMemberId('');
                        }
                      }}
                      className="h-4 w-4 text-emerald-600"
                      disabled={lockContributorType}
                    />
                    <span>
                      {isScopedContributionContext
                        ? (opt.value === 'MEMBER' ? 'Yes, assign to a member' : 'No member attribution / external donor')
                        : opt.label}
                    </span>
                  </label>
                ))}
              </div>
              {isScopedContributionContext && (
                <p className="mt-2 text-xs text-slate-500">
                  Campaign and event totals will still update either way. Select a member when you want the contribution to appear in that member&apos;s history.
                </p>
              )}
            </div>
          )}

          {!isEditMode && allowMemberSelection && (lockContributorType || attributionTarget === 'MEMBER') && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Credit this contribution to member</label>
              <MemberSearchSelect
                members={members}
                value={selectedMemberId}
                onChange={(value) => setSelectedMemberId(normalizeMemberSelection(value))}
                placeholder="Search by member name, email, phone, or member ID"
              />
            </div>
          )}

          {!isEditMode && attributionTarget === 'NON_MEMBER' && !isDuesType && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {isScopedContributionContext ? 'External donor name (optional)' : 'Non-member contributor'}
              </label>
              <input
                type="text"
                value={contributorName}
                onChange={(e) => setContributorName(e.target.value)}
                placeholder={isScopedContributionContext ? 'Leave blank if donor is unknown' : 'Full name'}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
              {isScopedContributionContext && (
                <p className="mt-2 text-xs text-slate-500">
                  If you leave this blank, CivicFlow will save the payment as an unattributed external donor instead of leaving attribution ambiguous.
                </p>
              )}
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

          {!isEditMode && normalizedType === 'CAMPAIGN_CONTRIBUTION' && context?.campaignId == null && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Campaign</label>
              <select
                value={selectedCampaignId}
                onChange={(e) => {
                  setSelectedCampaignId(e.target.value);
                  if (e.target.value) setSelectedEventId('');
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">Select campaign</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {!isEditMode && normalizedType === 'EVENT_REVENUE' && context?.eventId == null && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Event</label>
              <select
                value={selectedEventId}
                onChange={(e) => {
                  setSelectedEventId(e.target.value);
                  if (e.target.value) setSelectedCampaignId('');
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">Select event</option>
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

          {isEditMode && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Contributor</label>
              {!isDuesType && (
                <div className="grid grid-cols-1 gap-2 mb-2">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="editContributorMode"
                      value="MEMBER"
                      checked={editContributorMode === 'MEMBER'}
                      onChange={() => setEditContributorMode('MEMBER')}
                      className="h-4 w-4 text-emerald-600"
                    />
                    <span>Member</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="editContributorMode"
                      value="CUSTOM"
                      checked={editContributorMode === 'CUSTOM'}
                      onChange={() => setEditContributorMode('CUSTOM')}
                      className="h-4 w-4 text-emerald-600"
                    />
                    <span>Custom Name</span>
                  </label>
                </div>
              )}

              {(editContributorMode === 'MEMBER' || isDuesType) ? (
                <MemberSearchSelect
                  members={members}
                  value={selectedMemberId}
                  onChange={(value) => {
                    setSelectedMemberId(normalizeMemberSelection(value));
                    if (editContributorMode !== 'MEMBER') setEditContributorMode('MEMBER');
                  }}
                  placeholder="Search member..."
                  disabled={!canSelectMember}
                />
              ) : (
                <input
                  type="text"
                  value={contributorName}
                  onChange={(e) => setContributorName(e.target.value)}
                  placeholder="Contributor full name"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              )}
            </div>
          )}

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
                disabled={submitDisabled}
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
                disabled={submitDisabled}
                className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                {submitting ? 'Opening…' : 'Proceed to secure checkout'}
              </button>
              <button
                type="button"
                onClick={handleAutoPaySubmit}
                disabled={submitDisabled}
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
                ) : paymentMethod === 'zeffy' ? (
                  <>
                    <div className="font-semibold">Received via Zeffy</div>
                    <div className="mt-1">Record a payment that was collected through your Zeffy form. Enter the amount and reference from the Zeffy receipt.</div>
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
                  paymentMethod === 'cashapp' ? 'CASHAPP' :
                  paymentMethod === 'zelle' ? 'ZELLE' :
                  paymentMethod === 'zeffy' ? 'ZEFFY' : 'VENMO'
                )}
                disabled={submitDisabled}
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
