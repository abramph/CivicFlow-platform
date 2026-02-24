import { useState, useEffect } from 'react';
import { Calendar, Plus, Users, CheckCircle, XCircle, Save, ArrowLeft, X } from 'lucide-react';

const api = window.civicflow;

export function Meetings({ onNavigate }) {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ title: '', meeting_date: '' });
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [attendanceData, setAttendanceData] = useState([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [meetingSummary, setMeetingSummary] = useState(null);

  const loadMeetings = () => {
    setLoading(true);
    setError(null);
    api?.meetings?.list()
      .then((data) => {
        setMeetings(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load meetings');
        setMeetings([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadMeetings();
  }, []);

  const formatDate = (d) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return d;
    }
  };

  const getMemberId = (member) => Number(member?.id ?? member?.member_id ?? 0);

  const buildSummaryFromAttendance = (meeting, rows) => {
    if (!meeting) return null;
    const total = Array.isArray(rows) ? rows.length : 0;
    const attended = (Array.isArray(rows) ? rows : []).filter(
      (m) => m?.attended === 1 || m?.attended === true
    ).length;
    return {
      ...meeting,
      total_members: total,
      attended_count: attended,
      attendance_percentage: total ? Math.round((attended / total) * 100) : 0,
    };
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      title: formData.title.trim(),
      meeting_date: formData.meeting_date || null,
    };
    api.meetings
      .create(payload)
      .then(() => {
        setShowForm(false);
        setFormData({ title: '', meeting_date: '' });
        loadMeetings();
      })
      .catch((err) => setError(err?.message ?? 'Failed to create meeting'));
  };

  const handleSelectMeeting = (meeting) => {
    setSelectedMeeting(meeting);
    setLoadingAttendance(true);
    Promise.all([
      api?.meetings?.getSummary?.(meeting.id),
      api?.attendance?.getAllMembersForMeeting?.(meeting.id),
    ])
      .then(([summary, members]) => {
        setMeetingSummary(summary);
        setAttendanceData(Array.isArray(members) ? members : []);
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load attendance data');
      })
      .finally(() => setLoadingAttendance(false));
  };

  const handleToggleAttendance = (memberId, currentAttended) => {
    setAttendanceData((prev) => {
      const next = prev.map((m) =>
        getMemberId(m) === memberId
          ? { ...m, attended: !currentAttended }
          : m
      );
      setMeetingSummary((current) => buildSummaryFromAttendance(current || selectedMeeting, next));
      return next;
    });
  };

  const handleSaveAttendance = async () => {
    if (!selectedMeeting) return;
    setSavingAttendance(true);
    setError(null);
    try {
      const updates = attendanceData.map((member) => ({
        memberId: getMemberId(member),
        attended: member.attended,
      }));
      for (const update of updates) {
        if (!update.memberId) continue;
        await api.attendance.set(selectedMeeting.id, update.memberId, update.attended);
      }
      // Reload summary
      const summary = await api?.meetings?.getSummary?.(selectedMeeting.id);
      setMeetingSummary(summary || buildSummaryFromAttendance(selectedMeeting, attendanceData));
    } catch (err) {
      setError(err?.message ?? 'Failed to save attendance');
    } finally {
      setSavingAttendance(false);
    }
  };

  if (selectedMeeting) {
    return (
      <div className="p-8">
        <button
          onClick={() => setSelectedMeeting(null)}
          className="mb-6 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-slate-600 hover:bg-slate-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Meetings
        </button>

        {error && (
          <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            {error}
          </div>
        )}

        <div className="mb-8">
          <h2 className="text-2xl font-bold text-slate-800">{selectedMeeting.title}</h2>
          <p className="text-slate-600 mt-1">{formatDate(selectedMeeting.meeting_date)}</p>
        </div>

        {meetingSummary && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-800">Meeting Summary</h3>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-6">
              <div>
                <p className="text-sm text-slate-500">Total Members</p>
                <p className="text-2xl font-bold text-slate-800">{meetingSummary.total_members ?? 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Attended</p>
                <p className="text-2xl font-bold text-emerald-700">{meetingSummary.attended_count ?? 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Did Not Attend</p>
                <p className="text-2xl font-bold text-slate-600">
                  {(meetingSummary.total_members ?? 0) - (meetingSummary.attended_count ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Attendance Rate</p>
                <p className="text-2xl font-bold text-slate-800">{meetingSummary.attendance_percentage ?? 0}%</p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-800">Record Attendance</h3>
            <button
              onClick={handleSaveAttendance}
              disabled={savingAttendance}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {savingAttendance ? 'Saving…' : 'Save Attendance'}
            </button>
          </div>
          <div className="p-6">
            {loadingAttendance ? (
              <div className="text-slate-500 py-12 text-center">Loading members…</div>
            ) : attendanceData.length === 0 ? (
              <div className="text-slate-500 py-12 text-center">No active members found.</div>
            ) : (
              <div className="space-y-2">
                {attendanceData.map((member) => (
                  <div
                    key={getMemberId(member)}
                    className="flex items-center justify-between py-3 px-4 border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    <div>
                      <span className="font-medium text-slate-800">
                        {member.first_name} {member.last_name}
                      </span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={member.attended === 1 || member.attended === true}
                        onChange={() => handleToggleAttendance(getMemberId(member), member.attended === 1 || member.attended === true)}
                        className="w-5 h-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-sm text-slate-600">
                        {member.attended === 1 || member.attended === true ? 'Attended' : 'Not Attended'}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Meetings</h2>
          <p className="text-slate-600 mt-1">Manage general meetings and track attendance.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700"
        >
          <Plus size={20} />
          Create Meeting
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-8 rounded-xl border border-slate-200 bg-slate-50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800">Create Meeting</h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="p-1 rounded hover:bg-slate-200 text-slate-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData((d) => ({ ...d, title: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                placeholder="Meeting title"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
              <input
                type="date"
                required
                value={formData.meeting_date}
                onChange={(e) => setFormData((d) => ({ ...d, meeting_date: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700">
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-slate-500 py-12 text-center">Loading meetings…</div>
      ) : meetings.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Calendar className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-500">No meetings yet.</p>
          <button type="button" onClick={() => setShowForm(true)} className="mt-4 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
            Create Meeting
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {meetings.map((meeting) => (
            <div
              key={meeting.id}
              role="button"
              tabIndex={0}
              onClick={() => handleSelectMeeting(meeting)}
              onKeyDown={(e) => e.key === 'Enter' && handleSelectMeeting(meeting)}
              className="rounded-xl border-2 border-slate-200 bg-white p-5 cursor-pointer hover:shadow-md transition-all hover:border-sky-300"
            >
              <div className="flex gap-4">
                <div className="shrink-0 w-14 h-14 rounded-lg bg-sky-100 flex items-center justify-center">
                  <Users className="h-7 w-7 text-sky-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-800">{meeting.title}</h3>
                  <p className="text-sm text-slate-600">{formatDate(meeting.meeting_date)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
