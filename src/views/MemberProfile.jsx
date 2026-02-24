import { useState, useEffect, useRef } from 'react';
import { Save, ArrowLeft, User, Receipt, DollarSign, X, Pencil, Trash2, FileDown, Mail, Target, Calendar, Plus, CheckCircle, XCircle, AlertTriangle, Clock, RotateCcw, Ban, Shield, ArrowRightLeft, Send } from 'lucide-react';
import EmailReportModal from '../components/EmailReportModal';
import PaymentModal from '../components/PaymentModal';

const api = window.civicflow;

const emitInvalidation = (keys) => {
  if (typeof window === 'undefined') return;
  const detail = Array.isArray(keys) ? keys : [];
  window.dispatchEvent(new CustomEvent('civicflow:invalidate', { detail }));
};

const DUES_STATUS_STYLES = {
  current: { label: 'Current', bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
  credit: { label: 'Credit', bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
  past_due: { label: 'Past Due', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  delinquent: { label: 'Delinquent', bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
};

const AUTOPAY_STATUS_STYLES = {
  NONE: { label: 'Not Enrolled', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
  ACTIVE: { label: 'Active', bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
  PAUSED: { label: 'Paused', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  CANCELING: { label: 'Canceling', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  CANCELED: { label: 'Canceled', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
};

function normalizeMembershipStatus(raw, fallbackMember = null) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const rawStatus = String(value.status ?? value.current_status ?? '').trim();
  const lowered = rawStatus.toLowerCase();
  let status = 'None';
  if (lowered === 'active') status = 'Active';
  else if (lowered === 'inactive') status = 'Inactive';
  else if (lowered === 'terminated') status = 'Terminated';
  else if (lowered === 'reinstated') status = 'Reinstated';
  else if (rawStatus) status = rawStatus;
  else if (String(fallbackMember?.status || '').toLowerCase() === 'inactive') status = 'Inactive';

  return {
    status,
    startDate: value.startDate ?? value.start_date ?? fallbackMember?.join_date ?? null,
    endDate: value.endDate ?? value.end_date ?? null,
    terminationReason: value.terminationReason ?? value.termination_reason ?? null,
    periodId: value.periodId ?? value.period_id ?? null,
  };
}

function settleRequest(label, request, fallbackValue, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      console.warn(`[MemberProfile] ${label} timed out after ${timeoutMs}ms`);
      resolve(fallbackValue);
    }, timeoutMs);

    Promise.resolve()
      .then(() => request?.())
      .then((value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value ?? fallbackValue);
      })
      .catch((err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err?.message) {
          console.warn(`[MemberProfile] ${label} failed: ${err.message}`);
        }
        resolve(fallbackValue);
      });
  });
}

export function MemberProfile({ memberId, onBack }) {
  const [member, setMember] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [paymentModalContext, setPaymentModalContext] = useState(null);
  const [editFormVisible, setEditFormVisible] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false);
  const [permanentDeleteConfirmText, setPermanentDeleteConfirmText] = useState('');
  const [permanentDeleting, setPermanentDeleting] = useState(false);
  const [receiptGeneratingId, setReceiptGeneratingId] = useState(null);
  const [receiptMessage, setReceiptMessage] = useState(null);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [orgName, setOrgName] = useState('Civicflow');
  const [organizationId, setOrganizationId] = useState(1);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [stripeAccountId, setStripeAccountId] = useState(null);
  const [reminderSending, setReminderSending] = useState(false);
  const [reminderMessage, setReminderMessage] = useState(null);
  const [contribModalOpen, setContribModalOpen] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [events, setEvents] = useState([]);
  const [contribForm, setContribForm] = useState({
    targetType: 'campaign',
    campaignId: '',
    eventId: '',
    amountDollars: '',
    note: '',
    occurredOn: new Date().toISOString().slice(0, 10),
  });
  const [contribSubmitting, setContribSubmitting] = useState(false);
  const [contribError, setContribError] = useState(null);
  const [autopayError, setAutopayError] = useState(null);
  const [autopayLoading, setAutopayLoading] = useState(false);
  const profileFormRef = useRef(null);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [memberPayouts, setMemberPayouts] = useState([]);
  const [loadingPayouts, setLoadingPayouts] = useState(false);

  // Membership lifecycle state
  const [membershipStatus, setMembershipStatus] = useState(null);
  const [membershipPeriods, setMembershipPeriods] = useState([]);
  const [membershipAction, setMembershipAction] = useState(null); // 'inactive'|'terminate'|'reinstate'|null
  const [membershipReason, setMembershipReason] = useState('');
  const [membershipDate, setMembershipDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reinstateMode, setReinstateMode] = useState('NEW_PERIOD');
  const [membershipSaving, setMembershipSaving] = useState(false);

  // Financial ledger state
  const [finTxns, setFinTxns] = useState([]);
  const [showVoided, setShowVoided] = useState(false);
  const [correctModal, setCorrectModal] = useState(null); // {txn} or null
  const [correctAmount, setCorrectAmount] = useState('');
  const [correctDate, setCorrectDate] = useState('');
  const [correctReason, setCorrectReason] = useState('');
  const [adjustModal, setAdjustModal] = useState(null); // {txn} or null
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [editModal, setEditModal] = useState(null); // {txn} or null
  const [editForm, setEditForm] = useState({ txn_type: 'DUES', amount: '', txn_date: '', reference: '', notes: '' });
  const [editReason, setEditReason] = useState('');
  const [reverseModal, setReverseModal] = useState(null); // {txn} or null
  const [reverseDate, setReverseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reverseReason, setReverseReason] = useState('');
  const [deleteModal, setDeleteModal] = useState(null); // {txn} or null
  const [finSaving, setFinSaving] = useState(false);
  const [finError, setFinError] = useState(null);

  // New ledger entry
  const [newLedgerOpen, setNewLedgerOpen] = useState(false);
  const [ledgerForm, setLedgerForm] = useState({ txn_type: 'DUES', amount: '', txn_date: new Date().toISOString().slice(0, 10), reference: '', notes: '' });

  // Role
  const [currentRole, setCurrentRole] = useState('Admin');

  // Email Report modal state
  const [emailReportModal, setEmailReportModal] = useState(null); // { reportType, params, subject, body, attachmentName } or null

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address: '',
    category_id: null,
    status: 'active',
    dob: '',
    join_date: '',
  });

  useEffect(() => {
    api?.receipt?.isEmailConfigured?.().then((r) => {
      if (r?.configured) setEmailConfigured(true);
    }).catch(() => {});
    api?.roles?.getCurrent?.().then((r) => {
      if (r?.role) setCurrentRole(r.role);
    }).catch(() => {});
    api?.organization?.get?.().then((org) => {
      if (org?.name) setOrgName(org.name);
      if (org?.id) setOrganizationId(org.id);
      setPaymentsEnabled((org?.payments_enabled ?? 0) === 1);
      setStripeAccountId(org?.stripe_account_id ?? null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const keys = Array.isArray(e?.detail) ? e.detail : [];
      if (keys.includes('dues') || keys.includes('transactions')) {
        refreshMember();
        refreshMembershipData();
      }
    };
    window.addEventListener('civicflow:invalidate', handler);
    return () => window.removeEventListener('civicflow:invalidate', handler);
  }, [memberId, showVoided]);

  useEffect(() => {
    if (!memberId) {
      setLoading(false);
      setError('No member selected');
      setMember(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      settleRequest('getMemberDetails', () => api?.getMemberDetails?.(memberId), null),
      settleRequest('categories.list', () => api?.categories?.list?.(), []),
      settleRequest('receipt.isEmailConfigured', () => api?.receipt?.isEmailConfigured?.(), { configured: false }),
      settleRequest('campaigns.listActive', () => api?.campaigns?.listActive?.(), []),
      settleRequest('events.listActive', () => api?.events?.listActive?.(), []),
      settleRequest('attendance.getForMember', () => api?.attendance?.getForMember?.(memberId), []),
      settleRequest('expenditures.list', () => api?.expenditures?.list?.({ payeeType: 'member', payeeMemberId: memberId }), []),
    ])
      .then(([data, cats, emailCfg, camps, evts, attendance, payouts]) => {
        if (!cancelled && data) {
          setMember(data);
          setForm({
            first_name: data.first_name ?? '',
            last_name: data.last_name ?? '',
            email: data.email ?? '',
            phone: data.phone ?? '',
            address: data.address ?? '',
            category_id: data.category_id ?? null,
            status: data.status ?? 'active',
            dob: data.dob ?? '',
            join_date: data.join_date ?? '',
          });
        } else if (!cancelled) {
          setError('Failed to load member');
          setMember(null);
        }
        if (!cancelled && cats) setCategories(Array.isArray(cats) ? cats : []);
        if (!cancelled && emailCfg) setEmailConfigured(emailCfg.configured ?? false);
        if (!cancelled && camps) setCampaigns(Array.isArray(camps) ? camps : []);
        if (!cancelled && evts) setEvents(Array.isArray(evts) ? evts : []);
        if (!cancelled && attendance) setAttendanceHistory(Array.isArray(attendance) ? attendance : []);
        if (!cancelled && payouts) setMemberPayouts(Array.isArray(payouts) ? payouts : []);

        // Load membership lifecycle and financial ledger data
        if (!cancelled && memberId) {
          Promise.all([
            settleRequest('membership.getCurrentStatus', () => api?.membership?.getCurrentStatus?.(memberId), null),
            settleRequest('membership.listPeriods', () => api?.membership?.listPeriods?.(memberId), []),
            settleRequest('financeTxns.list', () => api?.financeTxns?.list?.(memberId, false), []),
          ]).then(([mStatus, mPeriods, fTxns]) => {
            if (!cancelled) {
              setMembershipStatus(normalizeMembershipStatus(mStatus, data));
              if (mPeriods) setMembershipPeriods(Array.isArray(mPeriods) ? mPeriods : []);
              if (fTxns) setFinTxns(Array.isArray(fTxns) ? fTxns : []);
            }
          }).catch(() => {});
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message ?? 'Failed to load member');
          setMember(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [memberId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: name === 'category_id' ? (value ? Number(value) : null) : value,
    }));
  };

  const handleSave = async () => {
    if (!memberId) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      await api.updateMemberProfile(memberId, form);
      setSaveSuccess(true);
      refreshMember();
      setEditFormVisible(false);
    } catch (err) {
      setError(err?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!memberId || !onBack) return;
    setDeleting(true);
    try {
      await api.members.archive(memberId);
      onBack();
    } catch (err) {
      setError(err?.message ?? 'Failed to delete member');
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!memberId || !onBack) return;
    if (permanentDeleteConfirmText.trim().toLowerCase() !== 'delete') return;
    
    setPermanentDeleting(true);
    try {
      const result = await api.members.deletePermanent(memberId);
      if (result?.error) {
        setError(result.error);
        return;
      }
      onBack();
    } catch (err) {
      setError(err?.message ?? 'Failed to permanently delete member');
    } finally {
      setPermanentDeleting(false);
      setPermanentDeleteOpen(false);
      setPermanentDeleteConfirmText('');
    }
  };

  const formatCurrency = (cents) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(
      (cents ?? 0) / 100
    );

  const formatDate = (d) => {
    if (d == null || d === '') return '—';
    try {
      return new Date(d).toLocaleDateString();
    } catch {
      return String(d);
    }
  };

  const formatTxnType = (type) => {
    const t = String(type || '').trim().toUpperCase();
    if (t === 'DUES') return 'Dues Payment';
    if (t === 'DONATION') return 'Donation';
    if (t === 'CAMPAIGN_CONTRIBUTION') return 'Campaign Contribution';
    if (t === 'EVENT_REVENUE') return 'Event Revenue';
    if (t === 'OTHER_INCOME') return 'Other Income';
    return t.replace(/_/g, ' ');
  };

  const formatTxnTypeWithContext = (txn) => {
    const txnType = String(txn?.txn_type || txn?.transaction_type || txn?.type || '').trim().toUpperCase();
    if (txnType === 'CAMPAIGN_CONTRIBUTION') {
      return txn?.campaign_name
        ? `Campaign Contribution (${txn.campaign_name})`
        : 'Campaign Contribution';
    }
    if (txnType === 'EVENT_REVENUE') {
      return txn?.event_name
        ? `Event Revenue (${txn.event_name})`
        : 'Event Revenue';
    }
    return formatTxnType(txnType);
  };

  const getLedgerAmountCents = (txn) => {
    if (Number.isFinite(Number(txn?.amount_cents))) return Number(txn.amount_cents);
    if (Number.isFinite(Number(txn?.amount))) return Math.round(Number(txn.amount) * 100);
    return 0;
  };

  const isLedgerVoided = (txn) => {
    const status = String(txn?.status || '').toUpperCase();
    return status === 'VOIDED' || Number(txn?.is_deleted) === 1;
  };

  const isLedgerPosted = (txn) => {
    if (isLedgerVoided(txn)) return false;
    const status = String(txn?.status || '').toUpperCase();
    return status === 'POSTED' || status === 'COMPLETED' || status === '';
  };

  const getTxnTypeBadge = (transactionType) => {
    const t = String(transactionType || '').trim().toUpperCase();
    if (t === 'DUES') return <span className="mr-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Dues Payment</span>;
    if (t === 'DONATION') return <span className="mr-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Donation</span>;
    if (t === 'CAMPAIGN_CONTRIBUTION') return <span className="mr-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Campaign Contribution</span>;
    if (t === 'EVENT_REVENUE') return <span className="mr-2 inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">Event Revenue</span>;
    return null;
  };

  const refreshMember = () => {
    if (!memberId) return;
    api?.getMemberDetails?.(memberId).then((data) => {
      if (data) setMember(data);
    });
  };

  const openPaymentModal = ({ memberId: modalMemberId, orgId, type, amount }) => {
    setPaymentModalContext({
      memberId: modalMemberId ?? memberId ?? member?.id ?? null,
      orgId: orgId ?? organizationId ?? 1,
      type: type || 'DUES',
      amount: amount ?? '',
      date: new Date().toISOString().slice(0, 10),
    });
  };

  const getPaymentBadge = (note) => {
    const lower = String(note || '').toLowerCase();
    if (lower.includes('stripe')) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 mr-2">Online Payment</span>;
    }
    if (lower.includes('manual')) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 mr-2">Manual Payment</span>;
    }
    return null;
  };

  const handleSendDuesReminder = async () => {
    if (!member?.email) {
      setReminderMessage({ type: 'error', text: 'Member has no email address.' });
      return;
    }
    setReminderSending(true);
    setReminderMessage(null);
    try {
      const result = await api?.email?.sendDuesReminder?.({
        id: memberId ?? member?.id,
        orgId: organizationId ?? 1,
        email: member?.email,
        name: displayName,
      });
      if (result?.skipped) {
        setReminderMessage({ type: 'success', text: 'No reminder sent: member has no past-due balance.' });
        return;
      }
      if (result?.error) throw new Error(result.error);
      setReminderMessage({ type: 'success', text: 'Dues reminder sent.' });
    } catch (err) {
      setReminderMessage({ type: 'error', text: err?.message ?? 'Failed to send reminder.' });
    } finally {
      setReminderSending(false);
    }
  };

  const handleEnrollAutoPay = async () => {
    if (!memberId) return;
    if (!paymentsEnabled || !stripeAccountId) {
      setAutopayError('Online payments are not enabled for this organization.');
      return;
    }
    const amount = monthlyDuesCents > 0 ? monthlyDuesCents / 100 : 0;
    if (!amount) {
      setAutopayError('Monthly dues amount is not set for this member.');
      return;
    }
    setAutopayLoading(true);
    setAutopayError(null);
    try {
      const result = await api?.payments?.createSubscription?.({
        memberId: memberId ?? member?.id,
        orgId: organizationId ?? 1,
        amount,
        interval: 'month',
      });
      if (result?.error) throw new Error(result.error);
      if (!result?.url) throw new Error('No Stripe checkout URL returned.');
      window.open(result.url, '_blank');
    } catch (err) {
      setAutopayError(err?.message ?? 'Unable to start AutoPay enrollment.');
    } finally {
      setAutopayLoading(false);
    }
  };

  const handleAutopayAction = async (action) => {
    if (!memberId) return;
    if (!paymentsEnabled || !stripeAccountId) {
      setAutopayError('Online payments are not enabled for this organization.');
      return;
    }
    setAutopayLoading(true);
    setAutopayError(null);
    try {
      const payload = { orgId: organizationId ?? 1, memberId };
      let result;
      if (action === 'pause') result = await api?.autopay?.pause?.(payload);
      if (action === 'resume') result = await api?.autopay?.resume?.(payload);
      if (action === 'cancel_end') result = await api?.autopay?.cancelEnd?.(payload);
      if (action === 'cancel_now') result = await api?.autopay?.cancelNow?.(payload);
      if (result?.error) throw new Error(result.error);
      refreshMember();
      refreshMembershipData();
    } catch (err) {
      setAutopayError(err?.message ?? 'AutoPay action failed.');
    } finally {
      setAutopayLoading(false);
    }
  };

  const handleGenerateReceipt = async (transactionId) => {
    setReceiptMessage(null);
    setReceiptGeneratingId(transactionId);
    try {
      const result = await api.receipt?.savePdfDialog?.(transactionId);
      if (result?.canceled) {
        setReceiptMessage(null);
      } else if (result?.ok && result.path) {
        setReceiptMessage({ type: 'success', text: `Receipt saved to ${result.path}` });
      } else {
        const errText = result?.error || 'Failed to save receipt.';
        const stackText = result?.stack ? ` ${result.stack}` : '';
        setReceiptMessage({ type: 'error', text: errText + stackText });
      }
    } catch (err) {
      setReceiptMessage({ type: 'error', text: (err?.message || 'Failed to save receipt.') + (err?.stack ? ` ${err.stack}` : '') });
    } finally {
      setReceiptGeneratingId(null);
    }
  };

  const handleAddContribution = async (e) => {
    e.preventDefault();
    const amountCents = Math.round(parseFloat(contribForm.amountDollars || 0) * 100);
    if (amountCents <= 0) {
      setContribError('Amount must be greater than 0');
      return;
    }
    const isCampaign = contribForm.targetType === 'campaign';
    const campaignId = isCampaign && contribForm.campaignId ? Number(contribForm.campaignId) : null;
    const eventId = !isCampaign && contribForm.eventId ? Number(contribForm.eventId) : null;
    if (!campaignId && !eventId) {
      setContribError('Select a campaign or event');
      return;
    }
    setContribSubmitting(true);
    setContribError(null);
    try {
      await api.transactions.create({
        transaction_type: campaignId ? 'CAMPAIGN_CONTRIBUTION' : 'EVENT_REVENUE',
        amount_cents: amountCents,
        occurred_on: contribForm.occurredOn || new Date().toISOString().slice(0, 10),
        member_id: memberId,
        campaign_id: campaignId,
        event_id: eventId,
        note: contribForm.note || null,
      });
      emitInvalidation(['transactions', 'dashboard', 'dues']);
      setContribModalOpen(false);
      setContribForm({ targetType: 'campaign', campaignId: '', eventId: '', amountDollars: '', note: '', occurredOn: new Date().toISOString().slice(0, 10) });
      refreshMember();
    } catch (err) {
      setContribError(err?.message ?? 'Failed to save contribution');
    } finally {
      setContribSubmitting(false);
    }
  };

  const handleEmailReceipt = async (transactionId) => {
    setReceiptMessage(null);
    setReceiptGeneratingId(transactionId);
    try {
      const result = await api.receipt?.emailReceipt?.(transactionId);
      if (result?.ok) {
        setReceiptMessage({ type: 'success', text: 'Receipt emailed.' });
      } else {
        const errText = result?.error || 'Failed to email receipt.';
        const stackText = result?.stack ? ` ${result.stack}` : '';
        setReceiptMessage({ type: 'error', text: errText + stackText });
      }
    } catch (err) {
      setReceiptMessage({ type: 'error', text: (err?.message || 'Failed to email receipt.') + (err?.stack ? ` ${err.stack}` : '') });
    } finally {
      setReceiptGeneratingId(null);
    }
  };

  const refreshMembershipData = () => {
    if (!memberId) return;
    Promise.all([
      api?.membership?.getCurrentStatus?.(memberId),
      api?.membership?.listPeriods?.(memberId),
      api?.financeTxns?.list?.(memberId, showVoided),
    ]).then(([mStatus, mPeriods, fTxns]) => {
      setMembershipStatus(normalizeMembershipStatus(mStatus, member));
      if (mPeriods) setMembershipPeriods(Array.isArray(mPeriods) ? mPeriods : []);
      if (fTxns) setFinTxns(Array.isArray(fTxns) ? fTxns : []);
    }).catch(() => {});
  };

  const handleMembershipAction = async () => {
    setMembershipSaving(true);
    try {
      let result;
      if (membershipAction === 'inactive') {
        result = await api?.membership?.setInactive?.(memberId, membershipReason || null);
      } else if (membershipAction === 'terminate') {
        result = await api?.membership?.terminate?.(memberId, membershipDate, membershipReason || null);
      } else if (membershipAction === 'reinstate') {
        result = await api?.membership?.reinstate?.(memberId, reinstateMode, membershipDate, membershipReason || null);
      } else if (membershipAction === 'newPeriod') {
        result = await api?.membership?.startNewPeriod?.(memberId, membershipDate, membershipReason || null);
      }
      if (result?.error) {
        setError(result.error);
      } else {
        setMembershipAction(null);
        setMembershipReason('');
        refreshMember();
        refreshMembershipData();
      }
    } catch (err) {
      setError(err?.message ?? 'Action failed');
    } finally {
      setMembershipSaving(false);
    }
  };

  const handleFinCorrect = async () => {
    if (!correctModal) return;
    const amt = parseFloat(correctAmount);
    if (isNaN(amt)) { setFinError('Enter a valid amount'); return; }
    const normalizedReason = String(correctReason || '').trim();
    if (normalizedReason.length < 5) { setFinError('Reason is required for financial modifications.'); return; }
    setFinSaving(true);
    setFinError(null);
    try {
      const result = await api?.financeTxns?.correct?.(correctModal.id, amt, correctDate || null, normalizedReason);
      if (result?.error) { setFinError(result.error); return; }
      setCorrectModal(null);
      emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
      refreshMembershipData();
    } catch (err) {
      setFinError(err?.message ?? 'Correction failed');
    } finally {
      setFinSaving(false);
    }
  };

  const handleFinAdjust = async () => {
    if (!adjustModal) return;
    const delta = parseFloat(adjustDelta);
    if (isNaN(delta) || delta === 0) { setFinError('Enter a non-zero amount'); return; }
    const normalizedReason = String(adjustReason || '').trim();
    if (normalizedReason.length < 5) { setFinError('Reason is required for financial modifications.'); return; }
    setFinSaving(true);
    setFinError(null);
    try {
      const result = await api?.financeTxns?.adjust?.(adjustModal.id, delta, normalizedReason);
      if (result?.error) { setFinError(result.error); return; }
      setAdjustModal(null);
      emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
      refreshMembershipData();
    } catch (err) {
      setFinError(err?.message ?? 'Adjustment failed');
    } finally {
      setFinSaving(false);
    }
  };

  const handleFinEdit = async () => {
    if (!editModal) return;
    const amt = parseFloat(editForm.amount);
    if (isNaN(amt)) { setFinError('Enter a valid amount'); return; }
    if (!editForm.txn_date) { setFinError('Date is required'); return; }
    const normalizedReason = String(editReason || '').trim();
    if (normalizedReason.length < 5) { setFinError('Reason is required for financial modifications.'); return; }
    setFinSaving(true);
    setFinError(null);
    try {
      const result = await api?.financeTxns?.update?.(editModal.id, {
        txn_type: editForm.txn_type,
        amount: amt,
        txn_date: editForm.txn_date,
        reference: editForm.reference || null,
        notes: editForm.notes || null,
        reason: normalizedReason,
      });
      if (result?.error) { setFinError(result.error); return; }
      setEditModal(null);
      emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
      refreshMembershipData();
    } catch (err) {
      setFinError(err?.message ?? 'Edit failed');
    } finally {
      setFinSaving(false);
    }
  };

  const handleFinReverse = async () => {
    if (!reverseModal) return;
    const normalizedReason = String(reverseReason || '').trim();
    if (normalizedReason.length < 5) { setFinError('Reason is required for financial modifications.'); return; }
    setFinSaving(true);
    setFinError(null);
    try {
      const result = await api?.financeTxns?.reverse?.(reverseModal.id, normalizedReason, reverseDate || null);
      if (result?.error) { setFinError(result.error); return; }
      setReverseModal(null);
      setReverseReason('');
      emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
      refreshMembershipData();
    } catch (err) {
      setFinError(err?.message ?? 'Reverse failed');
    } finally {
      setFinSaving(false);
    }
  };

  const handleFinDelete = async () => {
    if (!deleteModal) return;
    setFinSaving(true);
    setFinError(null);
    try {
      const result = await api?.financeTxns?.delete?.(deleteModal.id, 'Admin');
      if (result?.error) { setFinError(result.error); return; }
      setDeleteModal(null);
      emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
      refreshMembershipData();
    } catch (err) {
      setFinError(err?.message ?? 'Delete failed');
    } finally {
      setFinSaving(false);
    }
  };

  const handleCreateLedgerEntry = async () => {
    const amt = parseFloat(ledgerForm.amount);
    if (isNaN(amt) || amt === 0) { setFinError('Enter a valid amount'); return; }
    if (!ledgerForm.txn_date) { setFinError('Date is required'); return; }
    setFinSaving(true);
    setFinError(null);
    try {
      const result = await api?.financeTxns?.create?.({
        member_id: memberId,
        txn_type: ledgerForm.txn_type,
        amount: amt,
        txn_date: ledgerForm.txn_date,
        reference: ledgerForm.reference || null,
        notes: ledgerForm.notes || null,
      });
      if (result?.error) { setFinError(result.error); return; }
      setNewLedgerOpen(false);
      setLedgerForm({ txn_type: 'DUES', amount: '', txn_date: new Date().toISOString().slice(0, 10), reference: '', notes: '' });
      emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
      refreshMembershipData();
      refreshMember();
    } catch (err) {
      setFinError(err?.message ?? 'Failed to create entry');
    } finally {
      setFinSaving(false);
    }
  };

  const isAdmin = currentRole === 'Admin';

  const MEMBERSHIP_STATUS_STYLES = {
    Active: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
    Inactive: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
    Terminated: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
    Reinstated: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
    None: { bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-300' },
    Unknown: { bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-300' },
  };

  const transactions = member?.transactions ?? [];
  const duesStatus = member?.duesStatus ?? null;
  const monthlyDuesCents = member?.monthly_dues_cents ?? 0;
  const categoryName = member?.category_name ?? '—';
  const joinDate = member?.join_date ?? member?.created_at ?? null;
  const autopayStatusRaw = String(member?.autopay_status || 'NONE').toUpperCase();
  const autopayStyle = AUTOPAY_STATUS_STYLES[autopayStatusRaw] ?? AUTOPAY_STATUS_STYLES.NONE;
  const autopayAllowed = paymentsEnabled && !!stripeAccountId;

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-slate-500">Loading member profile…</p>
      </div>
    );
  }

  if (error && !member) {
    return (
      <div className="p-8">
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
        {onBack && (
          <button onClick={onBack} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">
            <ArrowLeft className="h-4 w-4" />
            Back to Members
          </button>
        )}
      </div>
    );
  }

  if (!member) {
    return (
      <div className="p-8">
        <p className="text-slate-500">Member not found.</p>
        {onBack && (
          <button onClick={onBack} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        )}
      </div>
    );
  }

  const displayName = [member?.first_name, member?.last_name].filter(Boolean).join(' ') || 'Member';
  const statusStyle = duesStatus ? (DUES_STATUS_STYLES[duesStatus.status] ?? { label: duesStatus.status, bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-300' }) : null;
  const isAdminRole = currentRole === 'Admin' || currentRole === 'admin';
  const isViewerRole = currentRole === 'Viewer' || currentRole === 'view';

  return (
    <div className="p-8">
      {onBack && (
        <button
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-slate-600 hover:bg-slate-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Members
        </button>
      )}

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}
      {saveSuccess && (
        <div role="status" className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
          Changes saved.
        </div>
      )}

      {/* Member name header + actions */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{displayName}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-slate-600 text-sm">{categoryName}</span>
          {statusStyle && (
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
              {statusStyle.label}
            </span>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setEditFormVisible(true); profileFormRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-medium hover:bg-slate-200"
          >
            <Pencil className="h-4 w-4" />
            Edit Member
          </button>
          <button
            type="button"
            onClick={() => setDeleteConfirmOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 text-amber-700 font-medium hover:bg-amber-100 border border-amber-200"
          >
            <Trash2 className="h-4 w-4" />
            Archive Member
          </button>
          <button
            type="button"
            onClick={() => { setPermanentDeleteConfirmText(''); setPermanentDeleteOpen(true); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 text-red-700 font-medium hover:bg-red-100 border border-red-200"
          >
            <AlertTriangle className="h-4 w-4" />
            Permanently Delete
          </button>
        </div>
      </div>

      {/* Archive confirmation modal */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !deleting && setDeleteConfirmOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Archive Member</h3>
            <p className="text-slate-600 mb-6">
              Are you sure you want to archive this member? The member will be set to inactive status and hidden from the active members list. You can restore them later.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" onClick={handleDeleteConfirm} disabled={deleting} className="px-4 py-2 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-60">
                {deleting ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent delete confirmation modal */}
      {permanentDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !permanentDeleting && setPermanentDeleteOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800">Permanently Delete Member</h3>
            </div>
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-red-800 text-sm font-medium">
                ⚠️ This action is IRREVERSIBLE
              </p>
              <p className="text-red-700 text-sm mt-1">
                The member record will be permanently deleted from the database along with their attendance records. Transaction history will be preserved but unlinked.
              </p>
            </div>
            <p className="text-slate-600 mb-4">
              To confirm, type <span className="font-mono font-bold">delete</span> below:
            </p>
            <input
              type="text"
              value={permanentDeleteConfirmText}
              onChange={(e) => setPermanentDeleteConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && permanentDeleteConfirmText.trim().toLowerCase() === 'delete') {
                  handlePermanentDelete();
                }
              }}
              placeholder="Type delete to confirm"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500 mb-4"
              autoComplete="off"
              autoFocus
              disabled={permanentDeleting}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setPermanentDeleteOpen(false); setPermanentDeleteConfirmText(''); }}
                disabled={permanentDeleting}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePermanentDelete}
                disabled={permanentDeleting || permanentDeleteConfirmText.trim().toLowerCase() !== 'delete'}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {permanentDeleting ? 'Deleting…' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={profileFormRef} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Member Profile</h2>
          </div>
          {!editFormVisible && (
            <button type="button" onClick={() => setEditFormVisible(true)} className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">
              Edit
            </button>
          )}
        </div>
        {(editFormVisible || !member?.first_name) ? (
        <>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">First Name</label>
            <input
              type="text"
              name="first_name"
              value={form.first_name}
              onChange={handleChange}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
            <input
              type="text"
              name="last_name"
              value={form.last_name}
              onChange={handleChange}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
            <input
              type="text"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
            <input
              type="text"
              name="address"
              value={form.address}
              onChange={handleChange}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
            <select
              name="category_id"
              value={form.category_id ?? ''}
              onChange={handleChange}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date of Birth (Optional)</label>
            <input
              type="date"
              name="dob"
              value={form.dob}
              onChange={handleChange}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Join Date</label>
            <input
              type="date"
              name="join_date"
              value={form.join_date}
              onChange={handleChange}
              max={new Date().toISOString().split('T')[0]}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-xs text-slate-500 mt-1">Used for dues calculation</p>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setEditFormVisible(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
        </div>
        </>
        ) : (
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><span className="text-slate-500">Name</span><br />{form.first_name} {form.last_name}</div>
            <div><span className="text-slate-500">Email</span><br />{form.email || '—'}</div>
            <div><span className="text-slate-500">Phone</span><br />{form.phone || '—'}</div>
            <div><span className="text-slate-500">Category</span><br />{categories.find(c => c.id === form.category_id)?.name ?? '—'}</div>
            <div><span className="text-slate-500">Status</span><br />{form.status}</div>
            <div><span className="text-slate-500">Date of Birth</span><br />{form.dob ? formatDate(form.dob) : '—'}</div>
            <div><span className="text-slate-500">Join Date</span><br />{form.join_date ? formatDate(form.join_date) : '—'}</div>
          </div>
        )}
      </div>

      {/* Dues & Payments financial view */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Dues & Payments</h2>
          </div>
          <div className="flex items-center gap-2">
            {isAdminRole && (
              <button
                type="button"
                onClick={handleSendDuesReminder}
                disabled={reminderSending}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {reminderSending ? 'Sending…' : 'Send Payment Reminder'}
              </button>
            )}
            {paymentsEnabled && (isAdminRole || isViewerRole) && (
              <button
                type="button"
                onClick={() => {
                  const defaultAmountDollars = duesStatus?.balanceCents < 0
                    ? Math.abs(duesStatus.balanceCents) / 100
                    : (monthlyDuesCents || 0) / 100;
                  openPaymentModal({
                    memberId: memberId ?? member?.id,
                    orgId: organizationId ?? 1,
                    type: 'DUES',
                    amount: defaultAmountDollars > 0 ? defaultAmountDollars : '',
                  });
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                {isViewerRole ? 'Make Payment' : 'Pay Dues'}
              </button>
            )}
          </div>
        </div>
        <div className="p-6">
          {reminderMessage && (
            <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${reminderMessage.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              {reminderMessage.text}
            </div>
          )}
          {autopayError && (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {autopayError}
            </div>
          )}
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-600">AutoPay</span>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium border ${autopayStyle.bg} ${autopayStyle.text} ${autopayStyle.border}`}>
                  {autopayStyle.label}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {autopayStatusRaw === 'NONE' || autopayStatusRaw === 'CANCELED' ? (
                  <button
                    type="button"
                    onClick={handleEnrollAutoPay}
                    disabled={!autopayAllowed || autopayLoading}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {autopayLoading ? 'Opening…' : 'Enroll in AutoPay'}
                  </button>
                ) : null}
                {autopayStatusRaw === 'ACTIVE' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleAutopayAction('pause')}
                      disabled={!autopayAllowed || autopayLoading}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-300 text-amber-700 font-medium hover:bg-amber-50 disabled:opacity-60"
                    >
                      Pause AutoPay
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAutopayAction('cancel_end')}
                      disabled={!autopayAllowed || autopayLoading}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-300 text-red-700 font-medium hover:bg-red-50 disabled:opacity-60"
                    >
                      Cancel AutoPay
                    </button>
                  </>
                ) : null}
                {autopayStatusRaw === 'PAUSED' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleAutopayAction('resume')}
                      disabled={!autopayAllowed || autopayLoading}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
                    >
                      Resume AutoPay
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAutopayAction('cancel_end')}
                      disabled={!autopayAllowed || autopayLoading}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-300 text-red-700 font-medium hover:bg-red-50 disabled:opacity-60"
                    >
                      Cancel AutoPay
                    </button>
                  </>
                ) : null}
                {autopayStatusRaw === 'CANCELING' ? (
                  <button
                    type="button"
                    onClick={() => handleAutopayAction('cancel_now')}
                    disabled={!autopayAllowed || autopayLoading}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-300 text-red-700 font-medium hover:bg-red-50 disabled:opacity-60"
                  >
                    Cancel Now
                  </button>
                ) : null}
              </div>
            </div>
            {!autopayAllowed && (
              <p className="mt-2 text-xs text-slate-500">
                Online payments are not enabled for this organization.
              </p>
            )}
            {autopayStatusRaw === 'CANCELING' && (
              <p className="mt-2 text-xs text-slate-500">
                AutoPay will stop at the end of the current billing period.
              </p>
            )}
          </div>
          {duesStatus ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div>
                <p className="text-sm text-slate-500">Membership category</p>
                <p className="font-medium text-slate-800">{categoryName}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Monthly dues</p>
                <p className="font-medium text-slate-800">{formatCurrency(monthlyDuesCents)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Join date</p>
                <p className="font-medium text-slate-800">{formatDate(joinDate)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Status</p>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium border ${DUES_STATUS_STYLES[duesStatus.status]?.bg ?? 'bg-slate-100'} ${DUES_STATUS_STYLES[duesStatus.status]?.text ?? 'text-slate-800'} ${DUES_STATUS_STYLES[duesStatus.status]?.border ?? 'border-slate-300'}`}>
                  {DUES_STATUS_STYLES[duesStatus.status]?.label ?? duesStatus.status}
                </span>
              </div>
              <div>
                <p className="text-sm text-slate-500">Total expected dues</p>
                <p className="font-medium text-slate-800">{formatCurrency(duesStatus.totalDuesExpectedCents)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Total paid</p>
                <p className="font-medium text-slate-800">{formatCurrency(duesStatus.totalPaidCents)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Balance</p>
                <p className={`font-medium ${duesStatus.balanceCents > 0 ? 'text-emerald-700' : duesStatus.balanceCents < 0 ? 'text-amber-700' : 'text-slate-800'}`}>
                  {duesStatus.balanceCents > 0 ? '+' : ''}{formatCurrency(duesStatus.balanceCents)}
                  {duesStatus.balanceCents > 0 ? ' (credit)' : duesStatus.balanceCents < 0 ? ' (past due)' : ''}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-slate-500">No category or dues data. Assign a category with monthly dues to see status.</p>
          )}
        </div>
      </div>

      {receiptMessage && (
        <div
          role="status"
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${receiptMessage.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}
        >
          {receiptMessage.text}
        </div>
      )}

      {/* Membership Status & Lifecycle */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Membership Status</h2>
          </div>
          {membershipStatus && (
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium border ${(MEMBERSHIP_STATUS_STYLES[membershipStatus.status] || MEMBERSHIP_STATUS_STYLES.Unknown).bg} ${(MEMBERSHIP_STATUS_STYLES[membershipStatus.status] || MEMBERSHIP_STATUS_STYLES.Unknown).text} ${(MEMBERSHIP_STATUS_STYLES[membershipStatus.status] || MEMBERSHIP_STATUS_STYLES.Unknown).border}`}>
              {membershipStatus.status}
            </span>
          )}
        </div>
        <div className="p-6">
          {membershipStatus && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-sm">
              <div><span className="text-slate-500">Current Status</span><br /><span className="font-medium">{membershipStatus.status}</span></div>
              <div><span className="text-slate-500">Period Start</span><br /><span className="font-medium">{membershipStatus.startDate ? formatDate(membershipStatus.startDate) : '—'}</span></div>
              <div><span className="text-slate-500">Period End</span><br /><span className="font-medium">{membershipStatus.endDate ? formatDate(membershipStatus.endDate) : 'Open (current)'}</span></div>
              {membershipStatus.terminationReason && (
                <div className="md:col-span-3"><span className="text-slate-500">Termination Reason</span><br /><span className="font-medium">{membershipStatus.terminationReason}</span></div>
              )}
            </div>
          )}

          {/* Admin actions */}
          {isAdmin && !membershipAction && (
            <div className="flex flex-wrap gap-2 mt-2 pt-4 border-t border-slate-100">
              {membershipStatus?.status === 'Active' || membershipStatus?.status === 'Reinstated' ? (
                <>
                  <button onClick={() => { setMembershipAction('inactive'); setMembershipReason(''); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100">
                    <Ban className="h-3.5 w-3.5" /> Set Inactive
                  </button>
                  <button onClick={() => { setMembershipAction('terminate'); setMembershipReason(''); setMembershipDate(new Date().toISOString().slice(0, 10)); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
                    <Trash2 className="h-3.5 w-3.5" /> Terminate
                  </button>
                </>
              ) : membershipStatus?.status === 'Inactive' ? (
                <>
                  <button onClick={() => { setMembershipAction('terminate'); setMembershipReason(''); setMembershipDate(new Date().toISOString().slice(0, 10)); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
                    <Trash2 className="h-3.5 w-3.5" /> Terminate
                  </button>
                  <button onClick={() => { setMembershipAction('reinstate'); setReinstateMode('NEW_PERIOD'); setMembershipReason(''); setMembershipDate(new Date().toISOString().slice(0, 10)); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
                    <RotateCcw className="h-3.5 w-3.5" /> Reinstate
                  </button>
                </>
              ) : membershipStatus?.status === 'Terminated' || membershipStatus?.status === 'None' ? (
                <>
                  <button onClick={() => { setMembershipAction('reinstate'); setReinstateMode('NEW_PERIOD'); setMembershipReason(''); setMembershipDate(new Date().toISOString().slice(0, 10)); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
                    <RotateCcw className="h-3.5 w-3.5" /> Reinstate
                  </button>
                  <button onClick={() => { setMembershipAction('newPeriod'); setMembershipReason(''); setMembershipDate(new Date().toISOString().slice(0, 10)); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
                    <Plus className="h-3.5 w-3.5" /> New Period
                  </button>
                </>
              ) : null}
            </div>
          )}

          {/* Membership action modal (inline) */}
          {membershipAction && (
            <div className="mt-4 p-4 rounded-lg border border-slate-200 bg-slate-50">
              <h4 className="font-semibold text-slate-800 mb-3">
                {membershipAction === 'inactive' && 'Set Member Inactive'}
                {membershipAction === 'terminate' && 'Terminate Membership'}
                {membershipAction === 'reinstate' && 'Reinstate Membership'}
                {membershipAction === 'newPeriod' && 'Start New Membership Period'}
              </h4>
              <div className="space-y-3">
                {(membershipAction === 'terminate' || membershipAction === 'reinstate' || membershipAction === 'newPeriod') && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {membershipAction === 'terminate' ? 'End Date' : 'Start Date'}
                    </label>
                    <input type="date" value={membershipDate} onChange={(e) => setMembershipDate(e.target.value)} className="w-full max-w-xs px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" />
                  </div>
                )}
                {membershipAction === 'reinstate' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Reinstatement Mode</label>
                    <select value={reinstateMode} onChange={(e) => setReinstateMode(e.target.value)} className="w-full max-w-xs px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500">
                      <option value="NEW_PERIOD">New Period (recommended)</option>
                      <option value="REOPEN">Reopen Previous Period</option>
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Reason (optional)</label>
                  <input type="text" value={membershipReason} onChange={(e) => setMembershipReason(e.target.value)} placeholder="Enter reason..." className="w-full max-w-md px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={handleMembershipAction} disabled={membershipSaving} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60 text-sm">
                    {membershipSaving ? 'Saving...' : 'Confirm'}
                  </button>
                  <button onClick={() => setMembershipAction(null)} disabled={membershipSaving} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Period history */}
          {membershipPeriods.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-semibold text-slate-700 mb-3">Membership History</h4>
              <div className="space-y-2">
                {membershipPeriods.map((p) => {
                  const pStyle = MEMBERSHIP_STATUS_STYLES[p.status] || MEMBERSHIP_STATUS_STYLES.Unknown;
                  return (
                    <div key={p.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50 border border-slate-100">
                      <div className="flex items-center gap-3">
                        <Clock className="h-4 w-4 text-slate-400" />
                        <div className="text-sm">
                          <span className="font-medium text-slate-800">{formatDate(p.start_date)}</span>
                          <span className="text-slate-500"> — </span>
                          <span className="font-medium text-slate-800">{p.end_date ? formatDate(p.end_date) : 'Present'}</span>
                          {p.termination_reason && <span className="text-slate-500 ml-2">({p.termination_reason})</span>}
                        </div>
                      </div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${pStyle.bg} ${pStyle.text} ${pStyle.border}`}>
                        {p.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Financial Ledger (Immutable) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Financial Ledger</h2>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={showVoided} onChange={(e) => { setShowVoided(e.target.checked); api?.financeTxns?.list?.(memberId, e.target.checked).then(t => setFinTxns(Array.isArray(t) ? t : [])).catch(() => {}); }} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              Show voided
            </label>
            {currentRole === 'Admin' && finTxns.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const today = new Date().toISOString().slice(0, 10);
                  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
                  const memberName = member ? ((member.first_name || '') + ' ' + (member.last_name || '')).trim() : 'Member';
                  setEmailReportModal({
                    reportType: 'member_contribution',
                    params: { memberId, startDate: yearAgo, endDate: today },
                    subject: 'Your Financial Ledger Report – ' + orgName,
                    body: `Dear ${memberName},\n\nAttached is your financial ledger report from ${orgName}.\nPlease contact us if you have any questions.`,
                    attachmentName: 'Member_Financial_Ledger_' + memberId + '.pdf',
                  });
                }}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 text-sm"
                title="Email financial ledger report"
              >
                <Send className="h-4 w-4" /> Email Report
              </button>
            )}
            <button onClick={() => { setFinError(null); setNewLedgerOpen(true); }} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 text-sm">
              <Plus className="h-4 w-4" /> New Entry
            </button>
          </div>
        </div>
        <div className="p-6">
          {finTxns.length === 0 ? (
            <p className="text-slate-500 text-sm">No financial ledger entries yet. Entries can be edited, reversed, or deleted as needed.</p>
          ) : (
            <>
              {/* Ledger net summary */}
              {(() => {
                const netAmountCents = finTxns
                  .filter((t) => isLedgerPosted(t))
                  .reduce((sum, t) => sum + getLedgerAmountCents(t), 0);
                return (
                  <p className="text-sm text-slate-600 mb-4">
                    Net posted total: <span className={`font-semibold ${netAmountCents >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {formatCurrency(netAmountCents)}
                    </span>
                    <span className="text-slate-400 ml-2">({finTxns.filter((t) => isLedgerPosted(t)).length} posted entries)</span>
                  </p>
                );
              })()}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80">
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Date</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Type</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Amount</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Notes</th>
                      {isAdmin && <th className="text-right px-4 py-3 font-semibold text-slate-600">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {finTxns.map((t) => {
                      const amountCents = getLedgerAmountCents(t);
                      const voided = isLedgerVoided(t);
                      return (
                      <tr key={t.id} className={`hover:bg-slate-50/50 ${voided ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3">{formatDate(t.txn_date)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            t.txn_type === 'REVERSAL' ? 'bg-red-100 text-red-700' :
                            t.txn_type === 'ADJUSTMENT' ? 'bg-amber-100 text-amber-700' :
                            t.txn_type === 'DUES' ? 'bg-emerald-100 text-emerald-700' :
                            t.txn_type === 'CONTRIBUTION' ? 'bg-blue-100 text-blue-700' :
                            'bg-slate-100 text-slate-700'
                          }`}>{formatTxnTypeWithContext(t)}</span>
                          {t.related_txn_id && <span className="ml-1 text-xs text-slate-400">#{t.related_txn_id}</span>}
                        </td>
                        <td className={`px-4 py-3 text-right font-medium ${amountCents >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {formatCurrency(amountCents)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium ${voided ? 'text-red-500 line-through' : 'text-emerald-600'}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate" title={t.notes || ''}>{t.notes || '—'}</td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-right">
                            {isLedgerPosted(t) && t.txn_type !== 'REVERSAL' && t.txn_type !== 'ADJUSTMENT' && (
                              t.is_imported ? (
                                <span className="px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-600">Imported record (locked)</span>
                              ) : (
                                <div className="flex justify-end gap-1 flex-wrap">
                                  <button
                                    onClick={() => {
                                      setFinError(null);
                                      setEditForm({
                                        txn_type: t.txn_type,
                                        amount: String(amountCents / 100),
                                        txn_date: t.txn_date || new Date().toISOString().slice(0, 10),
                                        reference: t.reference || '',
                                        notes: t.notes || '',
                                      });
                                      setEditReason('');
                                      setEditModal(t);
                                    }}
                                    className="px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => {
                                      setFinError(null);
                                      setReverseDate(new Date().toISOString().slice(0, 10));
                                      setReverseReason('');
                                      setReverseModal(t);
                                    }}
                                    className="px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100"
                                  >
                                    Reverse
                                  </button>
                                  <button onClick={() => { setFinError(null); setCorrectAmount(''); setCorrectDate(t.txn_date); setCorrectReason(''); setCorrectModal(t); }} className="px-2 py-1 rounded text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100">Correct</button>
                                  <button onClick={() => { setFinError(null); setAdjustDelta(''); setAdjustReason(''); setAdjustModal(t); }} className="px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100">Adjust</button>
                                  {/* Delete removed: use Reverse instead */}
                                </div>
                              )
                            )}
                          </td>
                        )}
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* New Ledger Entry Modal */}
      {newLedgerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setNewLedgerOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-slate-800">New Financial Entry</h3>
              <button onClick={() => setNewLedgerOpen(false)} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X className="h-5 w-5" /></button>
            </div>
            {finError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">{finError}</div>}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <select value={ledgerForm.txn_type} onChange={(e) => setLedgerForm(f => ({...f, txn_type: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500">
                  <option value="DUES">Dues</option>
                  <option value="CONTRIBUTION">Contribution</option>
                  <option value="INVOICE">Invoice</option>
                  <option value="RECEIPT">Receipt</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount ($)</label>
                <input type="number" inputMode="decimal" step="0.01" value={ledgerForm.amount} onChange={(e) => setLedgerForm(f => ({...f, amount: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <input type="date" value={ledgerForm.txn_date} onChange={(e) => setLedgerForm(f => ({...f, txn_date: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reference (optional)</label>
                <input type="text" value={ledgerForm.reference} onChange={(e) => setLedgerForm(f => ({...f, reference: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" placeholder="e.g., INV-001" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                <input type="text" value={ledgerForm.notes} onChange={(e) => setLedgerForm(f => ({...f, notes: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setNewLedgerOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleCreateLedgerEntry} disabled={finSaving} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60">{finSaving ? 'Saving...' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Correct Transaction Modal */}
      {correctModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCorrectModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Correct Transaction #{correctModal.id}</h3>
            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
              This will create a reversal of the original ({new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(correctModal.amount)}) and a new corrected entry. The original remains for audit.
            </div>
            {finError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">{finError}</div>}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Correct Amount ($)</label>
                <input type="number" inputMode="decimal" step="0.01" value={correctAmount} onChange={(e) => setCorrectAmount(e.target.value)} autoFocus className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-amber-500" placeholder="New correct amount" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Correction Date</label>
                <input type="date" value={correctDate} onChange={(e) => setCorrectDate(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reason *</label>
                <textarea value={correctReason} onChange={(e) => setCorrectReason(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-amber-500" placeholder="Enter reason for correction (min 5 characters)" rows={3} />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setCorrectModal(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleFinCorrect} disabled={finSaving} className="px-4 py-2 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-60">{finSaving ? 'Processing...' : 'Create Correction'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Transaction Modal */}
      {adjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAdjustModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Adjust Transaction #{adjustModal.id}</h3>
            <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
              This adds an adjustment entry linked to the original ({new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(adjustModal.amount)}). Use positive to add, negative to reduce.
            </div>
            {finError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">{finError}</div>}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Adjustment Amount ($)</label>
                <input type="number" inputMode="decimal" step="0.01" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} autoFocus className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500" placeholder="e.g., -10.00 or 5.50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reason *</label>
                <textarea value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500" placeholder="Enter reason for adjustment (min 5 characters)" rows={3} />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setAdjustModal(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleFinAdjust} disabled={finSaving} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60">{finSaving ? 'Processing...' : 'Create Adjustment'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Transaction Modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Edit Transaction #{editModal.id}</h3>
            {finError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">{finError}</div>}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <select value={editForm.txn_type} onChange={(e) => setEditForm((f) => ({ ...f, txn_type: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-slate-500">
                  <option value="DUES">Dues</option>
                  <option value="CONTRIBUTION">Contribution</option>
                  <option value="INVOICE">Invoice</option>
                  <option value="RECEIPT">Receipt</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount ($)</label>
                <input type="number" inputMode="decimal" step="0.01" value={editForm.amount} onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-slate-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <input type="date" value={editForm.txn_date} onChange={(e) => setEditForm((f) => ({ ...f, txn_date: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-slate-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reference (optional)</label>
                <input type="text" value={editForm.reference} onChange={(e) => setEditForm((f) => ({ ...f, reference: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-slate-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                <input type="text" value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-slate-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reason for change *</label>
                <textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-slate-500" placeholder="Enter reason for edit, correction, or adjustment (min 5 characters)" rows={3} />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setEditModal(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleFinEdit} disabled={finSaving} className="px-4 py-2 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-800 disabled:opacity-60">{finSaving ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Reverse Transaction Modal */}
      {reverseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setReverseModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Reverse Transaction #{reverseModal.id}</h3>
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              This will create a new reversal entry for {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(reverseModal.amount || 0)}.
            </div>
            {finError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">{finError}</div>}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reversal Date</label>
                <input type="date" value={reverseDate} onChange={(e) => setReverseDate(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reason *</label>
                <textarea value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500" placeholder="Enter reason for reversal (min 5 characters)" rows={3} />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setReverseModal(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleFinReverse} disabled={finSaving} className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-60">{finSaving ? 'Processing...' : 'Create Reversal'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Transaction Modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Delete Transaction #{deleteModal.id}</h3>
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              This will soft delete the transaction and hide it from totals and reports.
            </div>
            {finError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">{finError}</div>}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setDeleteModal(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleFinDelete} disabled={finSaving} className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-60">{finSaving ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Campaign & Event Contributions */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Campaign & Event Contributions</h2>
          </div>
          <button
            type="button"
            onClick={() => { setContribError(null); setContribModalOpen(true); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700"
          >
            <Plus size={18} />
            Add Contribution
          </button>
        </div>
        <div className="p-6">
          {(() => {
            const contribTxns = transactions.filter((t) => t.campaign_id || t.event_id);
            const totalContrib = contribTxns
              .filter((t) => String(t?.status || 'COMPLETED').toUpperCase() === 'COMPLETED' && t.amount_cents > 0)
              .reduce((s, t) => s + t.amount_cents, 0);
            if (contribTxns.length === 0) {
              return <p className="text-slate-500">No campaign or event contributions yet.</p>;
            }
            return (
              <>
                <p className="text-sm text-slate-600 mb-4">Total contributed: <span className="font-semibold text-emerald-700">{formatCurrency(totalContrib)}</span></p>
                <div className="space-y-2">
                  {contribTxns.map((t) => (
                    <div key={t.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                      <div>
                        <span className="font-medium text-slate-800">{formatDate(t.occurred_on)}</span>
                        <span className="text-slate-600 ml-2">
                          {t.campaign_name || t.event_name || (t.campaign_id ? 'Campaign' : 'Event')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-emerald-700">{formatCurrency(t.amount_cents)}</span>
                        <button
                          type="button"
                          onClick={() => handleGenerateReceipt(t.id)}
                          disabled={receiptGeneratingId === t.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60"
                          title="Save receipt as PDF"
                        >
                          <FileDown className="h-4 w-4" />
                          Receipt
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Add Contribution modal */}
      {contribModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !contribSubmitting && setContribModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-slate-800">Add Contribution</h3>
              <button type="button" onClick={() => setContribModalOpen(false)} className="p-1 rounded hover:bg-slate-100 text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            {contribError && (
              <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">
                {contribError}
              </div>
            )}
            <form onSubmit={handleAddContribution} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Contribute to</label>
                <select
                  value={contribForm.targetType}
                  onChange={(e) => setContribForm((f) => ({ ...f, targetType: e.target.value, campaignId: '', eventId: '' }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="campaign">Campaign</option>
                  <option value="event">Event</option>
                </select>
              </div>
              {contribForm.targetType === 'campaign' ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Campaign *</label>
                  <select
                    required
                    value={contribForm.campaignId}
                    onChange={(e) => setContribForm((f) => ({ ...f, campaignId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Select campaign…</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Event *</label>
                  <select
                    required
                    value={contribForm.eventId}
                    onChange={(e) => setContribForm((f) => ({ ...f, eventId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Select event…</option>
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>{ev.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount ($) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={contribForm.amountDollars}
                  onChange={(e) => setContribForm((f) => ({ ...f, amountDollars: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={contribForm.occurredOn}
                  onChange={(e) => setContribForm((f) => ({ ...f, occurredOn: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={contribForm.note}
                  onChange={(e) => setContribForm((f) => ({ ...f, note: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setContribModalOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={contribSubmitting} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60">
                  {contribSubmitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attendance History */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-800">Attendance History</h2>
        </div>
        <div className="p-6">
          {loadingAttendance ? (
            <p className="text-slate-500">Loading attendance records…</p>
          ) : attendanceHistory.length === 0 ? (
            <p className="text-slate-500">No attendance records</p>
          ) : (
            <div className="space-y-2">
              {attendanceHistory.map((record) => (
                <div key={record.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div>
                    <span className="font-medium text-slate-800">{record.title || 'Meeting'}</span>
                    <span className="text-slate-600 ml-2">{formatDate(record.meeting_date)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {record.attended === 1 || record.attended === true ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-sm bg-emerald-100 text-emerald-800">
                        <CheckCircle className="h-4 w-4" />
                        Yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-sm bg-slate-100 text-slate-600">
                        <XCircle className="h-4 w-4" />
                        No
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Financial Activity / Payouts */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-800">Financial Activity / Payouts</h2>
        </div>
        <div className="p-6">
          {loadingPayouts ? (
            <p className="text-slate-500">Loading payout records…</p>
          ) : memberPayouts.length === 0 ? (
            <p className="text-slate-500">No payout records</p>
          ) : (
            <div className="space-y-3">
              {memberPayouts.map((payout) => (
                <div key={payout.id} className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{payout.description || 'Payout'}</span>
                      {payout.category && (
                        <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">{payout.category}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-slate-600">
                      <span>{formatDate(payout.date)}</span>
                      {payout.source_type && payout.source_type !== 'organization' && (
                        <span className="text-slate-500">
                          {payout.source_type === 'event' ? 'Event' : payout.source_type === 'campaign' ? 'Campaign' : ''}
                        </span>
                      )}
                      {payout.payment_method && (
                        <span className="text-slate-500">• {payout.payment_method}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-emerald-700">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(payout.amount || 0)}
                    </span>
                    {payout.status && (
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        payout.status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                        payout.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {payout.status}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Transactions</h2>
          </div>
          {currentRole === 'Admin' && transactions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10);
                const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
                const memberName = member ? ((member.first_name || '') + ' ' + (member.last_name || '')).trim() : 'Member';
                setEmailReportModal({
                  reportType: 'member_contribution',
                  params: { memberId, startDate: yearAgo, endDate: today },
                  subject: 'Your Financial Report – ' + orgName,
                  body: `Dear ${memberName},\n\nAttached is your financial report from ${orgName}.\nPlease contact us if you have any questions.`,
                  attachmentName: 'Member_Contribution_' + memberId + '.pdf',
                });
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 text-sm"
              title="Email this member's transaction report"
            >
              <Send className="h-4 w-4" />
              Email Report
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          {transactions.length === 0 ? (
            <div className="p-12 text-center text-slate-500">No transactions yet.</div>
          ) : (
            <table className="w-full min-w-[500px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="text-left text-xs font-semibold uppercase text-slate-600 px-6 py-4">Date</th>
                  <th className="text-left text-xs font-semibold uppercase text-slate-600 px-6 py-4">Type</th>
                  <th className="text-right text-xs font-semibold uppercase text-slate-600 px-6 py-4">Amount</th>
                  <th className="text-left text-xs font-semibold uppercase text-slate-600 px-6 py-4">Note</th>
                  <th className="text-left text-xs font-semibold uppercase text-slate-600 px-6 py-4">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4">{formatDate(t.occurred_on)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        {getTxnTypeBadge(t.transaction_type)}
                        <span>{formatTxnTypeWithContext(t)}</span>
                      </div>
                    </td>
                    <td className={`px-6 py-4 text-right font-medium ${t.amount_cents >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {formatCurrency(t.amount_cents)}
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {getPaymentBadge(t.note)}
                      {t.note ?? '—'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleGenerateReceipt(t.id)}
                          disabled={receiptGeneratingId === t.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60"
                          title="Save receipt as PDF"
                        >
                          <FileDown className="h-4 w-4" />
                          PDF
                        </button>
                        {emailConfigured ? (
                          <button
                            type="button"
                            onClick={() => handleEmailReceipt(t.id)}
                            disabled={receiptGeneratingId === t.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60"
                            title="Email receipt to member"
                          >
                            <Mail className="h-4 w-4" />
                            Email
                          </button>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-sm bg-slate-50 text-slate-400 cursor-not-allowed"
                            title="Email not configured"
                          >
                            <Mail className="h-4 w-4" />
                            Email
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Email Report Modal */}
      <PaymentModal
        open={!!paymentModalContext}
        onClose={() => setPaymentModalContext(null)}
        context={paymentModalContext}
        members={[]}
        allowMemberSelection={false}
        onSuccess={() => {
          emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
          refreshMembershipData();
          refreshMember();
        }}
      />

      {/* Email Report Modal */}
      <EmailReportModal
        open={!!emailReportModal}
        onClose={() => setEmailReportModal(null)}
        reportType={emailReportModal?.reportType}
        reportParams={emailReportModal?.params}
        defaultTo={member?.email || ''}
        defaultSubject={emailReportModal?.subject || ''}
        defaultBody={emailReportModal?.body || ''}
        attachmentName={emailReportModal?.attachmentName || 'Report.pdf'}
        memberStatus={membershipStatus?.status || null}
        auditAction="EMAIL_MEMBER_REPORT_SENT"
        auditEntityType="member"
        auditEntityId={memberId}
        auditMetadata={{ reportType: emailReportModal?.reportType, memberName: member ? ((member.first_name || '') + ' ' + (member.last_name || '')).trim() : '' }}
      />
    </div>
  );
}
