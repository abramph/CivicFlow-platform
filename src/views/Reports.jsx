import { useState, useEffect } from 'react';
import { FileText, Download, Send } from 'lucide-react';
import EmailReportModal from '../components/EmailReportModal';

const api = window.civicflow;

const REPORT_GROUPS = [
  {
    label: 'Roster Reports',
    types: [
      { id: 'roster_active',   label: 'Active Roster' },
      { id: 'roster_inactive', label: 'Inactive Roster' },
      { id: 'roster_combined', label: 'Full Roster (Active + Inactive)' },
      { id: 'roster_by_city',  label: 'Roster by City',     requiresCity: true },
      { id: 'roster_by_zip',   label: 'Roster by ZIP Code', requiresZip: true },
    ],
  },
  {
    label: 'Dues Reports',
    types: [
      { id: 'dues_current',        label: 'Members Current on Dues' },
      { id: 'dues_paid_full_year', label: 'Members with Full Year Dues Paid', requiresYear: true },
    ],
  },
  {
    label: 'Contribution Reports',
    types: [
      { id: 'event_contributors_roster',    label: 'Event Contributors (Member List)',    requiresEvent: true },
      { id: 'campaign_contributors_roster', label: 'Campaign Contributors (Member List)', requiresCampaign: true },
      { id: 'event_contribution',           label: 'Event Financial Report',              requiresEvent: true },
      { id: 'campaign_contribution',        label: 'Campaign Financial Report',           requiresCampaign: true },
    ],
  },
  {
    label: 'Financial Reports',
    types: [
      { id: 'member_monthly',      label: 'Member Monthly Statement',         requiresMember: true, requiresMonth: true },
      { id: 'member_contribution', label: 'Member Contributions (Date Range)', requiresMember: true },
      { id: 'org_financial',       label: 'Organization Financial Report' },
    ],
  },
];

const ALL_REPORT_TYPES = REPORT_GROUPS.flatMap((g) => g.types);

