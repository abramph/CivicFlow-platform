const { machineIdSync } = require('node-machine-id');

/**
 * Get the current device's unique identifier
 * @returns {string} Device ID
 */
function getDeviceId() {
  try {
    return machineIdSync({ original: true });
  } catch (err) {
    console.error('Failed to get device ID:', err);
    // Fallback to a generated ID if machineIdSync fails
    return `fallback-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
}

module.exports = { getDeviceId };
