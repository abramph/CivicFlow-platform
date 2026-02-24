const { getDeviceId } = require('./device.js');
const {
  activateLicense: activateLicenseOnline,
  loadLocalLicense,
  clearLicense,
} = require('./licenseService.js');

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  try {
    const expDate = new Date(expiresAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expDate.setHours(0, 0, 0, 0);
    return expDate < today;
  } catch {
    return true;
  }
}

function autoActivateTrial() {
  return false;
}

function getLicenseStatus() {
  const license = loadLocalLicense();
  if (!license) {
    return { activated: false, reason: 'no_license' };
  }

  const expired = isExpired(license.expiry);
  if (expired) {
    return {
      activated: false,
      expired: true,
      reason: 'expired',
      licenseType: license.licenseType || 'STANDARD',
      expiresAt: license.expiry || null,
      issuedToName: license.org || null,
    };
  }

  return {
    activated: true,
    expired: false,
    licenseType: license.licenseType || 'STANDARD',
    expiresAt: license.expiry || null,
    issuedToName: license.org || null,
    deviceId: license.deviceId || getDeviceId(),
    token: license.token || null,
  };
}

function isActivated() {
  return !!getLicenseStatus().activated;
}

async function activateLicense(data) {
  try {
    const licenseKey = typeof data === 'string'
      ? data
      : (data?.licenseKey || data?.key);

    if (!licenseKey || !licenseKey.trim()) {
      return { success: false, error: 'License key is required' };
    }

    const result = await activateLicenseOnline(licenseKey.trim());
    if (result?.valid) {
      return { success: true, data: result };
    }

    return { success: false, error: result?.reason || 'Activation failed' };
  } catch (err) {
    return { success: false, error: err?.message || 'Activation failed' };
  }
}

async function deactivateLicense(data) {
  try {
    const stored = loadLocalLicense();
    const licenseKey = typeof data === 'string'
      ? data
      : (data?.licenseKey || data?.key || stored?.licenseKey);

    if (!licenseKey) {
      clearLicense();
      return { success: false, error: 'No license key found' };
    }

    clearLicense();
    return { success: true };
  } catch (err) {
    clearLicense();
    return { success: false, error: err?.message || 'Deactivation failed' };
  }
}

function canActivate() {
  return { canActivate: true };
}

function getCurrentDeviceId() {
  return getDeviceId();
}

function canWrite() {
  const status = getLicenseStatus();
  return !!status.activated && !status.expired;
}

function isExpiredLicense() {
  const status = getLicenseStatus();
  return !status.activated && status.expired;
}

function isFeatureEnabled(feature) {
  const status = getLicenseStatus();
  if (!status.activated) return false;

  const licenseType = (status.licenseType || '').toUpperCase();
  switch (feature.toLowerCase()) {
    case 'grants':
      return licenseType.includes('GRANTS') || licenseType === 'PRO_PLUS' || licenseType === 'ENTERPRISE';
    default:
      return status.activated;
  }
}

function getEnabledFeatures() {
  const status = getLicenseStatus();

  if (!status.activated) {
    return {
      base: false,
      grants: false,
    };
  }

  return {
    base: true,
    grants: isFeatureEnabled('grants'),
  };
}

module.exports = {
  autoActivateTrial,
  getLicenseStatus,
  isActivated,
  activateLicense,
  deactivateLicense,
  canActivate,
  getCurrentDeviceId,
  canWrite,
  isExpiredLicense,
  isFeatureEnabled,
  getEnabledFeatures,
};
