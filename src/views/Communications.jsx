import { useState, useEffect } from 'react';
import { Mail, Send, Users, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';

const api = window.civicflow;

export function Communications({ onNavigate }) {
  const [currentRole, setCurrentRole] = useState('Admin');
  const [templateType, setTemplateType] = useState('NOTICE');
  const [recipientGroup, setRecipientGroup] = useState('active');
  const [resolvedEmails, setResolvedEmails] = useState([]);
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState(null);
  const [outbox, setOutbox] = useState([]);
  const [loadingOutbox, setLoadingOutbox] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    api?.roles?.getCurrent?.().then((r) => {
      if (r?.role) setCurrentRole(r.role);
    }).catch(() => {});
    loadOutbox();
  }, []);

  useEffect(() => {
    api?.email?.resolveRecipients?.(recipientGroup).then((emails) => {
      setResolvedEmails(Array.isArray(emails) ? emails : []);
    }).catch(() => setResolvedEmails([]));
  }, [recipientGroup]);

  const loadOutbox = () => {
    setLoadingOutbox(true);
    api?.email?.outboxList?.({}).then((items) => {
      setOutbox(Array.isArray(items) ? items : []);
    }).catch(() => {}).finally(() => setLoadingOutbox(false));
  };

  const handleQueueAndSend = async () => {
    if (!subject.trim()) { setMessage({ type: 'error', text: 'Subject is required' }); return; }
    if (!bodyText.trim()) { setMessage({ type: 'error', text: 'Message body is required' }); return; }
    if (resolvedEmails.length === 0) { setMessage({ type: 'error', text: 'No recipients found for this group' }); return; }

    setSending(true);
    setMessage(null);
    try {
      // Queue
      const result = await api?.email?.queue?.({
        email_type: templateType,
        recipient_group: recipientGroup,
        to_emails: resolvedEmails.join(','),
        subject: subject.trim(),
        body_text: bodyText.trim(),
        body_html: '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">' +
          bodyText.trim().split('\n').map(line => `<p>${line}</p>`).join('') +
          '</div>',
      });
      if (result?.error) { setMessage({ type: 'error', text: result.error }); return; }

      // Process outbox
      const sendResult = await api?.email?.processOutbox?.();
      if (sendResult?.error) {
        setMessage({ type: 'error', text: sendResult.error });
      } else if (sendResult?.failed > 0 && sendResult?.sent === 0) {
        const detail = sendResult.errors?.length ? ': ' + sendResult.errors.map(e => e.error).join('; ') : '';
        setMessage({ type: 'error', text: 'All emails failed to send' + detail });
      } else {
        const failedNote = sendResult?.failed ? ' ' + sendResult.failed + ' failed.' : '';
        setMessage({ type: 'success', text: `Sent to ${sendResult?.sent ?? 0} recipient(s).${failedNote}` });
        setSubject('');
        setBodyText('');
      }
      loadOutbox();
    } catch (err) {
      setMessage({ type: 'error', text: err?.message ?? 'Failed to send' });
    } finally {
      setSending(false);
    }
  };

  const handleProcessOutbox = async () => {
    setProcessing(true);
    setMessage(null);
    try {
      const result = await api?.email?.processOutbox?.();
      if (result?.error) {
        setMessage({ type: 'error', text: result.error });
      } else if (result?.sent > 0 || result?.failed > 0) {
        const parts = [];
        if (result.sent > 0) parts.push(result.sent + ' sent');
        if (result.failed > 0) parts.push(result.failed + ' failed');
        const detail = result.errors?.length ? ' — ' + result.errors.map(e => e.error).join('; ') : '';
        setMessage({
          type: result.failed > 0 && result.sent === 0 ? 'error' : 'success',
          text: 'Processed ' + result.processed + ': ' + parts.join(', ') + '.' + detail,
        });
      } else {
        setMessage({ type: 'success', text: result?.message || 'No queued emails to process.' });
      }
      loadOutbox();
    } catch (err) {
      setMessage({ type: 'error', text: err?.message ?? 'Processing failed' });
    } finally {
      setProcessing(false);
    }
  };

  if (currentRole !== 'Admin') {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center max-w-lg mx-auto">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Admin Access Required</h2>
          <p className="text-slate-600">Communications features require Admin role. Contact your administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Communications</h1>
        <p className="text-slate-500 mt-1">Send mass notifications to members</p>
      </div>

      {/* Compose */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8 max-w-3xl">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Mail className="h-5 w-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-800">Compose Notification</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Template</label>
            <select value={templateType} onChange={(e) => setTemplateType(String(e.target.value || 'NOTICE'))} className="w-full max-w-xs px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500">
              <option value="NOTICE">General Notice</option>
              <option value="DUES_REMINDER">Dues Reminder</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">
              {templateType === 'DUES_REMINDER' ? 'Adds configured payment options, including ACH/card wording when Stripe is enabled.' : 'Sends your message as-is.'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target Group</label>
            <select value={recipientGroup} onChange={(e) => setRecipientGroup(e.target.value)} className="w-full max-w-xs px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500">
              <option value="active">Active Members</option>
              <option value="active_inactive">Active + Inactive Members</option>
              <option value="all">All Members</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">
              <Users className="h-3 w-3 inline mr-1" />
              {resolvedEmails.length} recipient(s) with email addresses
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Subject *</label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" placeholder="e.g., Monthly Update" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Message *</label>
            <textarea rows={6} value={bodyText} onChange={(e) => setBodyText(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" placeholder="Compose your message..." />
          </div>
          {message && (
            <div className={`rounded-lg px-4 py-3 text-sm ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              {message.text}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={handleQueueAndSend} disabled={sending || resolvedEmails.length === 0} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60">
              <Send className="h-4 w-4" />
              {sending ? 'Sending...' : 'Send Now'}
            </button>
          </div>
        </div>
      </div>

      {/* Outbox */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-3xl">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Email Outbox</h2>
          </div>
          <button onClick={handleProcessOutbox} disabled={processing} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-medium hover:bg-slate-200 disabled:opacity-60 text-sm">
            {processing ? 'Processing...' : 'Process Queue'}
          </button>
        </div>
        <div className="p-6">
          {loadingOutbox ? (
            <p className="text-slate-500 text-sm">Loading...</p>
          ) : outbox.length === 0 ? (
            <p className="text-slate-500 text-sm">No emails in outbox.</p>
          ) : (
            <div className="space-y-2">
              {outbox.slice(0, 20).map((email) => (
                <div key={email.id} className={`py-2 px-3 rounded-lg border text-sm ${email.status === 'FAILED' ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-100'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 truncate">{email.subject}</p>
                      <p className="text-xs text-slate-500 truncate">{email.to_emails}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      <span className="text-xs text-slate-400">{email.email_type}</span>
                      {email.status === 'SENT' && <CheckCircle className="h-4 w-4 text-emerald-500" />}
                      {email.status === 'FAILED' && <XCircle className="h-4 w-4 text-red-500" />}
                      {email.status === 'QUEUED' && <Clock className="h-4 w-4 text-amber-500" />}
                      <span className={`text-xs font-medium ${email.status === 'SENT' ? 'text-emerald-600' : email.status === 'FAILED' ? 'text-red-600' : 'text-amber-600'}`}>
                        {email.status}
                      </span>
                    </div>
                  </div>
                  {email.status === 'FAILED' && email.error && (
                    <p className="text-xs text-red-600 mt-1 truncate" title={email.error}>Error: {email.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
