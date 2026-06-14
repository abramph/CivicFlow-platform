export function formatLicenseDate(value, options = {}) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return options.includeTime
    ? parsed.toLocaleString()
    : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function getActivationErrorMessage(rawError) {
  const text = String(rawError || '').trim();
  const lower = text.toLowerCase();
  if (!text) return 'Activation failed. Check the license key and try again.';
  if (lower.includes('not configured') || lower.includes('configuration') || lower.includes('invalid activation server url')) {
    return 'CivicFlow does not have a valid license server URL configured. Check Licensing Diagnostics and update the activation server setting.';
  }
  if (lower.includes('seat limit')) return 'All seats for this license are already in use. Reset an activation or contact CivicFlow support.';
  if (lower.includes('revoked')) return 'This license has been revoked. Contact CivicFlow support if you believe this is incorrect.';
  if (lower.includes('expired')) return 'This license is expired. Renew or replace it to continue.';
  if (lower.includes('invalid key') || lower.includes('invalid license')) return 'That license key was not recognized. Check the key and try again.';
  if (lower.includes('hostname could not be resolved')) return 'The configured license server hostname could not be resolved. Check the activation server URL.';
  if (lower.includes('unreachable at')) return 'The configured license server could not be reached. Confirm internet access and the activation server URL.';
  if (lower.includes('server unavailable') || lower.includes('timeout') || lower.includes('network error')) return 'The license server is unavailable right now. If this device already checked in recently, offline grace may still apply.';
  return text;
}

export function getLicenseStatusPresentation(status) {
  if (!status) {
    return {
      tone: 'warning',
      title: 'License status unavailable',
      body: 'CivicFlow could not read the current license state.',
    };
  }

  if (status.type === 'trial') {
    if (status.valid) {
      return {
        tone: 'warning',
        title: 'Trial active',
        body: `${status.daysRemaining ?? 0} day${status.daysRemaining === 1 ? '' : 's'} remaining in the CivicFlow trial. Activate your paid license at any time.`,
      };
    }
    return {
      tone: 'danger',
      title: 'Trial expired',
      body: 'The CivicFlow trial has ended. Enter a paid license key to continue.',
    };
  }

  if (status.type === 'paid' && status.activated) {
    if (String(status.licenseType || '').toUpperCase() === 'PERPETUAL') {
      return {
        tone: 'success',
        title: 'Perpetual license active',
        body: status.supportExpiresAt
          ? `Support coverage runs through ${formatLicenseDate(status.supportExpiresAt) || status.supportExpiresAt}.`
          : 'Perpetual access is active on this device.',
      };
    }

    return {
      tone: 'success',
      title: 'Annual license active',
      body: status.expiresAt
        ? `This license expires on ${formatLicenseDate(status.expiresAt) || status.expiresAt}.`
        : 'This annual license is active on this device.',
    };
  }

  if (String(status.reason || '').toLowerCase().includes('revoked')) {
    return {
      tone: 'danger',
      title: 'License revoked',
      body: 'This license has been revoked and can no longer be used on this device.',
    };
  }

  if (status.reason === 'offline_grace_expired') {
    return {
      tone: 'danger',
      title: 'Offline grace expired',
      body: 'This device has been offline too long. Reconnect to CivicFlow licensing services and validate again.',
    };
  }

  if (status.reason === 'device_fingerprint_mismatch') {
    return {
      tone: 'danger',
      title: 'Device fingerprint changed',
      body: 'This install no longer matches the device that was activated. Re-validate online with your license key or contact CivicFlow support if this computer was not replaced.',
    };
  }

  return {
    tone: 'danger',
    title: 'Activation required',
    body: 'Enter a valid paid license key to continue.',
  };
}

export function buildLicenseFacts(status) {
  if (!status) return [];
  const facts = [
    { label: 'Organization', value: status.organizationName || null },
    { label: 'Email', value: status.customerEmail || null },
    { label: 'Plan', value: status.plan || null },
    { label: 'License Type', value: status.licenseType || null },
    { label: 'Status', value: status.statusValue || status.status || null },
    { label: 'Expires', value: formatLicenseDate(status.expiresAt) || (status.expiresAt ? status.expiresAt : (String(status.licenseType || '').toUpperCase() === 'PERPETUAL' ? 'Perpetual' : null)) },
    { label: 'Support Expires', value: formatLicenseDate(status.supportExpiresAt) || status.supportExpiresAt || null },
    { label: 'Seats Allowed', value: status.seatsAllowed != null ? String(status.seatsAllowed) : null },
    { label: 'Active Device Count', value: status.activeDeviceCount != null ? String(status.activeDeviceCount) : null },
    { label: 'Last Validated', value: formatLicenseDate(status.lastValidatedAt, { includeTime: true }) || null },
  ];
  return facts.filter((fact) => fact.value);
}

