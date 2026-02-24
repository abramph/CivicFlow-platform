import { useEffect, useState } from 'react';
import { Key, Lock, ClipboardPaste } from 'lucide-react';

const api = window.civicflow;

/**
 * Full-screen activation gate shown when the app requires activation.
 * User must enter organization name, activation key, and select slot.
 */
export function ActivationScreen({ reason }) {
  const [licenseKey, setLicenseKey] = useState('');
  const [message, setMessage] = useState(null);
  const [activating, setActivating] = useState(false);
  const [trialDaysRemaining, setTrialDaysRemaining] = useState(0);

  useEffect(() => {
    let cancelled = false;

    api?.license?.getStatus?.()
      .then((status) => {
        if (cancelled) return;
        const days = Number(status?.daysRemaining ?? 0);
        const isTrial = status?.status === 'trial' && days > 0;
        setTrialDaysRemaining(isTrial ? days : 0);
      })
      .catch(() => {
        if (!cancelled) setTrialDaysRemaining(0);
      });

    return () => { cancelled = true; };
  }, []);

  const handleContinueWithTrial = () => {
    const next = new URL(window.location.href);
    next.searchParams.delete('mode');
    next.searchParams.delete('reason');
    window.location.href = next.toString();
  };

  const handlePaste = async () => {
    setMessage(null);
    try {
      const text = await navigator.clipboard.readText();
      setLicenseKey(text || '');
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Unable to read clipboard.' });
    }
  };

  const handleActivate = async () => {
    setMessage(null);
    
    if (!licenseKey || !licenseKey.trim()) {
      setMessage({ type: 'error', text: 'Activation key is required' });
      return;
    }

    setActivating(true);
    try {
      const result = await api?.license?.activate?.(licenseKey.trim());
      
      if (result?.success) {
        setMessage({ type: 'success', text: 'License activated. Opening Civicflow…' });
        setLicenseKey('');
        // Exit activation mode and route to dashboard after successful activation
        setTimeout(() => {
          const next = new URL(window.location.href);
          next.searchParams.delete('mode');
          next.searchParams.delete('reason');
          next.hash = '#/dashboard';
          window.location.href = next.toString();
        }, 1500);
      } else {
        setMessage({ type: 'error', text: result?.error || 'Activation failed.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Invalid key.' });
    } finally {
      setActivating(false);
    }
  };

  const getReasonMessage = () => {
    switch (reason) {
      case 'trial_expired':
        return 'Your 30-day trial has expired. Please activate with a valid license key.';
      case 'no_license':
        return 'No license found. Please activate with a PRO license key.';
      case 'expired':
        return 'Your license has expired. Please activate with a new license key.';
      default:
        return 'Please activate Civicflow with a valid license key.';
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-100 text-amber-700">
            <Lock className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Activate Civicflow</h1>
            <p className="text-sm text-slate-600 mt-0.5">{getReasonMessage()}</p>
          </div>
        </div>

      <div className="px-8 py-6 space-y-5">
          {/* Activation Key */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Activation Key <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="Enter license key (e.g. XXXX-XXXX-XXXX-XXXX)"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono"
                disabled={activating}
              />
              <button
                onClick={handlePaste}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg text-slate-700 transition-colors"
                title="Paste from clipboard"
                disabled={activating}
              >
                <ClipboardPaste className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Activation Status Message */}
          {message && (
            <div
              className={`px-4 py-3 rounded-lg text-sm ${
                message.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {message.text}
            </div>
          )}

          {/* Activate Button */}
          <button
            onClick={handleActivate}
            disabled={activating}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {activating ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Activating...</span>
              </>
            ) : (
              <>
                <Key className="h-5 w-5" />
                <span>Activate License</span>
              </>
            )}
          </button>

          {trialDaysRemaining > 0 && (
            <button
              type="button"
              onClick={handleContinueWithTrial}
              className="w-full py-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold rounded-lg transition-colors"
            >
              {`Continue with Trial (${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'} left)`}
            </button>
          )}
        </div>

        <div className="px-8 py-4 border-t border-slate-200 bg-slate-50">
          <p className="text-xs text-slate-500 text-center">
            Need a license key? Contact your administrator or visit{' '}
            <span className="font-semibold">civicflow.com</span>
          </p>
        </div>
      </div>
    </div>
  );
}
