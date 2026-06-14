function toNullableString(value, fallback = null) {
  return value == null ? fallback : value;
}

function toOptionalFlag(value, fallback = null) {
  if (value == null) return fallback;
  return value ? 1 : 0;
}

function toArchiveFlag(value, fallback = 0) {
  if (value == null) return fallback ? 1 : 0;
  return value ? 1 : 0;
}

function toArchiveDays(value, fallback = 90) {
  if (value == null) return Math.max(0, Number(fallback) || 0);
  return Math.max(0, Number(value) || 0);
}

function getCurrentOrganization(database) {
  return database.prepare(`
    SELECT
      name,
      logo_path,
      email_display_name,
      email_from_address,
      payments_enabled,
      stripe_account_id,
      cashapp_handle,
      zelle_contact,
      venmo_handle,
      auto_archive_enabled,
      auto_archive_events_days,
      auto_archive_campaigns_days
    FROM organization
    WHERE id = 1
  `).get() || {};
}

function buildOrganizationPayload(database, data = {}) {
  const current = getCurrentOrganization(database);
  return {
    name: toNullableString(data.name, current.name ?? null),
    logo_path: toNullableString(data.logo_path, current.logo_path ?? null),
    email_display_name: toNullableString(data.email_display_name, current.email_display_name ?? null),
    email_from_address: toNullableString(data.email_from_address, current.email_from_address ?? null),
    payments_enabled: toOptionalFlag(data.payments_enabled, current.payments_enabled ?? null),
    stripe_account_id: toNullableString(data.stripe_account_id, current.stripe_account_id ?? null),
    cashapp_handle: toNullableString(data.cashapp_handle, current.cashapp_handle ?? null),
    zelle_contact: toNullableString(data.zelle_contact, current.zelle_contact ?? null),
    venmo_handle: toNullableString(data.venmo_handle, current.venmo_handle ?? null),
    auto_archive_enabled: toArchiveFlag(data.auto_archive_enabled, current.auto_archive_enabled ?? 0),
    auto_archive_events_days: toArchiveDays(data.auto_archive_events_days, current.auto_archive_events_days ?? 90),
    auto_archive_campaigns_days: toArchiveDays(data.auto_archive_campaigns_days, current.auto_archive_campaigns_days ?? 90),
  };
}

function upsertOrganization(database, data = {}) {
  const payload = buildOrganizationPayload(database, data);

  database.prepare(`
    INSERT INTO organization (
      id,
      name,
      logo_path,
      email_display_name,
      email_from_address,
      payments_enabled,
      stripe_account_id,
      cashapp_handle,
      zelle_contact,
      venmo_handle,
      auto_archive_enabled,
      auto_archive_events_days,
      auto_archive_campaigns_days,
      updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0), COALESCE(?, 90), COALESCE(?, 90), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      logo_path = excluded.logo_path,
      email_display_name = excluded.email_display_name,
      email_from_address = excluded.email_from_address,
      payments_enabled = excluded.payments_enabled,
      stripe_account_id = excluded.stripe_account_id,
      cashapp_handle = excluded.cashapp_handle,
      zelle_contact = excluded.zelle_contact,
      venmo_handle = excluded.venmo_handle,
      auto_archive_enabled = COALESCE(excluded.auto_archive_enabled, 0),
      auto_archive_events_days = COALESCE(excluded.auto_archive_events_days, 90),
      auto_archive_campaigns_days = COALESCE(excluded.auto_archive_campaigns_days, 90),
      updated_at = datetime('now')
  `).run(
    payload.name,
    payload.logo_path,
    payload.email_display_name,
    payload.email_from_address,
    payload.payments_enabled,
    payload.stripe_account_id,
    payload.cashapp_handle,
    payload.zelle_contact,
    payload.venmo_handle,
    payload.auto_archive_enabled,
    payload.auto_archive_events_days,
    payload.auto_archive_campaigns_days,
  );

  return payload;
}

module.exports = {
  buildOrganizationPayload,
  upsertOrganization,
};
