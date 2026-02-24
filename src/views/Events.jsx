import { useState, useEffect } from 'react';
import { Calendar, Plus, MapPin } from 'lucide-react';

const api = window.civicflow;

export function Events({ onNavigate }) {
  const [events, setEvents] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', date: '', location: '', notes: '' });

  const loadEvents = () => {
    setLoading(true);
    setError(null);
    Promise.all([api?.events?.list(), api?.campaigns?.listActive()])
      .then(([eventsData, campaignsData]) => {
        setEvents(Array.isArray(eventsData) ? eventsData : []);
        setCampaigns(Array.isArray(campaignsData) ? campaignsData : []);
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load events');
        setEvents([]);
        setCampaigns([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEvents();
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

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      name: formData.name.trim(),
      date: formData.date || null,
      location: formData.location.trim() || null,
      notes: formData.notes.trim() || null,
    };
    api.events
      .create(payload)
      .then(() => {
        setShowForm(false);
        setFormData({ name: '', date: '', location: '', notes: '' });
        loadEvents();
      })
      .catch((err) => setError(err?.message ?? 'Failed to create event'));
  };

  const isPast = (dateStr) => {
    if (!dateStr) return false;
    try {
      return new Date(dateStr) < new Date();
    } catch {
      return false;
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Events</h2>
          <p className="text-slate-600 mt-1">Manage events.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700"
        >
          <Plus size={20} />
          Create Event
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-8 rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Create Event</h3>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                placeholder="Event name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
              <input
                type="date"
                required
                value={formData.date}
                onChange={(e) => setFormData((d) => ({ ...d, date: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData((d) => ({ ...d, location: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData((d) => ({ ...d, notes: e.target.value }))}
                rows={2}
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
        <div className="text-slate-500 py-12 text-center">Loading events…</div>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Calendar className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-500">No events yet.</p>
          <button type="button" onClick={() => setShowForm(true)} className="mt-4 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
            Create Event
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map((ev) => (
            <div
              key={ev.id}
              role="button"
              tabIndex={0}
              onClick={() => onNavigate?.('event-detail', { eventId: ev.id })}
              onKeyDown={(e) => e.key === 'Enter' && onNavigate?.('event-detail', { eventId: ev.id })}
              className={`rounded-xl border-2 p-5 cursor-pointer hover:shadow-md transition-all ${
                isPast(ev.date) ? 'border-slate-200 bg-slate-50 opacity-80' : 'border-slate-200 bg-white hover:border-sky-300'
              }`}
            >
              <div className="flex gap-4">
                <div className="shrink-0 w-14 h-14 rounded-lg bg-sky-100 flex items-center justify-center">
                  <Calendar className="h-7 w-7 text-sky-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">{ev.name}</h3>
                  <p className="text-sm text-slate-600">{formatDate(ev.date)}</p>
                  {ev.location && (
                    <p className="text-sm text-slate-500 mt-1 flex items-center gap-1">
                      <MapPin size={14} />
                      {ev.location}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate?.('reports', { reportType: 'event_contribution', eventId: ev.id });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50"
                >
                  View Report
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
