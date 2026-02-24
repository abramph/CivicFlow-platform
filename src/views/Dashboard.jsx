import { useState, useEffect } from 'react';
import { Users, Calendar, DollarSign, TrendingDown, AlertCircle, UserCheck, Target, Receipt, Award, Lock, ChevronRight, Mail, Ban, Shield, FileText } from 'lucide-react';

const api = window.civicflow;
const getDashboardStats = () => {
  const p = api?.getDashboardStats?.();
  if (p && typeof p.then === 'function') return p;
  const legacy = window.electron?.invoke?.('get-dashboard-stats');
  if (legacy && typeof legacy.then === 'function') return legacy;
  return Promise.resolve(null);
};

export function Dashboard({ onNavigate }) {
  const [stats, setStats] = useState({
    totalMembers: 0,
    currentMembers: 0,
    pastDueMembers: 0,
    delinquentMembers: 0,
    totalDuesOutstandingCents: 0,
    duesCollectedLast30DaysCents: 0,
    expenseLast30DaysCents: 0,
    totalTransactionsCents: 0,
    upcomingEventsCount: 0,
    campaignProgress: [],
    totalCampaignContributionsCents: 0,
    totalEventContributionsCents: 0,
    totalDuesCents: 0,
    totalDonationsCents: 0,
    totalCampaignRevenueCents: 0,
    totalEventRevenueCents: 0,
    totalExpendituresCurrentMonth: 0,
    totalExpendituresYTD: 0,
    totalMemberPayouts: 0,
    totalOperationalExpenses: 0,
    paymentMethodBreakdown: [],
  });
  const [logoUrl, setLogoUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [grantsEnabled, setGrantsEnabled] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [membershipCounts, setMembershipCounts] = useState({ active: 0, inactive: 0, terminated: 0, reinstated: 0 });

  const refreshStats = () => {
    getDashboardStats()
      .then((data) => {
        if (data) {
          setStats({
            totalMembers: data.totalMembers ?? data.totalActiveMembers ?? 0,
            currentMembers: data.currentMembers ?? 0,
            pastDueMembers: data.pastDueMembers ?? 0,
            delinquentMembers: data.delinquentMembers ?? 0,
            totalDuesOutstandingCents: data.totalDuesOutstandingCents ?? 0,
            duesCollectedLast30DaysCents: data.duesCollectedLast30DaysCents ?? data.incomeLast30DaysCents ?? 0,
            expenseLast30DaysCents: data.expenseLast30DaysCents ?? 0,
            totalTransactionsCents: data.totalTransactionsCents ?? 0,
            upcomingEventsCount: data.upcomingEventsCount ?? 0,
            campaignProgress: data.campaignProgress ?? [],
            totalCampaignContributionsCents: data.totalCampaignContributionsCents ?? 0,
            totalEventContributionsCents: data.totalEventContributionsCents ?? 0,
            totalDuesCents: data.totalDuesCents ?? 0,
            totalDonationsCents: data.totalDonationsCents ?? 0,
            totalCampaignRevenueCents: data.totalCampaignRevenueCents ?? data.totalCampaignContributionsCents ?? 0,
            totalEventRevenueCents: data.totalEventRevenueCents ?? data.totalEventContributionsCents ?? 0,
            totalExpendituresCurrentMonth: data.totalExpendituresCurrentMonth ?? 0,
            totalExpendituresYTD: data.totalExpendituresYTD ?? 0,
            totalMemberPayouts: data.totalMemberPayouts ?? 0,
            totalOperationalExpenses: data.totalOperationalExpenses ?? 0,
            paymentMethodBreakdown: data.paymentMethodBreakdown ?? [],
          });
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDashboardStats()
      .then((data) => {
        if (!cancelled && data) {
          setStats({
            totalMembers: data.totalMembers ?? data.totalActiveMembers ?? 0,
            currentMembers: data.currentMembers ?? 0,
            pastDueMembers: data.pastDueMembers ?? 0,
            delinquentMembers: data.delinquentMembers ?? 0,
            totalDuesOutstandingCents: data.totalDuesOutstandingCents ?? 0,
            duesCollectedLast30DaysCents: data.duesCollectedLast30DaysCents ?? data.incomeLast30DaysCents ?? 0,
            expenseLast30DaysCents: data.expenseLast30DaysCents ?? 0,
            totalTransactionsCents: data.totalTransactionsCents ?? 0,
            upcomingEventsCount: data.upcomingEventsCount ?? 0,
            campaignProgress: data.campaignProgress ?? [],
            totalCampaignContributionsCents: data.totalCampaignContributionsCents ?? 0,
            totalEventContributionsCents: data.totalEventContributionsCents ?? 0,
            totalDuesCents: data.totalDuesCents ?? 0,
            totalDonationsCents: data.totalDonationsCents ?? 0,
            totalCampaignRevenueCents: data.totalCampaignRevenueCents ?? data.totalCampaignContributionsCents ?? 0,
            totalEventRevenueCents: data.totalEventRevenueCents ?? data.totalEventContributionsCents ?? 0,
            totalExpendituresCurrentMonth: data.totalExpendituresCurrentMonth ?? 0,
            totalExpendituresYTD: data.totalExpendituresYTD ?? 0,
            totalMemberPayouts: data.totalMemberPayouts ?? 0,
            totalOperationalExpenses: data.totalOperationalExpenses ?? 0,
            paymentMethodBreakdown: data.paymentMethodBreakdown ?? [],
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message ?? 'Failed to load dashboard');
          setStats({
            totalMembers: 0,
            currentMembers: 0,
            pastDueMembers: 0,
            delinquentMembers: 0,
            totalDuesOutstandingCents: 0,
            duesCollectedLast30DaysCents: 0,
            expenseLast30DaysCents: 0,
            totalTransactionsCents: 0,
            upcomingEventsCount: 0,
            campaignProgress: [],
            totalCampaignContributionsCents: 0,
            totalEventContributionsCents: 0,
            totalDuesCents: 0,
            totalDonationsCents: 0,
            totalCampaignRevenueCents: 0,
            totalEventRevenueCents: 0,
            totalExpendituresCurrentMonth: 0,
            totalExpendituresYTD: 0,
            totalMemberPayouts: 0,
            totalOperationalExpenses: 0,
            paymentMethodBreakdown: [],
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const keys = Array.isArray(e?.detail) ? e.detail : [];
      const shouldRefresh =
        keys.length === 0
        || keys.includes('dashboard')
        || keys.includes('transactions')
        || keys.includes('dues')
        || keys.includes('expenditures')
        || keys.includes('reports')
        || keys.includes('import');

      if (shouldRefresh) {
        refreshStats();
      }
    };
    window.addEventListener('civicflow:invalidate', handler);
    return () => window.removeEventListener('civicflow:invalidate', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const orgPromise = api?.organization?.get?.();
    if (orgPromise && typeof orgPromise.then === 'function') {
      orgPromise.then((org) => {
        if (cancelled || !org?.logo_path) return;
        try {
          // Use app:// protocol instead of file:// to avoid Electron security restrictions
          // Ensure Windows drive letter colon is preserved (C:\ → C:/)
          let normalizedPath = org.logo_path.replace(/\\/g, '/');
          // Ensure drive letter has colon (C/Users → C:/Users)
          if (/^[A-Za-z]\//.test(normalizedPath)) {
            normalizedPath = normalizedPath.replace(/^([A-Za-z])\//, '$1:/');
          }
          setLogoUrl(`app://${normalizedPath}`);
        } catch (_) {}
      });
    }
    return () => { cancelled = true; };
  }, []);

  // Check if grants feature is enabled
  useEffect(() => {
    let cancelled = false;
    const grantsPromise = api?.features?.isEnabled?.('grants');
    if (grantsPromise && typeof grantsPromise.then === 'function') {
      grantsPromise
        .then((enabled) => {
          if (!cancelled) setGrantsEnabled(!!enabled);
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadMembershipCounts = () => {
      const activePromise = api?.members?.list?.({ status: 'active' });
      if (activePromise && typeof activePromise.then === 'function') {
        activePromise
          .then((members) => {
            if (!cancelled && Array.isArray(members)) {
              setMembershipCounts((prev) => ({ ...prev, active: members.length }));
            }
          })
          .catch(() => {});
      }

      const inactivePromise = api?.members?.list?.({ status: 'inactive' });
      if (inactivePromise && typeof inactivePromise.then === 'function') {
        inactivePromise
          .then((members) => {
            if (!cancelled && Array.isArray(members)) {
              setMembershipCounts((prev) => ({ ...prev, inactive: members.length }));
            }
          })
          .catch(() => {});
      }

      const allMembersPromise = api?.members?.list?.();
      if (allMembersPromise && typeof allMembersPromise.then === 'function') {
        allMembersPromise
          .then((allMembers) => {
            if (cancelled || !Array.isArray(allMembers)) return;
            let terminated = 0;
            let reinstated = 0;
            const promises = allMembers.map((m) => {
              const statusPromise = api?.membership?.getCurrentStatus?.(m.id);
              if (!statusPromise || typeof statusPromise.then !== 'function') return Promise.resolve();
              return statusPromise
                .then((s) => {
                  if (s?.status === 'Terminated') terminated++;
                  if (s?.status === 'Reinstated') reinstated++;
                })
                .catch(() => {});
            });

            Promise.all(promises).then(() => {
              if (!cancelled) {
                setMembershipCounts((prev) => ({ ...prev, terminated, reinstated }));
              }
            });
          })
          .catch(() => {});
      }
    };

    loadMembershipCounts();

    const handler = (e) => {
      const keys = Array.isArray(e?.detail) ? e.detail : [];
      const shouldRefreshCounts =
        keys.length === 0
        || keys.includes('dashboard')
        || keys.includes('members')
        || keys.includes('transactions')
        || keys.includes('dues')
        || keys.includes('import');

      if (shouldRefreshCounts) {
        loadMembershipCounts();
      }
    };

    window.addEventListener('civicflow:invalidate', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('civicflow:invalidate', handler);
    };
  }, []);

  const formatCurrency = (cents) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format((cents ?? 0) / 100);

  const PAYMENT_METHOD_LABELS = {
    STRIPE: 'Stripe',
    ZELLE: 'Zelle',
    CASHAPP: 'Cash App',
    VENMO: 'Venmo',
    CASH: 'Cash',
    CHECK: 'Check',
    OTHER: 'Other',
    IMPORT: 'Imported',
    MANUAL: 'Manual',
  };

  const formatMethodLabel = (method) => {
    const m = String(method || '').toUpperCase();
    if (!m) return 'Other';
    return PAYMENT_METHOD_LABELS[m] || m;
  };

  const statCards = [
    { label: 'Total Members', value: loading ? '—' : stats.totalMembers, subtext: 'Active', icon: Users, color: 'emerald', navigateTo: { view: 'members' } },
    { label: 'Total Dues', value: loading ? '—' : formatCurrency(stats.totalDuesCents), subtext: 'All time', icon: DollarSign, color: 'emerald', navigateTo: { view: 'reports-dashboard', params: { types: ['DUES'] } } },
    { label: 'Total Donations', value: loading ? '—' : formatCurrency(stats.totalDonationsCents), subtext: 'All time', icon: DollarSign, color: 'sky', navigateTo: { view: 'reports-dashboard', params: { types: ['DONATION'] } } },
    { label: 'Campaign Contributions', value: loading ? '—' : formatCurrency(stats.totalCampaignRevenueCents), subtext: 'All time', icon: Target, color: 'emerald', navigateTo: { view: 'reports-dashboard', params: { types: ['CAMPAIGN_CONTRIBUTION'] } } },
    { label: 'Event Revenue', value: loading ? '—' : formatCurrency(stats.totalEventRevenueCents), subtext: 'All time', icon: Calendar, color: 'sky', navigateTo: { view: 'reports-dashboard', params: { types: ['EVENT_REVENUE'] } } },
    { label: 'Current', value: loading ? '—' : stats.currentMembers, subtext: 'Current or credit', icon: UserCheck, color: 'emerald' },
    { label: 'Past Due', value: loading ? '—' : stats.pastDueMembers, subtext: '1 month behind', icon: AlertCircle, color: 'amber' },
    { label: 'Delinquent', value: loading ? '—' : stats.delinquentMembers, subtext: '2+ months behind', icon: AlertCircle, color: 'red' },
    { label: 'Dues Outstanding', value: loading ? '—' : formatCurrency(stats.totalDuesOutstandingCents), subtext: 'Total past due', icon: DollarSign, color: 'amber', navigateTo: { view: 'pending-payments' } },
    { label: 'Dues Collected (30d)', value: loading ? '—' : formatCurrency(stats.duesCollectedLast30DaysCents), subtext: 'Last 30 days', icon: DollarSign, color: 'emerald', navigateTo: { view: 'reports', params: { reportType: 'org_financial' } } },
    { label: 'Expenses (30d)', value: loading ? '—' : formatCurrency(stats.expenseLast30DaysCents), subtext: 'Last 30 days', icon: TrendingDown, color: 'amber', navigateTo: { view: 'expenditures' } },
    { label: 'Ledger Total', value: loading ? '—' : formatCurrency(stats.totalTransactionsCents), subtext: 'All transactions', icon: DollarSign, color: 'sky', navigateTo: { view: 'finances' } },
    { label: 'Expenditures (Month)', value: loading ? '—' : formatCurrency(stats.totalExpendituresCurrentMonth), subtext: 'Current month', icon: Receipt, color: 'red', navigateTo: { view: 'expenditures' } },
    { label: 'Expenditures (YTD)', value: loading ? '—' : formatCurrency(stats.totalExpendituresYTD), subtext: 'Year to date', icon: Receipt, color: 'red', navigateTo: { view: 'expenditures' } },
    { label: 'Member Payouts', value: loading ? '—' : formatCurrency(stats.totalMemberPayouts), subtext: 'All time', icon: DollarSign, color: 'sky' },
    { label: 'Operational Expenses', value: loading ? '—' : formatCurrency(stats.totalOperationalExpenses), subtext: 'All time', icon: Receipt, color: 'amber', navigateTo: { view: 'expenditures' } },
    { label: 'Upcoming Events', value: loading ? '—' : stats.upcomingEventsCount, subtext: 'Next 30 days', icon: Calendar, color: 'sky', navigateTo: { view: 'events' } },
  ];

  const colorMap = {
    emerald: { bg: 'bg-emerald-500/10', iconBg: 'bg-emerald-500/20', text: 'text-emerald-700', border: 'border-emerald-200' },
    amber: { bg: 'bg-amber-500/10', iconBg: 'bg-amber-500/20', text: 'text-amber-700', border: 'border-amber-200' },
    red: { bg: 'bg-red-500/10', iconBg: 'bg-red-500/20', text: 'text-red-700', border: 'border-red-200' },
    sky: { bg: 'bg-sky-500/10', iconBg: 'bg-sky-500/20', text: 'text-sky-700', border: 'border-sky-200' },
  };

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-6">
        {logoUrl && (
          <img src={logoUrl} alt="" className="h-12 w-12 rounded object-contain bg-slate-100 border border-slate-200" />
        )}
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Dashboard</h2>
          <p className="text-slate-600">Welcome to Civicflow. Overview metrics below.</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map(({ label, value, subtext, icon: Icon, color, navigateTo }) => {
          const c = colorMap[color] || colorMap.emerald;
          const clickable = !!(navigateTo && onNavigate);
          const handleClick = () => {
            if (!clickable) return;
            if (typeof navigateTo === 'string') {
              onNavigate(navigateTo);
              return;
            }
            onNavigate(navigateTo.view, navigateTo.params || {});
          };
          return (
            <div
              key={label}
              className={`relative rounded-xl border-2 ${c.border} ${c.bg} p-6 shadow-sm transition-all ${
                clickable ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-emerald-400' : ''
              }`}
              onClick={handleClick}
              onKeyDown={(e) => {
                if (!clickable) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleClick();
                }
              }}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">{label}</h3>
                  <p className="text-3xl font-bold text-slate-800 mt-2">{value}</p>
                  <p className="text-sm text-slate-500 mt-1">{subtext}</p>
                </div>
                <div className={`rounded-xl p-3 ${c.iconBg}`}>
                  <Icon className={`h-8 w-8 ${c.text}`} strokeWidth={2} />
                </div>
              </div>
              {clickable && (
                <ChevronRight className="absolute right-4 bottom-4 h-4 w-4 text-slate-400" />
              )}
            </div>
          );
        })}
      </div>

      {/* Membership Governance Tiles */}
      <div className="mt-8 rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-blue-600" />
          Membership Governance
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
            <p className="text-3xl font-bold text-emerald-700">{loading ? '—' : membershipCounts.active}</p>
            <p className="text-sm font-medium text-emerald-600 mt-1">Active</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
            <p className="text-3xl font-bold text-amber-700">{loading ? '—' : membershipCounts.inactive}</p>
            <p className="text-sm font-medium text-amber-600 mt-1">Inactive</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-3xl font-bold text-red-700">{loading ? '—' : membershipCounts.terminated}</p>
            <p className="text-sm font-medium text-red-600 mt-1">Terminated</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center">
            <p className="text-3xl font-bold text-blue-700">{loading ? '—' : membershipCounts.reinstated}</p>
            <p className="text-sm font-medium text-blue-600 mt-1">Reinstated</p>
          </div>
        </div>
      </div>

      {stats.campaignProgress?.length > 0 && (
        <div className="mt-8 rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-emerald-600" />
            Campaign Progress
          </h3>
          <div className="space-y-4">
            {stats.campaignProgress.map((c) => {
              const pct = c.goal_amount_cents > 0 ? Math.min(100, (c.raised_cents / c.goal_amount_cents) * 100) : 0;
              return (
                <div key={c.id} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-slate-700">{c.name}</span>
                    <span className="text-slate-600">
                      {formatCurrency(c.raised_cents)} / {c.goal_amount_cents > 0 ? formatCurrency(c.goal_amount_cents) : 'No goal'} ({c.goal_amount_cents > 0 ? `${Math.round(pct)}%` : '—'})
                    </span>
                  </div>
                  {c.goal_amount_cents > 0 && (
                    <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stats.paymentMethodBreakdown?.length > 0 && (
        <div className="mt-8 rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-slate-600" />
            Payment Method Breakdown
          </h3>
          <div className="divide-y divide-slate-200">
            {stats.paymentMethodBreakdown.map((row) => (
              <div key={row.payment_method} className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-slate-700">{formatMethodLabel(row.payment_method)}</span>
                <span className="text-sm font-semibold text-slate-800">{formatCurrency(row.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Members */}
          <button
            onClick={() => onNavigate('members')}
            className="flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 bg-white hover:border-emerald-300 hover:shadow-md transition-all text-left group"
          >
            <div className="rounded-xl p-3 bg-emerald-500/10">
              <Users className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800">Members</p>
              <p className="text-sm text-slate-500 truncate">Manage membership</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
          </button>

          {/* Campaigns */}
          <button
            onClick={() => onNavigate('campaigns')}
            className="flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 bg-white hover:border-emerald-300 hover:shadow-md transition-all text-left group"
          >
            <div className="rounded-xl p-3 bg-emerald-500/10">
              <Target className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800">Campaigns</p>
              <p className="text-sm text-slate-500 truncate">Track fundraising</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
          </button>

          {/* Events */}
          <button
            onClick={() => onNavigate('events')}
            className="flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 bg-white hover:border-emerald-300 hover:shadow-md transition-all text-left group"
          >
            <div className="rounded-xl p-3 bg-sky-500/10">
              <Calendar className="h-6 w-6 text-sky-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800">Events</p>
              <p className="text-sm text-slate-500 truncate">Schedule & manage</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-sky-600 transition-colors" />
          </button>

          {/* Communications */}
          <button
            onClick={() => onNavigate('communications')}
            className="flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 bg-white hover:border-sky-300 hover:shadow-md transition-all text-left group"
          >
            <div className="rounded-xl p-3 bg-sky-500/10">
              <Mail className="h-6 w-6 text-sky-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800">Communications</p>
              <p className="text-sm text-slate-500 truncate">Mass email & notices</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-sky-600 transition-colors" />
          </button>

          {/* Financial Reports */}
          <button
            onClick={() => onNavigate('reports')}
            className="flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 bg-white hover:border-emerald-300 hover:shadow-md transition-all text-left group"
          >
            <div className="rounded-xl p-3 bg-emerald-500/10">
              <FileText className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800">Reports</p>
              <p className="text-sm text-slate-500 truncate">Financial & membership</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
          </button>

          {/* Grants - Feature gated */}
          {grantsEnabled ? (
            <button
              onClick={() => onNavigate('grants')}
              className="flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 bg-white hover:border-amber-300 hover:shadow-md transition-all text-left group"
            >
              <div className="rounded-xl p-3 bg-amber-500/10">
                <Award className="h-6 w-6 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800">Grants</p>
                <p className="text-sm text-slate-500 truncate">Manage grant funding</p>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-amber-600 transition-colors" />
            </button>
          ) : (
            <button
              onClick={() => setShowUpgradeModal(true)}
              className="flex items-center gap-4 p-4 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:border-amber-300 hover:bg-amber-50/50 transition-all text-left group"
            >
              <div className="rounded-xl p-3 bg-slate-200 relative">
                <Award className="h-6 w-6 text-slate-400" />
                <div className="absolute -top-1 -right-1 h-4 w-4 bg-amber-500 rounded-full flex items-center justify-center">
                  <Lock className="h-2.5 w-2.5 text-white" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-600">Grants</p>
                <p className="text-sm text-amber-600 truncate">Upgrade to unlock</p>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-amber-600 transition-colors" />
            </button>
          )}
        </div>
      </div>

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowUpgradeModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="h-16 w-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Award className="h-8 w-8 text-amber-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">Grants Module</h2>
            <p className="text-slate-600 text-center mb-6">
              Track grants, funding requests, and reporting deadlines with the CivicFlow Grants upgrade.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-2 text-amber-700 mb-2">
                <Lock className="h-5 w-5" />
                <span className="font-medium">Upgrade Required</span>
              </div>
              <p className="text-sm text-amber-600">
                Grants are available in the CivicFlow Upgrade. Contact support to upgrade your license.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="flex-1 px-4 py-2 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowUpgradeModal(false);
                  onNavigate('settings');
                }}
                className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
              >
                Go to Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