function getMonthRange(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function Reports({ initialReportType, initialMemberId, initialCampaignId, initialEventId }) {
  const [reportType,      setReportType]      = useState('roster_active');
  const [startDate,       setStartDate]       = useState(getMonthRange().start);
  const [endDate,         setEndDate]         = useState(getMonthRange().end);
  const [selectedMember,  setSelectedMember]  = useState('');
  const [selectedEvent,   setSelectedEvent]   = useState('');
  const [selectedCampaign,setSelectedCampaign]= useState('');
  const [selectedCity,    setSelectedCity]    = useState('');
  const [selectedZip,     setSelectedZip]     = useState('');
  const [selectedYear,    setSelectedYear]    = useState(String(new Date().getFullYear()));
  const [selectedMonth,   setSelectedMonth]   = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const [members,   setMembers]   = useState([]);
  const [events,    setEvents]    = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [generating,  setGenerating]  = useState(false);
  const [error,       setError]       = useState(null);
  const [success,     setSuccess]     = useState(null);
  const [currentRole, setCurrentRole] = useState('Admin');
  const [emailReportModal, setEmailReportModal] = useState(null);
  const [orgName, setOrgName] = useState('Civicflow');
  const [orgId,   setOrgId]   = useState(1);
  const [bulkSending, setBulkSending] = useState(false);
  const [sortBy,    setSortBy]    = useState('None');
  const [cityFilter,  setCityFilter]  = useState('All');
  const [zipFilter,   setZipFilter]   = useState('All');

  const reportConfig = ALL_REPORT_TYPES.find((r) => r.id === reportType) || ALL_REPORT_TYPES[0];

  const uniqueCities = [...new Set((members ?? []).map((m) => (m.city || '').trim()).filter(Boolean))].sort();
  const uniqueZips   = [...new Set((members ?? []).map((m) => (m.zip  || '').trim()).filter(Boolean))].sort();

  // Member list filtered by city/zip when showing a member picker
  let filteredMembers = members;
  try {
    filteredMembers = (members ?? []).filter((m) => {
      if (cityFilter !== 'All' && (m.city || '').trim() !== cityFilter) return false;
      if (zipFilter  !== 'All' && (m.zip  || '').trim() !== zipFilter)  return false;
      return true;
    });
    if (sortBy === 'City') filteredMembers = [...filteredMembers].sort((a, b) => (a.city || '').localeCompare(b.city || ''));
    if (sortBy === 'ZIP')  filteredMembers = [...filteredMembers].sort((a, b) => (a.zip  || '').localeCompare(b.zip  || ''));
  } catch (_) { filteredMembers = members; }

  useEffect(() => {
    let cancelled = false;
    Promise.all([api?.members?.list?.(), api?.events?.list?.(), api?.campaigns?.list?.()]).then(([m, e, c]) => {
      if (!cancelled) {
        setMembers(Array.isArray(m) ? m : []);
        setEvents(Array.isArray(e) ? e : []);
        setCampaigns(Array.isArray(c) ? c : []);
      }
    }).catch(() => {});
    api?.roles?.getCurrent?.().then((r) => { if (r?.role) setCurrentRole(r.role); }).catch(() => {});
    api?.organization?.get?.().then((org) => {
      if (org?.name) setOrgName(org.name);
      if (org?.id)   setOrgId(org.id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (initialReportType) setReportType(initialReportType);
    if (initialMemberId  != null && initialMemberId  !== '') setSelectedMember(String(initialMemberId));
    if (initialCampaignId != null && initialCampaignId !== '') setSelectedCampaign(String(initialCampaignId));
    if (initialEventId   != null && initialEventId   !== '') setSelectedEvent(String(initialEventId));
  }, [initialReportType, initialMemberId, initialCampaignId, initialEventId]);

  const downloadCsv = (csv, filename) => {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handleGeneratePdf = async () => {
    setGenerating(true); setError(null); setSuccess(null);
    try {
      let result;
      switch (reportType) {
        case 'roster_active':   result = await api.reports.generateRosterActive(); break;
        case 'roster_inactive': result = await api.reports.generateRosterInactive(); break;
        case 'roster_combined': result = await api.reports.generateRosterCombined(); break;
        case 'roster_by_city':
          if (!selectedCity) { setError('Please select a city'); return; }
          result = await api.reports.generateRosterByCity({ city: selectedCity }); break;
        case 'roster_by_zip':
          if (!selectedZip) { setError('Please select a ZIP code'); return; }
          result = await api.reports.generateRosterByZip({ zip: selectedZip }); break;
        case 'dues_current':
          result = await api.reports.generateDuesCurrent(); break;
        case 'dues_paid_full_year':
          result = await api.reports.generateDuesPaidFullYear({ year: selectedYear }); break;
        case 'event_contributors_roster':
          if (!selectedEvent) { setError('Please select an event'); return; }
          result = await api.reports.generateEventContributorsRoster({ eventId: Number(selectedEvent) }); break;
        case 'campaign_contributors_roster':
          if (!selectedCampaign) { setError('Please select a campaign'); return; }
          result = await api.reports.generateCampaignContributorsRoster({ campaignId: Number(selectedCampaign) }); break;
        case 'member_monthly':
          if (!selectedMember) { setError('Please select a member'); return; }
          result = await api.reports.generateMemberMonthly({ memberId: Number(selectedMember), month: selectedMonth }); break;
        case 'member_contribution':
          if (!selectedMember) { setError('Please select a member'); return; }
          result = await api.reports.generateMemberContribution({ memberId: Number(selectedMember), startDate, endDate }); break;
        case 'event_contribution':
          if (!selectedEvent) { setError('Please select an event'); return; }
          result = await api.reports.generateEventContribution({ eventId: Number(selectedEvent), startDate, endDate }); break;
        case 'campaign_contribution':
          if (!selectedCampaign) { setError('Please select a campaign'); return; }
          result = await api.reports.generateCampaignContribution({ campaignId: Number(selectedCampaign), startDate, endDate }); break;
        case 'org_financial':
          result = await api.reports.generateOrgFinancial({ startDate, endDate }); break;
        default: setError('Unknown report type'); return;
      }
      if (result?.ok && result.path) setSuccess(`Report saved to ${result.path}`);
      else if (result?.canceled) { /* dismissed */ }
      else setError((result?.error || 'Failed to generate report') + (result?.stack ? `\n\n${result.stack}` : ''));
    } catch (err) {
      setError(err?.message || 'Failed to generate report');
    } finally { setGenerating(false); }
  };

  const handleExportCsv = async () => {
    setGenerating(true); setError(null); setSuccess(null);
    try {
      let result;
      switch (reportType) {
        case 'roster_active':   result = await api.reports.exportRosterActiveCsv(); break;
        case 'roster_inactive': result = await api.reports.exportRosterInactiveCsv(); break;
        case 'roster_combined': result = await api.reports.exportRosterCombinedCsv(); break;
        case 'roster_by_city':
          if (!selectedCity) { setError('Please select a city'); return; }
          result = await api.reports.exportRosterByCityCsv({ city: selectedCity }); break;
        case 'roster_by_zip':
          if (!selectedZip) { setError('Please select a ZIP code'); return; }
          result = await api.reports.exportRosterByZipCsv({ zip: selectedZip }); break;
        case 'dues_current':
          result = await api.reports.exportDuesCurrentCsv(); break;
        case 'dues_paid_full_year':
          result = await api.reports.exportDuesPaidFullYearCsv({ year: selectedYear }); break;
        case 'event_contributors_roster':
          if (!selectedEvent) { setError('Please select an event'); return; }
          result = await api.reports.exportEventContributorsRosterCsv({ eventId: Number(selectedEvent) }); break;
        case 'campaign_contributors_roster':
          if (!selectedCampaign) { setError('Please select a campaign'); return; }
          result = await api.reports.exportCampaignContributorsRosterCsv({ campaignId: Number(selectedCampaign) }); break;
        case 'member_monthly':
          if (!selectedMember) { setError('Please select a member'); return; }
          result = await api.reports.exportMemberMonthlyCsv({ memberId: Number(selectedMember), month: selectedMonth }); break;
        case 'member_contribution':
          if (!selectedMember) { setError('Please select a member'); return; }
          result = await api.reports.exportMemberContributionCsv({ memberId: Number(selectedMember), startDate, endDate }); break;
        case 'event_contribution':
          if (!selectedEvent) { setError('Please select an event'); return; }
          result = await api.reports.exportEventContributionCsv({ eventId: Number(selectedEvent), startDate, endDate }); break;
        case 'campaign_contribution':
          if (!selectedCampaign) { setError('Please select a campaign'); return; }
          result = await api.reports.exportCampaignContributionCsv({ campaignId: Number(selectedCampaign), startDate, endDate }); break;
        case 'org_financial':
          result = await api.reports.exportOrgFinancialCsv({ startDate, endDate }); break;
        default: setError('Unknown report type'); return;
      }
      if (result?.success && result.csv) {
        downloadCsv(result.csv, result.filename || 'report.csv');
        setSuccess('CSV exported successfully.');
      } else {
        setError(result?.error || 'Failed to export CSV');
      }
    } catch (err) {
      setError(err?.message || 'Failed to export CSV');
    } finally { setGenerating(false); }
  };

  const needsDateRange   = !reportConfig.requiresMonth && !['roster_active','roster_inactive','roster_combined','roster_by_city','roster_by_zip','dues_current','dues_paid_full_year','event_contributors_roster','campaign_contributors_roster'].includes(reportType);
  const isRosterVariant  = ['roster_active','roster_inactive','roster_combined','roster_by_city','roster_by_zip'].includes(reportType);

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Reports Hub</h2>
      <p className="text-slate-600 mb-6">Generate and export reports for your organization.</p>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 whitespace-pre-wrap">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
          {success}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-4xl">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <FileText className="h-5 w-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">Report Configuration</h3>
        </div>

        <div className="p-6 space-y-6">

          {/* ── Report type ── */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Report Type</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            >
              {REPORT_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.types.map((rt) => (
                    <option key={rt.id} value={rt.id}>{rt.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* ── City picker ── */}
          {reportConfig.requiresCity && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">— Select City —</option>
                {uniqueCities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {/* ── ZIP picker ── */}
          {reportConfig.requiresZip && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">ZIP Code</label>
              <select
                value={selectedZip}
                onChange={(e) => setSelectedZip(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">— Select ZIP Code —</option>
                {uniqueZips.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
          )}

          {/* ── Year picker ── */}
          {reportConfig.requiresYear && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Year</label>
              <input
                type="number"
                min="2000"
                max="2100"
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="w-40 px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}

          {/* ── Member picker (with city/zip/sort filters) ── */}
          {reportConfig.requiresMember && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Filter by City</label>
                  <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500">
                    <option value="All">All</option>
                    {uniqueCities.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Filter by ZIP</label>
                  <select value={zipFilter} onChange={(e) => setZipFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500">
                    <option value="All">All</option>
                    {uniqueZips.map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sort list by</label>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500">
                    <option value="None">Name</option>
                    <option value="City">City</option>
                    <option value="ZIP">ZIP Code</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Member</label>
                <select value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500">
                  <option value="">— Select Member —</option>
                  {filteredMembers.map((m) => (
                    <option key={m.id} value={m.id}>{m.last_name}, {m.first_name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ── Event picker ── */}
          {reportConfig.requiresEvent && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Event</label>
              <select value={selectedEvent} onChange={(e) => setSelectedEvent(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500">
                <option value="">— Select Event —</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.name}{ev.date ? ` (${ev.date})` : ''}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── Campaign picker ── */}
          {reportConfig.requiresCampaign && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Campaign</label>
              <select value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500">
                <option value="">— Select Campaign —</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {/* ── Month picker ── */}
          {reportConfig.requiresMonth && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Month / Year</label>
              <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" />
            </div>
          )}

          {/* ── Date range ── */}
          {needsDateRange && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" />
              </div>
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-200">
            <button type="button" onClick={handleGeneratePdf} disabled={generating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60">
              <Download className="h-4 w-4" />
              {generating ? 'Generating…' : 'Download PDF'}
            </button>
            <button type="button" onClick={handleExportCsv} disabled={generating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <Download className="h-4 w-4" />
              Export CSV
            </button>

            {currentRole === 'Admin' && (
              <button
                type="button"
                disabled={generating}
                onClick={() => {
                  if (reportConfig.requiresMember   && !selectedMember)   { setError('Please select a member');   return; }
                  if (reportConfig.requiresEvent    && !selectedEvent)     { setError('Please select an event');   return; }
                  if (reportConfig.requiresCampaign && !selectedCampaign) { setError('Please select a campaign'); return; }
                  if (reportConfig.requiresCity     && !selectedCity)      { setError('Please select a city');     return; }
                  if (reportConfig.requiresZip      && !selectedZip)       { setError('Please select a ZIP code'); return; }

                  let params = {};
                  let emailSubject = `${orgName} – ${reportConfig.label}`;
                  let emailBody    = `Attached is the ${reportConfig.label} from ${orgName}.`;
                  let memberEmail  = '';
                  let auditEntityType = 'report';
                  let auditEntityId   = null;
                  let auditAction     = 'EMAIL_FINANCIAL_REPORT_SENT';

                  if (reportType === 'member_monthly') {
                    params = { memberId: Number(selectedMember), month: selectedMonth };
                    const mem = members.find((m) => String(m.id) === selectedMember);
                    memberEmail = mem?.email || '';
                    emailSubject = `${orgName} – Your Monthly Statement (${selectedMonth})`;
                    emailBody    = `Dear ${mem ? `${mem.first_name} ${mem.last_name}`.trim() : 'Member'},\n\nAttached is your monthly statement for ${selectedMonth}.`;
                    auditAction  = 'EMAIL_MEMBER_REPORT_SENT'; auditEntityType = 'member'; auditEntityId = Number(selectedMember);
                  } else if (reportType === 'member_contribution') {
                    params = { memberId: Number(selectedMember), startDate, endDate };
                    const mem = members.find((m) => String(m.id) === selectedMember);
                    memberEmail = mem?.email || '';
                    emailSubject = `${orgName} – Your Contribution Report (${startDate} to ${endDate})`;
                    emailBody    = `Dear ${mem ? `${mem.first_name} ${mem.last_name}`.trim() : 'Member'},\n\nAttached is your contribution report.`;
                    auditAction  = 'EMAIL_MEMBER_REPORT_SENT'; auditEntityType = 'member'; auditEntityId = Number(selectedMember);
                  } else if (reportType === 'org_financial') {
                    params = { startDate, endDate };
                  } else if (reportType === 'event_contribution' || reportType === 'event_contributors_roster') {
                    params = { eventId: Number(selectedEvent), startDate, endDate };
                    const ev = events.find((e) => String(e.id) === selectedEvent);
                    emailSubject = `${orgName} – Event Report: ${ev?.name || 'Event'}`;
                    emailBody    = `Attached is the event report for "${ev?.name || 'Event'}".`;
                  } else if (reportType === 'campaign_contribution' || reportType === 'campaign_contributors_roster') {
                    params = { campaignId: Number(selectedCampaign), startDate, endDate };
                    const camp = campaigns.find((c) => String(c.id) === selectedCampaign);
                    emailSubject = `${orgName} – Campaign Report: ${camp?.name || 'Campaign'}`;
                    emailBody    = `Attached is the campaign report for "${camp?.name || 'Campaign'}".`;
                  } else if (reportType === 'roster_by_city') {
                    params = { city: selectedCity };
                  } else if (reportType === 'roster_by_zip') {
                    params = { zip: selectedZip };
                  } else if (reportType === 'dues_paid_full_year') {
                    params = { year: selectedYear };
                  }

                  setError(null);
                  setEmailReportModal({
                    reportType, params,
                    subject: emailSubject, body: emailBody,
                    defaultTo: memberEmail,
                    attachmentName: reportConfig.label.replace(/\s+/g, '_') + '.pdf',
                    auditAction, auditEntityType, auditEntityId,
                  });
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                Email This Report
              </button>
            )}

            {currentRole === 'Admin' && (
              <button
                type="button"
                disabled={generating || bulkSending}
                onClick={async () => {
                  if (reportConfig.requiresMember) { setError('This report is member-specific — use "Email This Report" instead.'); return; }
                  let params = {};
                  if (reportType === 'org_financial') params = { startDate, endDate };
                  else if (reportType === 'event_contribution' || reportType === 'event_contributors_roster') { if (!selectedEvent) { setError('Please select an event'); return; } params = { eventId: Number(selectedEvent), startDate, endDate }; }
                  else if (reportType === 'campaign_contribution' || reportType === 'campaign_contributors_roster') { if (!selectedCampaign) { setError('Please select a campaign'); return; } params = { campaignId: Number(selectedCampaign), startDate, endDate }; }
                  else if (reportType === 'roster_by_city') { if (!selectedCity) { setError('Please select a city'); return; } params = { city: selectedCity }; }
                  else if (reportType === 'roster_by_zip')  { if (!selectedZip)  { setError('Please select a ZIP code'); return; } params = { zip: selectedZip }; }
                  else if (reportType === 'dues_paid_full_year') params = { year: selectedYear };

                  setBulkSending(true); setError(null); setSuccess(null);
                  try {
                    const res = await api?.email?.sendReportToAllMembers?.({
                      reportType, params, organizationId: orgId,
                      subject: `${orgName} – ${reportConfig.label}`,
                      bodyText: `Attached is the ${reportConfig.label} from ${orgName}.`,
                    });
                    if (res?.success) setSuccess(`Bulk report sent to ${res.sent} member(s).`);
                    else setError(res?.error || 'Failed to send bulk report.');
                  } catch (err) {
                    setError(err?.message || 'Failed to send bulk report.');
                  } finally { setBulkSending(false); }
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {bulkSending ? 'Sending…' : 'Send to All Members'}
              </button>
            )}
          </div>
        </div>
      </div>

      <EmailReportModal
        open={!!emailReportModal}
        onClose={() => setEmailReportModal(null)}
        reportType={emailReportModal?.reportType}
        reportParams={emailReportModal?.params}
        defaultTo={emailReportModal?.defaultTo || ''}
        defaultSubject={emailReportModal?.subject || ''}
        defaultBody={emailReportModal?.body || ''}
        attachmentName={emailReportModal?.attachmentName || 'Report.pdf'}
        memberStatus={null}
        auditAction={emailReportModal?.auditAction || 'EMAIL_FINANCIAL_REPORT_SENT'}
        auditEntityType={emailReportModal?.auditEntityType || 'report'}
        auditEntityId={emailReportModal?.auditEntityId || null}
        auditMetadata={{ reportType: emailReportModal?.reportType, dateRange: `${startDate} to ${endDate}` }}
      />
    </div>
  );
}
