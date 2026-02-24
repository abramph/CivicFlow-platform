function errorHandler(err, _req, res, _next) {
  const message = err?.message || 'Internal server error';
  // eslint-disable-next-line no-console
  console.error('[Cloud API Error]', err);
  res.status(err?.statusCode || 500).json({ success: false, error: message });
}

module.exports = { errorHandler };
