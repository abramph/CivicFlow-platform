import React, { useState, useEffect, useRef } from 'react';
import { X, Send, AlertTriangle, Paperclip, Loader2, CheckCircle, XCircle, Mail } from 'lucide-react';

const api = window.civicflow;

/**
 * Reusable EmailReportModal — used for emailing member reports, org reports,
 * invoices, receipts, and financial reports.
 *
 * Props:
 *   open          - boolean, show/hide modal
 *   onClose       - callback to close modal
 *   reportType    - string, e.g. 'member_monthly', 'org_financial', etc.
 *   reportParams  - object, params needed to generate the report buffer
 *   defaultTo     - string, pre-filled To address
 *   defaultSubject - string, pre-filled subject
 *   defaultBody   - string, pre-filled body text
 *   attachmentName - string, display name for the attachment
 *   memberStatus  - string | null, membership status for warnings
 *   auditAction   - string, audit log action name
 *   auditEntityType - string, audit log entity type
 *   auditEntityId - number | null, audit log entity id
 *   auditMetadata - object, additional audit metadata
 */
export default function EmailReportModal({
  open,
  onClose,
  reportType,
  reportParams,
  defaultTo = '',
  defaultSubject = '',
  defaultBody = '',
  attachmentName = 'Report.pdf',
  memberStatus = null,
  auditAction,
  auditEntityType,
  auditEntityId,
  auditMetadata,
}) {
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pdfBase64, setPdfBase64] = useState(null);
  const [pdfFilename, setPdfFilename] = useState(attachmentName);
  const [result, setResult] = useState(null); // { type: 'success' | 'error', text: string }
  const [emailEnabled, setEmailEnabled] = useState(null); // null = loading
  const [showStatusWarning, setShowStatusWarning] = useState(false);
  const toRef = useRef(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setTo(defaultTo);
      setCc('');
      setBcc('');
      setSubject(defaultSubject);
      setBody(defaultBody);
      setPdfBase64(null);
      setPdfFilename(attachmentName);
      setResult(null);
      setSending(false);
      setGenerating(false);
      setShowStatusWarning(false);

      // Check if email is enabled
      api?.email?.getSettings?.().then((s) => {
        setEmailEnabled(!!s?.enabled && !!s?.smtp_host);
      }).catch(() => setEmailEnabled(false));

      // Auto-generate the report buffer
      if (reportType && reportParams !== undefined) {
        setGenerating(true);
        api?.reports?.generateReportBuffer?.(reportType, reportParams).then((res) => {
          if (res?.ok) {
            setPdfBase64(res.pdfBase64);
            setPdfFilename(res.filename || attachmentName);
          } else {
            setResult({ type: 'error', text: res?.error || 'Failed to generate report PDF' });
          }
        }).catch((err) => {
          setResult({ type: 'error', text: err?.message || 'Failed to generate report' });
        }).finally(() => setGenerating(false));
      }

      // Focus the To field
      setTimeout(() => toRef.current?.focus(), 100);
    }
  }, [open, defaultTo, defaultSubject, defaultBody, reportType, JSON.stringify(reportParams), attachmentName]);

  if (!open) return null;

  const isTerminated = memberStatus === 'Terminated';
  const isInactive = memberStatus === 'Inactive';
  const needsWarning = isTerminated || isInactive;

  const canSend = to.trim() && subject.trim() && pdfBase64 && !sending && !generating && emailEnabled;

  const handleSend = async () => {
    // Show membership status warning first time
    if (needsWarning && !showStatusWarning) {
      setShowStatusWarning(true);
      return;
    }

    setSending(true);
    setResult(null);
    try {
      const res = await api?.email?.sendReport?.({
        reportType,
        pdfBase64,
        pdfFilename,
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim(),
        bodyText: body.trim(),
        bodyHtml: '<p>' + body.trim().replace(/\n/g, '<br>') + '</p>',
        auditAction,
        auditEntityType,
        auditEntityId,
        auditMetadata,
      });

      if (res?.success) {
        setResult({ type: 'success', text: 'Report emailed successfully.' });
        setTimeout(() => onClose(), 2000);
      } else {
        setResult({ type: 'error', text: res?.error || 'Failed to send email.' });
      }
    } catch (err) {
      setResult({ type: 'error', text: err?.message || 'Email send failed.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Mail size={20} className="text-blue-600" />
            <h3 className="text-lg font-semibold text-slate-800">Email Report</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Email not enabled warning */}
          {emailEnabled === false && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>Email is not configured. Go to <strong>Settings → Email Settings</strong> to configure SMTP before sending.</span>
            </div>
          )}

          {/* Membership status warning */}
          {showStatusWarning && isTerminated && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">This member is no longer active.</p>
                <p>Are you sure you want to send this report? Click "Send" again to confirm.</p>
              </div>
            </div>
          )}
          {showStatusWarning && isInactive && !isTerminated && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">This member is currently inactive.</p>
                <p>Click "Send" again to confirm sending.</p>
              </div>
            </div>
          )}

          {/* To */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">To <span className="text-red-500">*</span></label>
            <input
              ref={toRef}
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* CC / BCC */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">CC</label>
              <input
                type="text"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="cc@example.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">BCC</label>
              <input
                type="text"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                placeholder="bcc@example.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Subject <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
            />
          </div>

          {/* Attachment */}
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
            {generating ? (
              <>
                <Loader2 size={16} className="animate-spin text-blue-500" />
                <span>Generating report PDF...</span>
              </>
            ) : pdfBase64 ? (
              <>
                <Paperclip size={16} className="text-blue-500" />
                <span className="font-medium">{pdfFilename}</span>
                <span className="text-slate-400 ml-auto">{Math.round((pdfBase64.length * 3) / 4 / 1024)} KB</span>
              </>
            ) : (
              <>
                <XCircle size={16} className="text-red-400" />
                <span className="text-red-600">No attachment — report generation failed</span>
              </>
            )}
          </div>

          {/* Result message */}
          {result && (
            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${result.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
              {result.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
              <span>{result.text}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {needsWarning && !showStatusWarning ? 'Send...' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>
  );
}
