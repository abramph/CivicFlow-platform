import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Key, Database, Info, Tag, Pencil, Trash2, AlertTriangle, Mail, Shield, Send, Upload, DollarSign } from 'lucide-react';

const api = window.civicflow;

export function Settings({ onNavigate, onOpenActivation }) {
  const [cboName, setCboName] = useState('');
  const [logoPath, setLogoPath] = useState('');
  const [orgEmailDisplayName, setOrgEmailDisplayName] = useState('');
  const [orgEmailFromAddress, setOrgEmailFromAddress] = useState('');
  const [orgId, setOrgId] = useState(1);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [paymentsSaving, setPaymentsSaving] = useState(false);
  const [paymentsMessage, setPaymentsMessage] = useState(null);
  const [stripeAccountId, setStripeAccountId] = useState(null);
  const [stripeConnecting, setStripeConnecting] = useState(false);
  const [stripeMessage, setStripeMessage] = useState(null);
  const [cashappHandle, setCashappHandle] = useState('');
  const [zelleContact, setZelleContact] = useState('');
  const [venmoHandle, setVenmoHandle] = useState('');
  const [autoArchiveEnabled, setAutoArchiveEnabled] = useState(false);
  const [autoArchiveEventsDays, setAutoArchiveEventsDays] = useState(90);
  const [autoArchiveCampaignsDays, setAutoArchiveCampaignsDays] = useState(90);
  const [autoArchiveSaving, setAutoArchiveSaving] = useState(false);
  const [autoArchiveMessage, setAutoArchiveMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseEmail, setLicenseEmail] = useState('');
  const [licenseMessage, setLicenseMessage] = useState(null);
  const [licenseRefreshing, setLicenseRefreshing] = useState(false);
  const [backupMessage, setBackupMessage] = useState(null);
  const [restoreMessage, setRestoreMessage] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [categories, setCategories] = useState([]);
  const [categoryForm, setCategoryForm] = useState({ name: '', monthly_dues_cents: 0 });
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [categoryMessage, setCategoryMessage] = useState(null);

  const [logoUploading, setLogoUploading] = useState(false);
  const [logoMessage, setLogoMessage] = useState(null);

  // Email settings state
  const [emailSettings, setEmailSettings] = useState(null);
  const [emailForm, setEmailForm] = useState({ from_name: '', from_email: '', smtp_host: '', smtp_port: 587, smtp_secure: 0, smtp_user: '', smtp_password: '', enabled: 0 });
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState(null);
  const [testEmail, setTestEmail] = useState('');
  const [testingSend, setTestingSend] = useState(false);

  // Role state
  const [currentRole, setCurrentRole] = useState('Admin');

  // Delete Sample Data state
  const [sampleDataModalOpen, setSampleDataModalOpen] = useState(false);
  const [sampleDataConfirmText, setSampleDataConfirmText] = useState('');
  const [sampleDataDeleting, setSampleDataDeleting] = useState(false);
  const [sampleDataMessage, setSampleDataMessage] = useState(null);
  const [sampleDataCounts, setSampleDataCounts] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api?.organization?.get?.(),
      api?.branding?.get?.(),
    ]).then(([org, b]) => {
      if (cancelled) return;
      setCboName(org?.name ?? b?.cboName ?? 'Civicflow');
      setLogoPath(org?.logo_path ?? b?.logoPath ?? '');
      setOrgEmailDisplayName(org?.email_display_name ?? '');
      setOrgEmailFromAddress(org?.email_from_address ?? '');
      setOrgId(org?.id ?? 1);
      setPaymentsEnabled((org?.payments_enabled ?? 0) === 1);
      setStripeAccountId(org?.stripe_account_id ?? null);
      setCashappHandle(org?.cashapp_handle ?? '');
      setZelleContact(org?.zelle_contact ?? '');
      setVenmoHandle(org?.venmo_handle ?? '');
      setAutoArchiveEnabled((org?.auto_archive_enabled ?? 0) === 1);
      setAutoArchiveEventsDays(Math.max(0, Number(org?.auto_archive_events_days ?? 90) || 90));
      setAutoArchiveCampaignsDays(Math.max(0, Number(org?.auto_archive_campaigns_days ?? 90) || 90));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api?.categories?.list?.().then((list) => {
      if (!cancelled) setCategories(Array.isArray(list) ? list : []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api?.license?.getStatus?.().then((s) => {
      if (!cancelled) setLicenseStatus(s);
    });
    api?.email?.getSettings?.().then((s) => {
      if (!cancelled && s) {
        setEmailSettings(s);
        setEmailForm({
          from_name: s.from_name || '',
          from_email: s.from_email || '',
          smtp_host: s.smtp_host || '',
          smtp_port: s.smtp_port || 587,
          smtp_secure: s.smtp_secure || 0,
          smtp_user: s.smtp_user || '',
          smtp_password: '',
          enabled: s.enabled || 0,
        });
      }
    }).catch(() => {});
    api?.roles?.getCurrent?.().then((r) => {
      if (!cancelled && r?.role) setCurrentRole(r.role);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setEmailForm((f) => {
      const next = { ...f };
      if (!next.from_name && orgEmailDisplayName) next.from_name = orgEmailDisplayName;
      if (!next.from_email && orgEmailFromAddress) next.from_email = orgEmailFromAddress;
      return next;
    });
  }, [orgEmailDisplayName, orgEmailFromAddress]);

  const handleSaveBranding = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.organization.set({
        name: cboName.trim() || 'Civicflow',
        logo_path: logoPath.trim() || null,
        email_display_name: orgEmailDisplayName.trim() || null,
        email_from_address: orgEmailFromAddress.trim() || null,
        cashapp_handle: cashappHandle.trim() || null,
        zelle_contact: zelleContact.trim() || null,
        venmo_handle: venmoHandle.trim() || null,
      });
      await api.branding.set({ cboName: cboName.trim() || 'Civicflow', logoPath: logoPath.trim() || null });
      setSaved(true);
    } catch (_) {}
    finally {
      setSaving(false);
    }
  };

  const handleTogglePayments = async (nextEnabled) => {
    setPaymentsSaving(true);
    setPaymentsMessage(null);
    try {
      const result = await api.organization.set({
        name: cboName.trim() || 'Civicflow',
        logo_path: logoPath.trim() || null,
        email_display_name: orgEmailDisplayName.trim() || null,
        email_from_address: orgEmailFromAddress.trim() || null,
        payments_enabled: nextEnabled ? 1 : 0,
        cashapp_handle: cashappHandle.trim() || null,
        zelle_contact: zelleContact.trim() || null,
        venmo_handle: venmoHandle.trim() || null,
      });
      if (result) {
        setPaymentsEnabled(!!nextEnabled);
        setPaymentsMessage({ type: 'success', text: nextEnabled ? 'Online payments enabled.' : 'Online payments disabled.' });
      } else {
        setPaymentsMessage({ type: 'error', text: 'Failed to update payment settings.' });
      }
    } catch (err) {
      setPaymentsMessage({ type: 'error', text: err?.message || 'Failed to update payment settings.' });
    } finally {
      setPaymentsSaving(false);
    }
  };

  const handleConnectStripe = async () => {
    setStripeConnecting(true);
    setStripeMessage(null);
    try {
      const orgEmail = orgEmailFromAddress || emailForm.from_email || null;
      const result = await api?.payments?.connectStripe?.(orgId ?? 1, orgEmail);
      if (result?.error) {
        setStripeMessage({ type: 'error', text: result.error });
        return;
      }
      if (result?.url) {
        window.open(result.url, '_blank');
      }
      const org = await api?.organization?.get?.();
      setStripeAccountId(org?.stripe_account_id ?? null);
      setStripeMessage({ type: 'success', text: 'Stripe onboarding opened. Complete setup to enable payments.' });
    } catch (err) {
      setStripeMessage({ type: 'error', text: err?.message || 'Failed to connect Stripe.' });
    } finally {
      setStripeConnecting(false);
    }
  };

  const handleSaveAutoArchive = async () => {
    setAutoArchiveSaving(true);
    setAutoArchiveMessage(null);
    try {
      const result = await api?.organization?.set?.({
        name: cboName.trim() || 'Civicflow',
        logo_path: logoPath.trim() || null,
        email_display_name: orgEmailDisplayName.trim() || null,
        email_from_address: orgEmailFromAddress.trim() || null,
        auto_archive_enabled: autoArchiveEnabled ? 1 : 0,
        auto_archive_events_days: Math.max(0, Number(autoArchiveEventsDays) || 0),
        auto_archive_campaigns_days: Math.max(0, Number(autoArchiveCampaignsDays) || 0),
      });

      if (!result?.success) {
        setAutoArchiveMessage({ type: 'error', text: result?.error || 'Failed to save auto-archive settings.' });
        return;
      }

      setAutoArchiveMessage({ type: 'success', text: 'Auto-archive settings saved.' });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('civicflow:invalidate', { detail: ['events', 'campaigns', 'dashboard'] }));
      }
    } catch (err) {
      setAutoArchiveMessage({ type: 'error', text: err?.message || 'Failed to save auto-archive settings.' });
    } finally {
      setAutoArchiveSaving(false);
    }
  };

  const handleCategorySave = async () => {
    setCategoryMessage(null);
    try {
      const cents = Math.round(Number(categoryForm.monthly_dues_cents)) || 0;
      if (editingCategoryId) {
        await api.categories.update(editingCategoryId, {
          name: categoryForm.name.trim(),
          monthly_dues_cents: cents,
        });
        setCategoryMessage({ type: 'success', text: 'Category updated.' });
      } else {
        await api.categories.create({
          name: categoryForm.name.trim(),
          monthly_dues_cents: cents,
        });
        setCategoryMessage({ type: 'success', text: 'Category added.' });
      }
      setEditingCategoryId(null);
      setCategoryForm({ name: '', monthly_dues_cents: 0 });
      const list = await api.categories.list();
      setCategories(Array.isArray(list) ? list : []);
    } catch (err) {
      setCategoryMessage({ type: 'error', text: err?.message || 'Failed to save category.' });
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      setLogoMessage({ type: 'error', text: 'Please select a PNG or JPG image.' });
      return;
    }
    setLogoUploading(true);
    setLogoMessage(null);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = await api.organization.uploadLogo(reader.result);
          if (result?.success) {
            setLogoPath(result.logoPath ?? '');
            setLogoMessage({ type: 'success', text: 'Logo uploaded. Stored under assets/logo.png.' });
            // Dispatch custom event to notify Sidebar to refresh logo
            window.dispatchEvent(new CustomEvent('logo-updated', { detail: { logoPath: result.logoPath } }));
          } else {
            setLogoMessage({ type: 'error', text: result?.error || 'Upload failed.' });
          }
        } finally {
          setLogoUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setLogoMessage({ type: 'error', text: err?.message || 'Upload failed.' });
      setLogoUploading(false);
    }
  };

  const formatExpiry = (expiresAt) => {
    if (!expiresAt) return 'Perpetual';
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) return 'Unknown';
    return d.toISOString().slice(0, 10);
  };

  const handleActivateLicense = async () => {
    setLicenseMessage(null);
    try {
      const result = await api.license.activate({
        serial: licenseKey.trim(),
        email: licenseEmail.trim() || null,
      });
      if (result?.success) {
        setLicenseMessage({ type: 'success', text: 'License activated.' });
        setLicenseKey('');
        setLicenseEmail('');
        const status = await api.license.getStatus();
        setLicenseStatus(status);
      } else {
        setLicenseMessage({ type: 'error', text: result?.error || 'Activation failed.' });
      }
    } catch (err) {
      setLicenseMessage({ type: 'error', text: err?.message || 'Invalid key.' });
    }
  };

  const handleDeactivate = async () => {
    if (!confirm('Deactivate this device? You will need to activate again to create or edit data.')) return;
    setLicenseMessage(null);
    try {
      await api.license.deactivate();
      setLicenseMessage({ type: 'success', text: 'License deactivated.' });
      setLicenseStatus(await api.license.getStatus());
    } catch (err) {
      setLicenseMessage({ type: 'error', text: err?.message || 'Deactivation failed.' });
    }
  };

  const handleRefreshLicense = async () => {
    setLicenseRefreshing(true);
    setLicenseMessage(null);
    try {
      const result = await api.license.refresh();
      if (result?.success) {
        setLicenseMessage({ type: 'success', text: 'License check-in completed.' });
      } else {
        setLicenseMessage({ type: 'error', text: result?.error || 'License check-in failed.' });
      }
      setLicenseStatus(await api.license.getStatus());
    } catch (err) {
      setLicenseMessage({ type: 'error', text: err?.message || 'License check-in failed.' });
    } finally {
      setLicenseRefreshing(false);
    }
  };

  const handleBackup = async () => {
    setBackupMessage(null);
    try {
      const result = await api.backup.db();
      if (result?.canceled) return;
      if (result?.success) {
        setBackupMessage({ type: 'success', text: result?.path ? `Database backed up successfully to ${result.path}.` : 'Database backed up successfully.' });
      } else {
        setBackupMessage({ type: 'error', text: result?.error || 'Backup failed.' });
      }
    } catch (err) {
      setBackupMessage({ type: 'error', text: err?.message || 'Backup failed.' });
    }
  };

  const handleRestore = async () => {
    if (!confirm('Restore will replace your current database. Continue?')) return;
    setRestoreMessage(null);
    setRestoring(true);
    try {
      const result = await api.restore.db();
      if (result?.canceled) {
        setRestoreMessage({ type: 'info', text: 'Restore canceled.' });
        return;
      }
      if (result?.success) {
        const details = result?.restoredFrom ? ` Restored from ${result.restoredFrom}.` : '';
        const safety = result?.safetyBackupPath ? ` Safety backup created at ${result.safetyBackupPath}.` : '';
        setRestoreMessage({ type: 'success', text: `Database restored successfully.${details}${safety} Data views will refresh automatically.` });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('civicflow:invalidate', {
            detail: ['members', 'transactions', 'dashboard', 'dues', 'reports', 'events', 'campaigns', 'expenditures', 'grants'],
          }));
        }
      } else {
        setRestoreMessage({ type: 'error', text: result?.error || 'Restore failed.' });
      }
    } catch (err) {
      setRestoreMessage({ type: 'error', text: err?.message || 'Restore failed.' });
    } finally {
      setRestoring(false);
    }
  };

  const openSampleDataModal = async () => {
    setSampleDataConfirmText('');
    setSampleDataMessage(null);
    setSampleDataDeleting(false);
    // Fetch counts before opening modal
    try {
      const counts = await api?.admin?.getSampleDataCounts?.();
      setSampleDataCounts(counts);
    } catch (_) {
      setSampleDataCounts(null);
    }
    setSampleDataModalOpen(true);
  };

  const handleDeleteSampleData = async () => {
    if (sampleDataConfirmText.trim().toLowerCase() !== 'delete sample data') return;
    
    setSampleDataDeleting(true);
    setSampleDataMessage(null);
    try {
      const result = await api?.admin?.deleteSampleData?.();
      if (result?.success) {
        setSampleDataMessage({
          type: 'success',
          text: `Sample data deleted: ${result.transactionsDeleted} transactions, ${result.eventsDeleted} events, ${result.campaignsDeleted} campaigns, ${result.membersDeleted} members, ${result.expendituresDeleted} expenditures.`,
        });
        setSampleDataCounts({ transactions: 0, events: 0, campaigns: 0, members: 0, expenditures: 0, total: 0 });
        // Close modal after a delay
        setTimeout(() => {
          setSampleDataModalOpen(false);
          setSampleDataConfirmText('');
        }, 2500);
      } else {
        setSampleDataMessage({ type: 'error', text: result?.error || 'Failed to delete sample data.' });
      }
    } catch (err) {
      setSampleDataMessage({ type: 'error', text: err?.message || 'Failed to delete sample data.' });
    } finally {
      setSampleDataDeleting(false);
    }
  };

  const handleOpenActivation = () => {
    if (typeof onOpenActivation === 'function') {
      onOpenActivation();
      return;
    }
    const next = new URL(window.location.href);
    next.searchParams.set('mode', 'activation');
    window.location.href = next.toString();
  };

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Settings</h2>
      <p className="text-slate-600 mb-6">License, branding, backup and restore.</p>

      {/* License */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-2xl mb-8">
        <div
          className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2"
        >
          <Key className="h-5 w-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">License</h3>
        </div>
        <div className="p-6 space-y-4">
          {licenseStatus?.status === 'trial' ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
              <p className="font-medium">Trial active</p>
              <p className="text-sm mt-1">{`Trial: ${licenseStatus.daysRemaining ?? 0} day(s) remaining`}</p>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleOpenActivation}
                  className="px-3 py-1.5 rounded text-sm border border-amber-300 text-amber-900 hover:bg-amber-100"
                >
                  Activate License
                </button>
              </div>
            </div>
          ) : licenseStatus?.activated ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
              <p className="font-medium">License active</p>
              <p className="text-sm mt-1">
                {licenseStatus.plan ? `Plan: ${licenseStatus.plan}` : 'Plan: Essential'}
              </p>
              <p className="text-xs mt-1 text-emerald-700">
                {`Offline days remaining: ${licenseStatus.daysRemainingOffline ?? 0}`}
                {' · '}
                {`Last online check: ${licenseStatus.lastOnlineCheckAt ? new Date(licenseStatus.lastOnlineCheckAt).toLocaleString() : 'Never'}`}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleRefreshLicense}
                  disabled={licenseRefreshing}
                  className="px-3 py-1.5 rounded text-sm border border-emerald-300 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {licenseRefreshing ? 'Checking…' : 'Check in now'}
                </button>
                <button
                  type="button"
                  onClick={handleDeactivate}
                  className="px-3 py-1.5 rounded text-sm border border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                >
                  Deactivate this device
                </button>
              </div>
              {Array.isArray(licenseStatus.warnings) && licenseStatus.warnings.length > 0 && (
                <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 text-xs">
                  {licenseStatus.warnings[0]}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
              <p className="font-medium">Activation required</p>
              <p className="text-sm mt-1">Trial expired. Enter a valid license key to continue.</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email (optional)</label>
            <input
              type="email"
              value={licenseEmail}
              onChange={(e) => setLicenseEmail(e.target.value)}
              placeholder="you@organization.org"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Activation Code / Serial</label>
            <textarea
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="CFLOW-XXXX-XXXX"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm focus:ring-2 focus:ring-emerald-500"
              rows={2}
            />
          </div>
          {licenseMessage && (
            <div
              className={`rounded-lg px-4 py-3 ${
                licenseMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
              }`}
            >
              {licenseMessage.text}
            </div>
          )}
          <button
            type="button"
            onClick={handleActivateLicense}
            disabled={!licenseKey.trim()}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Activate License
          </button>
        </div>
      </div>

      {/* Backup / Restore */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-2xl mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Database className="h-5 w-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">Backup & Restore</h3>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600">Backup copies your database to a file. Restore replaces the current database.</p>
          <div className="flex gap-4">
            <button
              type="button"
              onClick={handleBackup}
              className="px-4 py-2 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-800"
            >
              Backup Database
            </button>
            <button
              type="button"
              onClick={handleRestore}
              disabled={restoring}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {restoring ? 'Restoring…' : 'Restore Database'}
            </button>
          </div>
          {backupMessage && (
            <div className={`rounded-lg px-4 py-3 ${backupMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
              {backupMessage.text}
            </div>
          )}
          {restoreMessage && (
            <div className={`rounded-lg px-4 py-3 ${restoreMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : restoreMessage.type === 'info' ? 'bg-slate-100 text-slate-800' : 'bg-red-50 text-red-800'}`}>
              {restoreMessage.text}
            </div>
          )}
        </div>
      </div>

      {/* Data Import */}
      {currentRole === 'Admin' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-2xl mb-8">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Upload className="h-5 w-5 text-slate-500" />
            <h3 className="text-lg font-semibold text-slate-800">Data Import</h3>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600">
              Import data from Excel (.xlsx) or CSV files. Supports members, membership periods, financial transactions,
              campaigns/contributions, and grants.
            </p>
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
              <p className="text-blue-800 text-sm">
                <strong>Admin only:</strong> All imports are logged, validated before execution, and run in a
                single transaction (all-or-nothing). Financial records are imported as immutable.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('data-import')}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 flex items-center gap-2"
            >
              <Upload className="h-4 w-4" />
              Open Import Wizard
            </button>
          </div>
        </div>
      )}

      {/* Data Management */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-2xl mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">Data Management</h3>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600">
            Remove demo/sample data that was created during initial setup. This does NOT affect your real member data, 
            contributions, or events that you have created.
          </p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-amber-800 text-sm">
              <strong>Sample data includes:</strong> Records with "Sample" in the name, such as "Sample Campaign", 
              "Sample Event", "Sample Member", and transactions with "Sample" notes.
            </p>
          </div>
          <button
            type="button"
            onClick={openSampleDataModal}
            className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700"
          >
            Delete Sample / Demo Data
          </button>
        </div>
      </div>

      {/* Delete Sample Data Modal */}
      {sampleDataModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !sampleDataDeleting && setSampleDataModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800">Delete Sample / Demo Data</h3>
            </div>

            {sampleDataCounts && sampleDataCounts.total > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-slate-700 text-sm font-medium mb-2">Sample data found:</p>
                <ul className="text-sm text-slate-600 space-y-1">
                  {sampleDataCounts.campaigns > 0 && <li>• {sampleDataCounts.campaigns} campaign(s)</li>}
                  {sampleDataCounts.events > 0 && <li>• {sampleDataCounts.events} event(s)</li>}
                  {sampleDataCounts.transactions > 0 && <li>• {sampleDataCounts.transactions} transaction(s)</li>}
                  {sampleDataCounts.members > 0 && <li>• {sampleDataCounts.members} sample member(s)</li>}
                  {sampleDataCounts.expenditures > 0 && <li>• {sampleDataCounts.expenditures} expenditure(s)</li>}
                  {sampleDataCounts.grants > 0 && <li>• {sampleDataCounts.grants} grant(s)</li>}
                </ul>
              </div>
            )}

            {sampleDataCounts && sampleDataCounts.total === 0 && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                <p className="text-emerald-700 text-sm">No sample data found. Your database is clean.</p>
              </div>
            )}

            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-red-800 text-sm font-medium">
                ⚠️ This action is PERMANENT
              </p>
              <p className="text-red-700 text-sm mt-1">
                This will permanently delete sample/demo records. Your real member data, contributions, and events will NOT be affected.
              </p>
            </div>

            <p className="text-slate-600 mb-4">
              To confirm, type <span className="font-mono font-bold">delete sample data</span> below:
            </p>
            <input
              type="text"
              value={sampleDataConfirmText}
              onChange={(e) => setSampleDataConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && sampleDataConfirmText.trim().toLowerCase() === 'delete sample data') {
                  handleDeleteSampleData();
                }
              }}
              placeholder="Type delete sample data to confirm"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500 mb-4"
              autoComplete="off"
              autoFocus
              disabled={sampleDataDeleting || (sampleDataCounts && sampleDataCounts.total === 0)}
            />

            {sampleDataMessage && (
              <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${sampleDataMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                {sampleDataMessage.text}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setSampleDataModalOpen(false); setSampleDataConfirmText(''); }}
                disabled={sampleDataDeleting}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteSampleData}
                disabled={sampleDataDeleting || sampleDataConfirmText.trim().toLowerCase() !== 'delete sample data' || (sampleDataCounts && sampleDataCounts.total === 0)}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {sampleDataDeleting ? 'Deleting…' : 'Delete Sample Data'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Membership Categories */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-2xl mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Tag className="h-5 w-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">Membership Categories</h3>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600">Categories define monthly dues. Members in a category accrue dues from their join date.</p>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
              <input
                type="text"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Category name"
                className="w-40 px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Monthly dues ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={categoryForm.monthly_dues_cents === 0 ? '' : categoryForm.monthly_dues_cents / 100}
                onChange={(e) => setCategoryForm((f) => ({ ...f, monthly_dues_cents: Math.round(parseFloat(e.target.value || 0) * 100) }))}
                placeholder="0"
                className="w-24 px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={handleCategorySave}
              disabled={!categoryForm.name.trim()}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {editingCategoryId ? 'Update' : 'Add'} Category
            </button>
            {editingCategoryId && (
              <button
                type="button"
                onClick={() => { setEditingCategoryId(null); setCategoryForm({ name: '', monthly_dues_cents: 0 }); }}
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm"
              >
                Cancel
              </button>
            )}
          </div>
          {categoryMessage && (
            <div className={`text-sm rounded-lg px-4 py-3 ${categoryMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
              {categoryMessage.text}
            </div>
          )}
          <div className="border-t border-slate-200 pt-4 mt-4">
            <p className="text-xs font-medium text-slate-600 mb-2">Categories</p>
            <ul className="space-y-2">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <span className="font-medium text-slate-800">{c.name}</span>
                  <span className="text-slate-600">${((c.monthly_dues_cents ?? 0) / 100).toFixed(2)}/mo</span>
                  <button
                    type="button"
                    onClick={() => { setEditingCategoryId(c.id); setCategoryForm({ name: c.name, monthly_dues_cents: c.monthly_dues_cents ?? 0 }); }}
                    className="p-1.5 rounded text-slate-500 hover:bg-slate-100"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                </li>
              ))}
              {categories.length === 0 && <li className="text-slate-500 text-sm">No categories yet. Add one above.</li>}
            </ul>
          </div>
        </div>
      </div>

      {/* Organization / Branding */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-2xl mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">Organization</h3>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600">Organization name and logo (sidebar and dashboard).</p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Organization Name</label>
            <input
              type="text"
              value={cboName}
              onChange={(e) => setCboName(e.target.value)}
              placeholder="Civicflow"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Upload Logo (PNG/JPG, max 512×512)</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              onChange={handleLogoUpload}
              disabled={logoUploading}
              className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:font-medium hover:file:bg-emerald-100"
            />
            {logoPath && <p className="text-xs text-slate-500 mt-1">Current: {logoPath}</p>}
          </div>
          {logoMessage && (
            <div className={`rounded-lg px-4 py-3 text-sm ${logoMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
              {logoMessage.text}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Logo path (optional override)</label>
            <input
              type="text"
              value={logoPath}
              onChange={(e) => setLogoPath(e.target.value)}
              placeholder="Full path to logo image"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email Display Name</label>
            <input
              type="text"
              value={orgEmailDisplayName}
              onChange={(e) => setOrgEmailDisplayName(e.target.value)}
              placeholder="Organization name"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-xs text-slate-500 mt-1">Shown as the sender name for emails. Defaults to "{cboName || 'Civicflow'} via CivicFlow".</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email From Address</label>
            <input
              type="email"
              value={orgEmailFromAddress}
              onChange={(e) => setOrgEmailFromAddress(e.target.value)}
              placeholder="noreply@yourdomain.org"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-xs text-slate-500 mt-1">Used for the sender email. Defaults to noreply@civicflow.app.</p>
          </div>
          {saved && <p className="text-sm text-emerald-600">Saved.</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSaveBranding}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('setup-wizard')}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50"
              >
                Run Setup Wizard
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Online Payments */}
      {currentRole === 'Admin' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-2xl mb-8">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-slate-500" />
            <h3 className="text-lg font-semibold text-slate-800">Online Payments</h3>
          </div>
        <div className="p-6 space-y-3">
            <p className="text-sm text-slate-600">Enable Stripe checkout links for dues payments on member profiles.</p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm text-slate-700 font-medium">Stripe Status</p>
              <p className="text-sm text-slate-600">
                {stripeAccountId ? `Connected (…${String(stripeAccountId).slice(-4)})` : 'Not Connected'}
              </p>
              <button
                type="button"
                onClick={handleConnectStripe}
                disabled={stripeConnecting}
                className="mt-3 px-3 py-1.5 rounded text-sm border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                {stripeConnecting ? 'Opening Stripe…' : (stripeAccountId ? 'Reconnect Stripe' : 'Connect Stripe Account')}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cash App Handle</label>
                <input
                  type="text"
                  value={cashappHandle}
                  onChange={(e) => setCashappHandle(e.target.value)}
                  placeholder="$yourhandle"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Zelle Contact</label>
                <input
                  type="text"
                  value={zelleContact}
                  onChange={(e) => setZelleContact(e.target.value)}
                  placeholder="email or phone"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Venmo Handle</label>
                <input
                  type="text"
                  value={venmoHandle}
                  onChange={(e) => setVenmoHandle(e.target.value)}
                  placeholder="@yourhandle"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveBranding}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save Payment Methods'}
              </button>
              {saved && <span className="text-sm text-emerald-600">Saved.</span>}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={!!paymentsEnabled}
                disabled={paymentsSaving}
                onChange={(e) => handleTogglePayments(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              Enable Online Payments
            </label>
            {paymentsMessage && (
              <div className={`rounded-lg px-4 py-3 text-sm ${paymentsMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                {paymentsMessage.text}
              </div>
            )}
            {stripeMessage && (
              <div className={`rounded-lg px-4 py-3 text-sm ${stripeMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                {stripeMessage.text}
              </div>
            )}
          </div>
        </div>
      )}

      {currentRole === 'Admin' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-2xl mb-8">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-slate-500" />
            <h3 className="text-lg font-semibold text-slate-800">Auto-Archive</h3>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600">Automatically archive completed events and campaigns after a set number of days.</p>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={!!autoArchiveEnabled}
                onChange={(e) => setAutoArchiveEnabled(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              Enable Auto-Archive
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Archive Events After (days)</label>
                <input
                  type="number"
                  min="0"
                  value={autoArchiveEventsDays}
                  onChange={(e) => setAutoArchiveEventsDays(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Archive Campaigns After End Date (days)</label>
                <input
                  type="number"
                  min="0"
                  value={autoArchiveCampaignsDays}
                  onChange={(e) => setAutoArchiveCampaignsDays(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveAutoArchive}
                disabled={autoArchiveSaving}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                {autoArchiveSaving ? 'Saving…' : 'Save Auto-Archive Settings'}
              </button>
            </div>
            {autoArchiveMessage && (
              <div className={`rounded-lg px-4 py-3 text-sm ${autoArchiveMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                {autoArchiveMessage.text}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Email Settings */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-2xl mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Mail className="h-5 w-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">Email Settings (SMTP)</h3>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600">Configure SMTP to enable email notifications, invoices, receipts, and financial reports.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">From Name</label>
              <input type="text" value={emailForm.from_name} onChange={(e) => setEmailForm(f => ({...f, from_name: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" placeholder="CivicFlow" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">From Email</label>
              <input type="email" value={emailForm.from_email} onChange={(e) => setEmailForm(f => ({...f, from_email: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" placeholder="noreply@example.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Host</label>
              <input type="text" value={emailForm.smtp_host} onChange={(e) => setEmailForm(f => ({...f, smtp_host: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" placeholder="smtp.gmail.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Port</label>
              <input type="number" value={emailForm.smtp_port} onChange={(e) => setEmailForm(f => ({...f, smtp_port: parseInt(e.target.value) || 587}))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Username</label>
              <input type="text" value={emailForm.smtp_user} onChange={(e) => setEmailForm(f => ({...f, smtp_user: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Password</label>
              <input type="password" value={emailForm.smtp_password} onChange={(e) => setEmailForm(f => ({...f, smtp_password: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500" placeholder={emailSettings?.hasPassword ? '••••••••' : ''} />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={!!emailForm.smtp_secure} onChange={(e) => setEmailForm(f => ({...f, smtp_secure: e.target.checked ? 1 : 0}))} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              Use SSL/TLS
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={!!emailForm.enabled} onChange={(e) => setEmailForm(f => ({...f, enabled: e.target.checked ? 1 : 0}))} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              Enable email sending
            </label>
          </div>
          {emailMessage && (
            <div className={`rounded-lg px-4 py-3 text-sm ${emailMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              {emailMessage.text}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={async () => {
                setEmailSaving(true); setEmailMessage(null);
                try {
                  const payload = { ...emailForm };
                  if (!payload.smtp_password) delete payload.smtp_password;
                  const result = await api?.email?.updateSettings?.(payload);
                  if (result?.error) setEmailMessage({ type: 'error', text: result.error });
                  else setEmailMessage({ type: 'success', text: 'Email settings saved.' });
                } catch (err) { setEmailMessage({ type: 'error', text: err?.message || 'Save failed' }); }
                finally { setEmailSaving(false); }
              }}
              disabled={emailSaving}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
            >
              {emailSaving ? 'Saving...' : 'Save Email Settings'}
            </button>
            <div className="flex items-center gap-2">
              <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="test@example.com" className="px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 text-sm" />
              <button
                onClick={async () => {
                  if (!testEmail) return;
                  setTestingSend(true); setEmailMessage(null);
                  try {
                    const result = await api?.email?.sendTest?.(testEmail);
                    if (result?.error) setEmailMessage({ type: 'error', text: result.error });
                    else setEmailMessage({ type: 'success', text: 'Test email sent successfully!' });
                  } catch (err) { setEmailMessage({ type: 'error', text: err?.message || 'Test failed' }); }
                  finally { setTestingSend(false); }
                }}
                disabled={testingSend || !testEmail}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-medium hover:bg-slate-200 disabled:opacity-60 text-sm"
              >
                <Send className="h-4 w-4" />
                {testingSend ? 'Sending...' : 'Send Test'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Role Management */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-2xl mb-8">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Shield className="h-5 w-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">Access Control</h3>
        </div>
        <div className="p-6">
          <p className="text-sm text-slate-600 mb-4">Set the current user role. Admin has full access; Viewer cannot modify data or send emails.</p>
          <div className="flex items-center gap-4">
            <select
              value={currentRole}
              onChange={async (e) => {
                const newRole = e.target.value;
                const result = await api?.roles?.setCurrent?.(newRole);
                if (result?.success) setCurrentRole(newRole);
              }}
              className="px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            >
              <option value="Admin">Admin</option>
              <option value="Viewer">Viewer</option>
            </select>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium ${currentRole === 'Admin' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
              {currentRole}
            </span>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-2xl">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Info className="h-5 w-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">About</h3>
        </div>
        <div className="p-6">
          <p className="text-lg font-semibold text-slate-800">Civicflow</p>
          <p className="text-sm text-slate-600 mt-1">Offline desktop app for community organizations.</p>
          <p className="text-xs text-slate-500 mt-2">Version 1.0.0</p>
        </div>
      </div>
    </div>
  );
}
