export function normalizeLocalFilePath(filePath) {
  if (!filePath) return null;

  let normalized = String(filePath).trim().replace(/\\/g, '/');
  if (!normalized) return null;

  if (/^[A-Za-z]\//.test(normalized)) {
    normalized = normalized.replace(/^([A-Za-z])\//, '$1:/');
  }

  if (/^[A-Za-z]:\//.test(normalized)) {
    return `/${normalized}`;
  }

  if (normalized.startsWith('//')) {
    return normalized;
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function toLocalFileUrl(filePath) {
  const normalizedPath = normalizeLocalFilePath(filePath);
  return normalizedPath ? `file://${normalizedPath}` : null;
}
