function registerStripeWebhook(app, db, { sendReceiptEmail } = {}) {
  if (!app || typeof app.post !== 'function') {
    throw new Error('registerStripeWebhook expects an app with a .post(path, handler) method');
  }
  if (!db) {
    throw new Error('registerStripeWebhook requires a database handle');
  }
  const toOptionalPositiveId = (value) => {
    if (value == null || value === '') return null;
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized <= 0) return null;
    return normalized;
  };

  const validateAttribution = ({ memberId, campaignId, eventId, contributorType }) => {
    const normalizedMemberId = toOptionalPositiveId(memberId);
    const normalizedCampaignId = toOptionalPositiveId(campaignId);
    const normalizedEventId = toOptionalPositiveId(eventId);
    const normalizedContributorType = String(contributorType || '').trim().toUpperCase();

    if (!normalizedMemberId && !normalizedCampaignId && !normalizedEventId && normalizedContributorType !== 'NON_MEMBER') {
      throw new Error('Every contribution must be attributed to a Member, Non-Member, or Event.');
    }
    if (normalizedMemberId && !db.prepare('SELECT id FROM members WHERE id = ?').get(normalizedMemberId)) {
      throw new Error('Selected member does not exist.');
    }
    if (normalizedCampaignId && !db.prepare('SELECT id FROM campaigns WHERE id = ?').get(normalizedCampaignId)) {
      throw new Error('Selected campaign does not exist.');
    }
    if (normalizedEventId && !db.prepare('SELECT id FROM events WHERE id = ?').get(normalizedEventId)) {
      throw new Error('Selected event does not exist.');
    }

    return {
      memberId: normalizedMemberId,
      campaignId: normalizedCampaignId,
      eventId: normalizedEventId,
      contributorType: normalizedContributorType || (normalizedMemberId ? 'MEMBER' : (normalizedCampaignId ? 'CAMPAIGN_REVENUE' : (normalizedEventId ? 'EVENT_REVENUE' : 'NON_MEMBER'))),
    };
  };

  app.post('/webhook/stripe', async (req, res) => {
    try {
      const event = req.body;
      if (!event || !event.type) {
        res.sendStatus(400);
        return;
      }

      if (event.type === 'checkout.session.completed') {
        const session = event.data?.object || {};
        const metadata = session.metadata || {};
        const memberId = metadata.memberId ? Number(metadata.memberId) : null;
        const orgId = metadata.orgId ? Number(metadata.orgId) : 1;
        const campaignId = metadata.campaignId ? Number(metadata.campaignId) : null;
        const eventId = metadata.eventId ? Number(metadata.eventId) : null;
        const amountCents = Number(session.amount_total ?? 0);
        const normalizeTransactionType = (value) => {
          const t = String(value || '').trim().toUpperCase();
          if (!t) return 'DONATION';
          if (t === 'DUES' || t === 'DUES_PAYMENT' || t === 'RECEIPT' || t === 'INVOICE') return 'DUES';
          if (t === 'DONATION' || t === 'CONTRIBUTION') return 'DONATION';
          if (t === 'CAMPAIGN_CONTRIBUTION' || t === 'CAMPAIGN_REVENUE') return 'CAMPAIGN_CONTRIBUTION';
          if (t === 'EVENT_REVENUE') return 'EVENT_REVENUE';
          if (t === 'OTHER_INCOME') return 'OTHER_INCOME';
          return 'DONATION';
        };
        const resolveTransactionType = ({ memberId, campaignId, eventId, inputType }) => {
          if (campaignId) return 'CAMPAIGN_CONTRIBUTION';
          if (eventId) return 'EVENT_REVENUE';
          const normalized = normalizeTransactionType(inputType);
          if (memberId) return normalized === 'DUES' ? 'DUES' : 'DONATION';
          return normalized;
        };
        const mapTransactionTypeToLegacyType = (transactionType) => {
          const t = normalizeTransactionType(transactionType);
          return t === 'DUES' ? 'dues' : 'donation';
        };
        const txnType = resolveTransactionType({ memberId, campaignId, eventId, inputType: metadata.type || metadata.transaction_type || 'DUES' });
        const legacyType = mapTransactionTypeToLegacyType(txnType);

        if (amountCents > 0) {
          const attribution = validateAttribution({ memberId, campaignId, eventId, contributorType: metadata.contributorType });
          db.prepare(`
            INSERT INTO transactions (
              type,
              transaction_type,
              amount_cents,
              occurred_on,
              member_id,
              event_id,
              campaign_id,
              contributor_type,
              note,
              organization_id,
              payment_method,
              status,
              source,
              reference,
              is_deleted
            )
            VALUES (?, ?, ?, date('now'), ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 'STRIPE', ?, 0)
          `).run(
            legacyType,
            txnType,
            amountCents,
            attribution.memberId,
            attribution.eventId,
            attribution.campaignId,
            attribution.contributorType,
            'Stripe Payment',
            orgId,
            'STRIPE',
            session.id || null
          );

          if (typeof sendReceiptEmail === 'function') {
            await sendReceiptEmail({
              memberId: attribution.memberId,
              orgId,
              amountCents,
              provider: 'Stripe',
              note: 'Stripe Payment',
            });
          }
        }
      }

      res.sendStatus(200);
    } catch (err) {
      console.error('Stripe webhook handler error:', err);
      res.sendStatus(500);
    }
  });
}

module.exports = { registerStripeWebhook };
