import { useState, useEffect } from 'react';
import { FileText, Download, Calendar, Send } from 'lucide-react';
import EmailReportModal from '../components/EmailReportModal';

const api = window.civicflow;

const REPORT_TYPES = [
  { id: 'roster_active', label: 'Active Roster Report' },
  { id: 'roster_inactive', label: 'Inactive Roster Report' },
  { id: 'roster_combined', label: 'Active + Inactive Combined Roster' },
  { id: 'member_monthly', label: 'Member Monthly Statement', requiresMember: true, requiresMonth: true },
  { id: 'member_contribution', label: 'Member Contributions (Date Range)', requiresMember: true },
  { id: 'org_financial', label: 'Organization Financial Report' },
  { id: 'event_contribution', label: 'Event Financial Report', requiresEvent: true },
  { id: 'campaign_contribution', label: 'Campaign Financial Report', requiresCampaign: true },
];

function getMonthRange(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function Reports({ initialReportType, initialCampaignId, initialEventId }) {
  const [reportType, setReportType] = useState('member_monthly');
  const [startDate, setStartDate] = useState(getMonthRange().start);
  const [endDate, setEndDate] = useState(getMonthRange().end);
  const [selectedMember, setSelectedMember] = useState('');
  const [selectedEvent, setSelectedEvent] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [members, setMembers] = useState([]);
  const [events, setEvents] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [currentRole, setCurrentRole] = useState('Admin');
  const [emailReportModal, setEmailReportModal] = useState(null);
  const [orgName, setOrgName] = useState('Civicflow');
  const [orgId, setOrgId] = useState(1);
  const [bulkSending, setBulkSending] = useState(false);
  const [cityFilter, setCityFilter] = useState('All');
  const [zipFilter, setZipFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('All');
  const [sortBy, setSortBy] = useState('None');

  const reportConfig = REPORT_TYPES.find((r) => r.id === reportType) || REPORT_TYPES[0];

  // Get unique filter values from members
  const uniqueCities = [...new Set((members ?? []).map(m => (m.city || '').trim()).filter(Boolean))].sort();
  const uniqueZips = [...new Set((members ?? []).map(m => (m.zip || '').trim()).filter(Boolean))].sort();
  const uniqueLocations = [...new Set((members ?? []).map(m => {
    const parts = [(m.city || '').trim(), (m.state || '').trim(), (m.zip || '').trim()].filter(Boolean);
    return parts.join(', ');
  }).filter(Boolean))].sort();

  // Filter and sort members
  let filteredAndSortedMembers = members;
  try {
    // Apply filters
    const filtered = (members ?? []).filter(m => {
      if (cityFilter !== 'All' && (m.city || '').trim() !== cityFilter) return false;
      if (zipFilter !== 'All' && (m.zip || '').trim() !== zipFilter) return false;
      if (locationFilter !== 'All') {
        const memberLocation = [(m.city || '').trim(), (m.state || '').trim(), (m.zip || '').trim()].filter(Boolean).join(', ');
        if (memberLocation !== locationFilter) return false;
      }
      return true;
    });

    // Apply sorting
    if (sortBy === 'None') {
      filteredAndSortedMembers = filtered;
    } else {
      const sortKey = sortBy === 'City' ? 'city' : sortBy === 'ZIP Code' ? 'zip' : 'location';
      filteredAndSortedMembers = [...filtered].sort((a, b) => {
        let valA, valB;
        if (sortKey === 'location') {
          valA = [(a.city || '').trim(), (a.state || '').trim(), (a.zip || '').trim()].filter(Boolean).join(', ').toLowerCase();
          valB = [(b.city || '').trim(), (b.state || '').trim(), (b.zip || '').trim()].filter(Boolean).join(', ').toLowerCase();
        } else {
          valA = ((a[sortKey] || '').toString().toLowerCase());
          valB = ((b[sortKey] || '').toString().toLowerCase());
        }
        return valA.localeCompare(valB);
      });
    }
  } catch (err) {
    console.warn('Filter/sort error, using unfiltered list:', err);
    filteredAndSortedMembers = members;
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api?.members?.list?.(),
      api?.events?.list?.(),
      api?.campaigns?.list?.(),
    ]).then(([m, e, c]) => {
      if (!cancelled) {
        setMembers(Array.isArray(m) ? m : []);
        setEvents(Array.isArray(e) ? e : []);
        setCampaigns(Array.isArray(c) ? c : []);
      }
    }).catch(() => {});
    api?.roles?.getCurrent?.().then((r) => {
      if (r?.role) setCurrentRole(r.role);
    }).catch(() => {});
    api?.organization?.get?.().then((org) => {
      if (org?.name) setOrgName(org.name);
      if (org?.id) setOrgId(org.id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (initialReportType) setReportType(initialReportType);
    if (initialCampaignId !== undefined && initialCampaignId !== null && initialCampaignId !== '') {
      setSelectedCampaign(String(initialCampaignId));
    }
    if (initialEventId !== undefined && initialEventId !== null && initialEventId !== '') {
      setSelectedEvent(String(initialEventId));
    }
  }, [initialReportType, initialCampaignId, initialEventId]);

  const downloadCsv = (csv, filename) => {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGeneratePdf = async () => {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      let result;
      if (reportType === 'roster_active') {
        result = await api.reports.generateRosterActive();
      } else if (reportType === 'roster_inactive') {
        result = await api.reports.generateRosterInactive();
      } else if (reportType === 'roster_combined') {
        result = await api.reports.generateRosterCombined();
      } else if (reportType === 'member_monthly') {
        if (!selectedMember) {
          setError('Please select a member');
          return;
        }
        result = await api.reports.generateMemberMonthly({ memberId: Number(selectedMember), month: selectedMonth });
      } else if (reportType === 'member_contribution') {
        if (!selectedMember) {
          setError('Please select a member');
          return;
        }
        result = await api.reports.generateMemberContribution({ memberId: Number(selectedMember), startDate, endDate });
      } else if (reportType === 'event_contribution') {
        if (!selectedEvent) {
          setError('Please select an event');
          return;
        }
        result = await api.reports.generateEventContribution({ eventId: Number(selectedEvent), startDate, endDate });
      } else if (reportType === 'campaign_contribution') {
        if (!selectedCampaign) {
          setError('Please select a campaign');
          return;
        }
        result = await api.reports.generateCampaignContribution({ campaignId: Number(selectedCampaign), startDate, endDate });
      } else if (reportType === 'org_financial') {
        result = await api.reports.generateOrgFinancial({ startDate, endDate });
      }
      if (result?.ok && result.path) {
        setSuccess(`Report saved to ${result.path}`);
      } else if (result?.canceled) {
        setSuccess(null);
        setError(null);
      } else {
        const errMsg = result?.error || 'Failed to generate report';
        const stackMsg = result?.stack ? `\n\nDetails: ${result.stack}` : '';
        setError(errMsg + stackMsg);
      }
    } catch (err) {
      setError((err?.message || 'Failed to generate report') + (err?.stack ? `\n\nDetails: ${err.stack}` : ''));
    } finally {
      setGenerating(false);
    }
  };

  const handleExportCsv = async () => {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      let result;
      if (reportType === 'roster_active') {
        result = await api.reports.exportRosterActiveCsv();
      } else if (reportType === 'roster_inactive') {
        result = await api.reports.exportRosterInactiveCsv();
      } else if (reportType === 'roster_combined') {
        result = await api.reports.exportRosterCombinedCsv();
      } else if (reportType === 'member_monthly') {
        if (!selectedMember) {
          setError('Please select a member');
          return;
        }
        result = await api.reports.exportMemberMonthlyCsv({ memberId: Number(selectedMember), month: selectedMonth });
      } else if (reportType === 'member_contribution') {
        if (!selectedMember) {
          setError('Please select a member');
          return;
        }
        result = await api.reports.exportMemberContributionCsv({ memberId: Number(selectedMember), startDate, endDate });
      } else if (reportType === 'event_contribution') {
        if (!selectedEvent) {
          setError('Please select an event');
          return;
        }
        result = await api.reports.exportEventContributionCsv({ eventId: Number(selectedEvent), startDate, endDate });
      } else if (reportType === 'campaign_contribution') {
        if (!selectedCampaign) {
          setError('Please select a campaign');
          return;
        }
        result = await api.reports.exportCampaignContributionCsv({ campaignId: Number(selectedCampaign), startDate, endDate });
      } else if (reportType === 'org_financial') {
        result = await api.reports.exportOrgFinancialCsv({ startDate, endDate });
      }
      if (result?.success && result.csv) {
        downloadCsv(result.csv, result.filename || 'report.csv');
        setSuccess('Report CSV exported.');
      } else {
        setError(result?.error || 'Failed to export CSV');
      }
    } catch (err) {
      setError(err?.message || 'Failed to export CSV');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Reports Hub</h2>
      <p className="text-slate-600 mb-6">Generate and export reports for your organization.</p>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
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
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Report Type</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            >
              {REPORT_TYPES.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.label}
                </option>
              ))}
            </select>
          </div>

          {reportConfig.requiresMember && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
                  <select
                    value={cityFilter}
                    onChange={(e) => setCityFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="All">All</option>
                    {uniqueCities.map((city) => (
                      <option key={city} value={city}>
                        {city}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">ZIP Code</label>
                  <select
                    value={zipFilter}
                    onChange={(e) => setZipFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="All">All</option>
                    {uniqueZips.map((zip) => (
                      <option key={zip} value={zip}>
                        {zip}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
                  <select
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="All">All</option>
                    {uniqueLocations.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Sort by</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="None">None</option>
                  <option value="City">City</option>
                  <option value="ZIP Code">ZIP Code</option>
                  <option value="Location">Location</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Member</label>
                <select
                  value={selectedMember}
                  onChange={(e) => setSelectedMember(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">— Select Member —</option>
                  {filteredAndSortedMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.last_name}, {m.first_name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {reportConfig.requiresEvent && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Event</label>
              <select
                value={selectedEvent}
                onChange={(e) => setSelectedEvent(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">— Select Event —</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} ({ev.date})
                  </option>
                ))}
              </select>
            </div>
          )}

          {reportConfig.requiresCampaign && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Campaign</label>
              <select
                value={selectedCampaign}
                onChange={(e) => setSelectedCampaign(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">— Select Campaign —</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {reportConfig.requiresMonth && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Month/Year</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}

          {!reportConfig.requiresMonth && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={handleGeneratePdf}
              disabled={generating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {generating ? 'Generating…' : 'Download PDF'}
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={generating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
            {currentRole === 'Admin' && (
              <button
                type="button"
                onClick={() => {
                  // Validate required fields before opening modal
                  if (reportConfig.requiresMember && !selectedMember) { setError('Please select a member'); return; }
                  if (reportConfig.requiresEvent && !selectedEvent) { setError('Please select an event'); return; }
                  if (reportConfig.requiresCampaign && !selectedCampaign) { setError('Please select a campaign'); return; }

                  // Build params object matching the report type
                  let params = {};
                  let emailSubject = orgName + ' – ' + reportConfig.label;
                  let emailBody = 'Attached is the requested report from ' + orgName + '.';
                  let memberEmail = '';
                  let auditEntityType = 'report';
                  let auditEntityId = null;
                  let auditAction = 'EMAIL_FINANCIAL_REPORT_SENT';

                  if (reportType === 'member_monthly') {
                    params = { memberId: Number(selectedMember), month: selectedMonth };
                    const mem = members.find((m) => String(m.id) === String(selectedMember));
                    memberEmail = mem?.email || '';
                    emailSubject = orgName + ' – Your Monthly Statement (' + selectedMonth + ')';
                    emailBody = 'Dear ' + (mem ? (mem.first_name + ' ' + mem.last_name).trim() : 'Member') + ',\n\nAttached is your monthly statement for ' + selectedMonth + '.\nPlease contact us if you have any questions.';
                    auditAction = 'EMAIL_MEMBER_REPORT_SENT';
                    auditEntityType = 'member';
                    auditEntityId = Number(selectedMember);
                  } else if (reportType === 'member_contribution') {
                    params = { memberId: Number(selectedMember), startDate, endDate };
                    const mem = members.find((m) => String(m.id) === String(selectedMember));
                    memberEmail = mem?.email || '';
                    emailSubject = orgName + ' – Your Contribution Report (' + startDate + ' to ' + endDate + ')';
                    emailBody = 'Dear ' + (mem ? (mem.first_name + ' ' + mem.last_name).trim() : 'Member') + ',\n\nAttached is your contribution report for ' + startDate + ' to ' + endDate + '.\nPlease contact us if you have any questions.';
                    auditAction = 'EMAIL_MEMBER_REPORT_SENT';
                    auditEntityType = 'member';
                    auditEntityId = Number(selectedMember);
                  } else if (reportType === 'org_financial') {
                    params = { startDate, endDate };
                    emailSubject = orgName + ' – Organization Financial Report (' + startDate + ' to ' + endDate + ')';
                    emailBody = 'Attached is the organization financial report for ' + startDate + ' to ' + endDate + ' from ' + orgName + '.';
                  } else if (reportType === 'event_contribution') {
                    params = { eventId: Number(selectedEvent), startDate, endDate };
                    const ev = events.find((e) => String(e.id) === String(selectedEvent));
                    emailSubject = orgName + ' – Event Financial Report: ' + (ev?.name || 'Event');
                    emailBody = 'Attached is the event financial report for "' + (ev?.name || 'Event') + '" (' + startDate + ' to ' + endDate + ').';
                  } else if (reportType === 'campaign_contribution') {
                    params = { campaignId: Number(selectedCampaign), startDate, endDate };
                    const camp = campaigns.find((c) => String(c.id) === String(selectedCampaign));
                    emailSubject = orgName + ' – Campaign Financial Report: ' + (camp?.name || 'Campaign');
                    emailBody = 'Attached is the campaign financial report for "' + (camp?.name || 'Campaign') + '" (' + startDate + ' to ' + endDate + ').';
                  } else {
                    // roster reports
                    params = {};
                    emailSubject = orgName + ' – ' + reportConfig.label;
                    emailBody = 'Attached is the ' + reportConfig.label + ' from ' + orgName + '.';
                  }

                  setError(null);
                  setEmailReportModal({
                    reportType,
                    params,
                    subject: emailSubject,
                    body: emailBody,
                    defaultTo: memberEmail,
                    attachmentName: reportConfig.label.replace(/\s+/g, '_') + '.pdf',
                    auditAction,
                    auditEntityType,
                    auditEntityId,
                  });
                }}
                disabled={generating}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                Email This Report
              </button>
            )}
            {currentRole === 'Admin' && (
              <button
                type="button"
                onClick={async () => {
                  if (reportConfig.requiresMember) {
                    setError('This report is member-specific and cannot be sent to all members.');
                    return;
                  }
                  if (reportConfig.requiresEvent && !selectedEvent) { setError('Please select an event'); return; }
                  if (reportConfig.requiresCampaign && !selectedCampaign) { setError('Please select a campaign'); return; }

                  let params = {};
                  let emailSubject = orgName + ' – ' + reportConfig.label;
                  let emailBody = 'Attached is the ' + reportConfig.label + ' from ' + orgName + '.';

                  if (reportType === 'org_financial') {
                    params = { startDate, endDate };
                    emailSubject = orgName + ' – Organization Financial Report (' + startDate + ' to ' + endDate + ')';
                    emailBody = 'Attached is the organization financial report for ' + startDate + ' to ' + endDate + ' from ' + orgName + '.';
                  } else if (reportType === 'event_contribution') {
                    params = { eventId: Number(selectedEvent), startDate, endDate };
                    const ev = events.find((e) => String(e.id) === String(selectedEvent));
                    emailSubject = orgName + ' – Event Financial Report: ' + (ev?.name || 'Event');
                    emailBody = 'Attached is the event financial report for "' + (ev?.name || 'Event') + '" (' + startDate + ' to ' + endDate + ').';
                  } else if (reportType === 'campaign_contribution') {
                    params = { campaignId: Number(selectedCampaign), startDate, endDate };
                    const camp = campaigns.find((c) => String(c.id) === String(selectedCampaign));
                    emailSubject = orgName + ' – Campaign Financial Report: ' + (camp?.name || 'Campaign');
                    emailBody = 'Attached is the campaign financial report for "' + (camp?.name || 'Campaign') + '" (' + startDate + ' to ' + endDate + ').';
                  } else if (reportType === 'roster_active' || reportType === 'roster_inactive' || reportType === 'roster_combined') {
                    params = {};
                  }

                  setBulkSending(true);
                  setError(null);
                  setSuccess(null);
                  try {
                    const res = await api?.email?.sendReportToAllMembers?.({
                      reportType,
                      params,
                      organizationId: orgId,
                      subject: emailSubject,
                      bodyText: emailBody,
                    });
                    if (res?.success) {
                      setSuccess(`Bulk report sent to ${res.sent} member(s).`);
                    } else {
                      setError(res?.error || 'Failed to send bulk report.');
                    }
                  } catch (err) {
                    setError(err?.message || 'Failed to send bulk report.');
                  } finally {
                    setBulkSending(false);
                  }
                }}
                disabled={generating || bulkSending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {bulkSending ? 'Sending...' : 'Send Report to All Members'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Email Report Modal */}
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
        auditMetadata={{ reportType: emailReportModal?.reportType, dateRange: startDate + ' to ' + endDate }}
      />
    </div>
  );
}
