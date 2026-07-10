import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ClipboardPaste, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { buildLicenseFacts, getActivationErrorMessage, getLicenseStatusPresentation, formatLicenseDate } from '../utils/licenseStatus.js';

const api = window.civicflow;

function toneClasses(tone) {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (tone === 'danger') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

export function ActivationScreen({
  reason = null,
  licenseStatus = null,
  forcedStep = null,
  onContinueTrial,
  onStatusChange,
  onComplete,
}) {
  const [step, setStep] = useState(forcedStep || 'welcome');
  const [licenseKey, setLicenseKey] = useState('');
  const [email, setEmail] = useState(licenseStatus?.customerEmail || '');
  const [message, setMessage] = useState(null);
  const [activating, setActivating] = useState(false);
  const [activatedStatus, setActivatedStatus] = useState(null);

  const presentation = useMemo(() => getLicenseStatusPresentation(licenseStatus), [licenseStatus]);
  const facts = useMemo(() => buildLicenseFacts(activatedStatus || licenseStatus), [activatedStatus, licenseStatus]);
  const trialDaysRemaining = Number(licenseStatus?.daysRemaining ?? 0);
  const trialIsActive = licenseStatus?.type === 'trial' && licenseStatus?.valid && trialDaysRemaining > 0;

  useEffect(() => {
    if (forcedStep) {
      setStep(forcedStep);
      return;
    }
    if (activatedStatus?.activated) {
      setStep('success');
      return;
    }
    setStep(trialIsActive ? 'welcome' : 'activate');
  }, [forcedStep, trialIsActive, activatedStatus]);

  useEffect(() => {
    if (licenseStatus?.customerEmail) {
      setEmail(licenseStatus.customerEmail);
    }
  }, [licenseStatus?.customerEmail]);

  const handlePaste = async () => {
    setMessage(null);
    try {
      const text = await navigator.clipboard.readText();
      setLicenseKey(text || '');
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Unable to read the clipboard.' });
    }
  };

  const handleActivate = async () => {
    setMessage(null);
    if (!licenseKey.trim()) {
      setMessage({ type: 'error', text: 'Enter the Unestra license key from your purchase email.' });
      return;
    }

    setActivating(true);
    try {
      const result = await api?.license?.activate?.({
        licenseKey: licenseKey.trim(),
        email: email.trim() || null,
      });

      if (!result?.success) {
        setMessage({ type: 'error', text: getActivationErrorMessage(result?.error) });
        return;
      }

      setActivatedStatus(result);
      setMessage({ type: 'success', text: 'License activated on this device.' });
      setLicenseKey('');
      setStep('success');
      await onStatusChange?.(result);
    } catch (err) {
      setMessage({ type: 'error', text: getActivationErrorMessage(err?.message) });
    } finally {
      setActivating(false);
    }
  };

  const handleContinue = async () => {
    const nextStatus = activatedStatus || licenseStatus;
    await onComplete?.(nextStatus);
  };

  const handleContinueTrial = async () => {
    await onContinueTrial?.();
  };

  const handleBackToTrial = () => {
    setMessage(null);
    setStep('welcome');
  };

  const welcomeBody = (() => {
    if (reason === 'trial_expired') {
      return 'Your trial has ended. Enter the license key from your Unestra purchase email to unlock the app.';
    }
    if (reason === 'expired') {
      return 'This annual license has expired. Enter a renewed or replacement license key to continue.';
    }
    if (reason === 'revoked') {
      return 'This device can no longer use the previous license. Enter a valid replacement key to continue.';
    }
    if (reason === 'device_fingerprint_mismatch') {
      return 'This install no longer matches the device fingerprint from activation. Re-activate with your license key or contact Unestra support if this computer was not replaced.';
    }
    if (reason === 'offline_grace_expired') {
      return 'This device has been offline too long since the last successful license check-in. Reconnect and validate your license to continue.';
    }
    return presentation.body;
  })();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(250,244,214,0.9),_rgba(240,245,238,1)_45%,_rgba(225,237,229,1)_100%)] px-5 py-8 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full gap-6 overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(24,39,31,0.14)] lg:grid-cols-[1.15fr_0.85fr]">
          <section className="relative overflow-hidden bg-slate-950 px-8 py-10 text-white lg:px-12 lg:py-14">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(29,122,90,0.42),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(246,207,98,0.2),_transparent_32%)]" />
            <div className="relative z-10 flex h-full flex-col justify-between gap-8">
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">
                  <Sparkles className="h-3.5 w-3.5" />
                  Unestra Onboarding
                </div>
                <h1 className="max-w-xl text-4xl font-semibold leading-tight">Activate Unestra with the license key from your purchase email.</h1>
                <p className="mt-4 max-w-xl text-base leading-7 text-slate-200">
                  Open Unestra, go to activation, then enter your email address and license key. The app will cache the license for offline grace and keep using the current production activation flow.
                </p>
              </div>

              <div className="space-y-4">
                <div className="rounded-3xl border border-white/15 bg-white/8 p-5 backdrop-blur-sm">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-100">
                    <ShieldCheck className="h-4 w-4" />
                    Current Status
                  </div>
                  <div className={`rounded-2xl border border-white/20 bg-white/10 px-4 py-4 text-sm text-slate-100`}>
                    <p className="font-semibold text-white">{presentation.title}</p>
                    <p className="mt-1 leading-6 text-slate-200">{welcomeBody}</p>
                    {trialIsActive && (
                      <p className="mt-3 text-xs uppercase tracking-[0.16em] text-amber-100/80">{`${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'} remaining in trial mode`}</p>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 rounded-3xl border border-white/15 bg-white/8 p-5 text-sm text-slate-100 backdrop-blur-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-300">Step 1</p>
                    <p className="mt-2 font-medium">Welcome</p>
                    <p className="mt-1 text-slate-300">Review your trial or paid activation options.</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-300">Step 2</p>
                    <p className="mt-2 font-medium">Activate</p>
                    <p className="mt-1 text-slate-300">Enter your email and license key.</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-300">Step 3</p>
                    <p className="mt-2 font-medium">Start Working</p>
                    <p className="mt-1 text-slate-300">Confirm plan, device seats, and expiry details.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="px-6 py-8 lg:px-8 lg:py-10">
            <div className="mx-auto flex h-full max-w-lg flex-col justify-center gap-6">
              {step === 'welcome' && (
                <div className="space-y-6">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">Step 1</p>
                    <h2 className="mt-2 text-3xl font-semibold text-slate-900">Welcome to Unestra</h2>
                    <p className="mt-3 text-base leading-7 text-slate-600">
                      Use the remaining trial time or activate the paid license you received after purchase.
                    </p>
                  </div>

                  <div className={`rounded-3xl border px-5 py-5 ${toneClasses(presentation.tone)}`}>
                    <p className="text-lg font-semibold">{presentation.title}</p>
                    <p className="mt-2 text-sm leading-6">{welcomeBody}</p>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                    <p className="text-sm font-semibold text-slate-800">Trial vs paid activation</p>
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                      <li>Trial mode lets you keep evaluating Unestra until the trial ends.</li>
                      <li>Paid activation unlocks the purchased Essential or Elite license on this device.</li>
                      <li>The activation email and in-app wording use the same activation steps.</li>
                    </ul>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {trialIsActive && (
                      <button
                        type="button"
                        onClick={handleContinueTrial}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        Continue Trial
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setStep('activate')}
                      className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                    >
                      Activate License
                      <KeyRound className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {step === 'activate' && (
                <div className="space-y-6">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">Step 2</p>
                    <h2 className="mt-2 text-3xl font-semibold text-slate-900">Activate your license</h2>
                    <p className="mt-3 text-base leading-7 text-slate-600">
                      Enter the same email and license key shown in your Unestra purchase email.
                    </p>
                  </div>

                  <div className="grid gap-4">
                    <label className="grid gap-2 text-sm font-medium text-slate-700">
                      Customer email
                      <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="you@organization.org"
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                      />
                    </label>

                    <label className="grid gap-2 text-sm font-medium text-slate-700">
                      License key
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={licenseKey}
                          onChange={(event) => setLicenseKey(event.target.value)}
                          placeholder="CF-XXXX-XXXX-XXXX-XXXX"
                          className="min-w-0 flex-1 rounded-2xl border border-slate-300 px-4 py-3 font-mono text-sm uppercase outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                          disabled={activating}
                        />
                        <button
                          type="button"
                          onClick={handlePaste}
                          className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-slate-700 transition hover:bg-slate-50"
                          disabled={activating}
                          title="Paste"
                        >
                          <ClipboardPaste className="h-4 w-4" />
                        </button>
                      </div>
                    </label>
                  </div>

                  {message && (
                    <div className={`rounded-2xl border px-4 py-4 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                      {message.text}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleActivate}
                      disabled={activating}
                      className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {activating ? 'Activating...' : 'Activate License'}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleBackToTrial}
                      disabled={activating}
                      className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      Back to Trial
                    </button>
                    {trialIsActive && (
                      <button
                        type="button"
                        onClick={handleContinueTrial}
                        disabled={activating}
                        className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        Continue Trial
                      </button>
                    )}
                  </div>
                </div>
              )}

              {step === 'success' && (
                <div className="space-y-6">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">Step 3</p>
                    <h2 className="mt-2 flex items-center gap-2 text-3xl font-semibold text-slate-900">
                      <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                      Activation complete
                    </h2>
                    <p className="mt-3 text-base leading-7 text-slate-600">
                      Unestra is activated on this device. Review the license details below, then continue to the app.
                    </p>
                  </div>

                  <div className="grid gap-3 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 sm:grid-cols-2">
                    {facts.map((fact) => (
                      <div key={fact.label} className="rounded-2xl bg-white/70 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">{fact.label}</p>
                        <p className="mt-1 text-sm text-slate-800">{fact.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
                    <p className="font-semibold text-slate-800">What happens next</p>
                    <p className="mt-2">
                      Unestra will keep validating the paid license in the background and will use its offline cache when the license server is temporarily unavailable.
                    </p>
                    {(activatedStatus || licenseStatus)?.expiresAt && (
                      <p className="mt-2 text-slate-700">{`Annual access expires on ${formatLicenseDate((activatedStatus || licenseStatus)?.expiresAt) || (activatedStatus || licenseStatus)?.expiresAt}.`}</p>
                    )}
                    {(activatedStatus || licenseStatus)?.supportExpiresAt && (
                      <p className="mt-2 text-slate-700">{`Support coverage runs through ${formatLicenseDate((activatedStatus || licenseStatus)?.supportExpiresAt) || (activatedStatus || licenseStatus)?.supportExpiresAt}.`}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleContinue}
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  >
                    Continue to Unestra
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
