import { useState, useEffect } from 'react';
import { ArrowRight, ArrowLeft, Building2, Tag, Mail, Server, Check } from 'lucide-react';

const api = window.civicflow;

const STEPS = [
  { id: 1, title: 'Organization', icon: Building2 },
  { id: 2, title: 'Categories & Dues', icon: Tag },
  { id: 3, title: 'Email Identity', icon: Mail },
  { id: 4, title: 'SMTP (Optional)', icon: Server },
  { id: 5, title: 'Finish', icon: Check },
];

export function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({
    organization_name: '',
    logo_path: '',
    email_from_name: '',
    email_from_address: '',
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_pass: '',
    smtp_secure: false,
  });
  const [categories, setCategories] = useState([]);
  const [categoryForm, setCategoryForm] = useState({ name: '', monthly_dues_cents: 0 });
  const [logoUploading, setLogoUploading] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api?.organization?.getSettings?.(),
      api?.organization?.get?.(),
      api?.categories?.list?.(),
    ]).then(([s, org, cats]) => {
      if (cancelled) return;
      const merged = {
        organization_name: s?.organization_name ?? org?.name ?? 'Civicflow',
        logo_path: s?.logo_path ?? org?.logo_path ?? '',
        email_from_name: org?.email_display_name ?? s?.email_from_name ?? '',
        email_from_address: org?.email_from_address ?? s?.email_from_address ?? '',
        smtp_host: s?.smtp_host ?? '',
        smtp_port: s?.smtp_port ?? 587,
        smtp_user: s?.smtp_user ?? '',
        smtp_pass: s?.smtp_pass ?? '',
        smtp_secure: !!s?.smtp_secure,
      };
      setSettings(merged);
      setCategories(Array.isArray(cats) ? cats : []);
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleSaveStep = async () => {
    setMessage(null);
    try {
      await api.organization.updateSettings({
        organization_name: settings.organization_name.trim() || 'Civicflow',
        logo_path: settings.logo_path || null,
        email_from_name: settings.email_from_name.trim() || null,
        email_from_address: settings.email_from_address.trim() || null,
        smtp_host: settings.smtp_host.trim() || null,
        smtp_port: settings.smtp_port || 587,
        smtp_user: settings.smtp_user.trim() || null,
        smtp_pass: settings.smtp_pass || null,
        smtp_secure: settings.smtp_secure,
      });
      await api.organization.set({
        name: settings.organization_name.trim() || 'Civicflow',
        logo_path: settings.logo_path || null,
        email_display_name: settings.email_from_name.trim() || null,
        email_from_address: settings.email_from_address.trim() || null,
      });
      setMessage({ type: 'success', text: 'Saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Save failed.' });
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    setLogoUploading(true);
    setMessage(null);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = await api.organization.uploadLogo(reader.result);
          if (result?.success) {
            setSettings((s) => ({ ...s, logo_path: result.logoPath ?? '' }));
            setMessage({ type: 'success', text: 'Logo uploaded.' });
            // Dispatch custom event to notify Sidebar to refresh logo
            window.dispatchEvent(new CustomEvent('logo-updated', { detail: { logoPath: result.logoPath } }));
          } else {
            setMessage({ type: 'error', text: result?.error || 'Upload failed.' });
          }
        } finally {
          setLogoUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Upload failed.' });
      setLogoUploading(false);
    }
  };

  const handleCategoryAdd = async () => {
    setMessage(null);
    try {
      const cents = Math.round(Number(categoryForm.monthly_dues_cents)) || 0;
      await api.categories.create({ name: categoryForm.name.trim(), monthly_dues_cents: cents });
      setCategoryForm({ name: '', monthly_dues_cents: 0 });
      const list = await api.categories.list();
      setCategories(Array.isArray(list) ? list : []);
      setMessage({ type: 'success', text: 'Category added.' });
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to add category.' });
    }
  };

  const handleFinish = async () => {
    setMessage(null);
    try {
      await api.organization.updateSettings({
        organization_name: settings.organization_name.trim() || 'Civicflow',
        logo_path: settings.logo_path || null,
        email_from_name: settings.email_from_name.trim() || null,
        email_from_address: settings.email_from_address.trim() || null,
        smtp_host: settings.smtp_host.trim() || null,
        smtp_port: settings.smtp_port || 587,
        smtp_user: settings.smtp_user.trim() || null,
        smtp_pass: settings.smtp_pass || null,
        smtp_secure: settings.smtp_secure,
      });
      await api.organization.set({
        name: settings.organization_name.trim() || 'Civicflow',
        logo_path: settings.logo_path || null,
        email_display_name: settings.email_from_name.trim() || null,
        email_from_address: settings.email_from_address.trim() || null,
      });
      await api.branding.set({
        cboName: settings.organization_name.trim() || 'Civicflow',
        logoPath: settings.logo_path || null,
      });
      await api.organization.completeSetup();
      localStorage.setItem('civicflow_setup_complete', 'true');
      window.location.hash = '/dashboard';
      if (onComplete) onComplete();
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to complete setup.' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Welcome to Civicflow</h2>
      <p className="text-slate-600 mb-8">Complete these steps to configure your organization.</p>

      <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(s.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap ${
              step === s.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <s.icon size={18} />
            {s.title}
          </button>
        ))}
      </div>

      {message && (
        <div
          role="alert"
          className={`mb-6 rounded-lg px-4 py-3 ${
            message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-slate-800">Organization Info</h3>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Organization Name *</label>
            <input
              type="text"
              value={settings.organization_name}
              onChange={(e) => setSettings((s) => ({ ...s, organization_name: e.target.value }))}
              placeholder="Civicflow"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Logo (optional)</label>
            <input type="file" accept="image/png,image/jpeg,image/jpg" onChange={handleLogoUpload} disabled={logoUploading} className="block w-full text-sm text-slate-600" />
            {logoUploading && <p className="text-sm text-slate-500 mt-1">Uploading…</p>}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-slate-800">Membership Categories & Dues</h3>
          <p className="text-sm text-slate-600">Add at least one category. Set monthly dues in dollars (e.g. 25.00).</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={categoryForm.name}
              onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Category name"
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              value={categoryForm.monthly_dues_cents ? categoryForm.monthly_dues_cents / 100 : ''}
              onChange={(e) => setCategoryForm((f) => ({ ...f, monthly_dues_cents: Math.round(parseFloat(e.target.value || 0) * 100) }))}
              placeholder="Monthly dues ($)"
              className="w-32 px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
            <button type="button" onClick={handleCategoryAdd} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700">
              Add
            </button>
          </div>
          <ul className="list-disc list-inside text-slate-600">
            {categories.map((c) => (
              <li key={c.id}>{c.name} — ${((c.monthly_dues_cents ?? 0) / 100).toFixed(2)}/mo</li>
            ))}
          </ul>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-slate-800">Email Identity</h3>
          <p className="text-sm text-slate-600">Used as the sender for emails and receipts. Optional but recommended.</p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email Display Name</label>
            <input
              type="text"
              value={settings.email_from_name}
              onChange={(e) => setSettings((s) => ({ ...s, email_from_name: e.target.value }))}
              placeholder="Organization Name"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email From Address</label>
            <input
              type="email"
              value={settings.email_from_address}
              onChange={(e) => setSettings((s) => ({ ...s, email_from_address: e.target.value }))}
              placeholder="noreply@yourorg.org"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-slate-800">SMTP (Optional)</h3>
          <p className="text-sm text-slate-600">Configure SMTP to email receipts. Stored locally. Leave blank to skip.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Host</label>
              <input
                type="text"
                value={settings.smtp_host}
                onChange={(e) => setSettings((s) => ({ ...s, smtp_host: e.target.value }))}
                placeholder="smtp.example.com"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Port</label>
              <input
                type="number"
                value={settings.smtp_port}
                onChange={(e) => setSettings((s) => ({ ...s, smtp_port: Number(e.target.value) || 587 }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">User</label>
              <input
                type="text"
                value={settings.smtp_user}
                onChange={(e) => setSettings((s) => ({ ...s, smtp_user: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                value={settings.smtp_pass}
                onChange={(e) => setSettings((s) => ({ ...s, smtp_pass: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.smtp_secure} onChange={(e) => setSettings((s) => ({ ...s, smtp_secure: e.target.checked }))} />
            <span className="text-sm text-slate-700">Use TLS/SSL</span>
          </label>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-slate-800">You&apos;re all set</h3>
          <p className="text-slate-600">Click Finish to save your settings and go to the dashboard.</p>
        </div>
      )}

      <div className="flex justify-between mt-10 pt-6 border-t border-slate-200">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
        >
          <ArrowLeft size={18} />
          Back
        </button>
        {step < 5 ? (
          <button
            type="button"
            onClick={() => { handleSaveStep(); setStep((s) => Math.min(5, s + 1)); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700"
          >
            Next
            <ArrowRight size={18} />
          </button>
        ) : (
          <button type="button" onClick={handleFinish} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700">
            <Check size={18} />
            Finish
          </button>
        )}
      </div>
    </div>
  );
}
