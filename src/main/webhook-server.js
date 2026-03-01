const express = require('express');
const bodyParser = require('body-parser');
const { getStripe } = require('./stripe-client.js');
const { getDatabase } = require('./db.js');

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function parseStripeEvent(req) {
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    throw new Error('Missing Stripe signature');
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('Missing STRIPE_WEBHOOK_SECRET');
  }
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(req.body, sig, secret);
}

function startWebhookServer() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn('Stripe webhook server not started: STRIPE_SECRET_KEY is not set.');
    return;
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('Stripe webhook server not started: STRIPE_WEBHOOK_SECRET is not set.');
    return;
  }
  const app = express();
  const db = getDatabase();
  if (!db) {
    throw new Error('Database not initialized');
  }

  const getOrgName = (orgId = 1) => {
    try {
      const row = db.prepare('SELECT name FROM organization WHERE id = ?').get(orgId);
      return row?.name || 'Civicflow';
    } catch (_) {
      return 'Civicflow';
    }
  };

  const toOptionalPositiveId = (value) => {
    if (value == null || value === '') return null;
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized <= 0) return null;
    return normalized;
  };

  const validateAttribution = ({ memberId, campaignId, eventId, contributorType, contributorName }) => {
    const normalizedMemberId = toOptionalPositiveId(memberId);
    const normalizedCampaignId = toOptionalPositiveId(campaignId);
    const normalizedEventId = toOptionalPositiveId(eventId);
    const normalizedContributorType = String(contributorType || '').trim().toUpperCase();
    const normalizedContributorName = String(contributorName || '').trim() || null;

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
    const resolvedContributorType = normalizedContributorType || (normalizedMemberId ? 'MEMBER' : (normalizedCampaignId ? 'CAMPAIGN_REVENUE' : (normalizedEventId ? 'EVENT_REVENUE' : 'NON_MEMBER')));
    return {
      memberId: normalizedMemberId,
      campaignId: normalizedCampaignId,
      eventId: normalizedEventId,
      contributorType: resolvedContributorType,
      contributorName: normalizedContributorName,
    };
  };

  const resolveContributorType = ({ memberId, campaignId, eventId }) => {
    if (memberId) return 'MEMBER';
    if (campaignId) return 'CAMPAIGN_REVENUE';
    if (eventId) return 'EVENT_REVENUE';
    return 'NON_MEMBER';
  };

  const queueReceiptEmail = ({ memberId, orgId, amountCents, method }) => {
    try {
      if (!memberId) return;
      const member = db.prepare('SELECT first_name, last_name, email FROM members WHERE id = ?').get(memberId);
      const to = (member?.email || '').toString().trim();
      if (!to) return;
      const orgName = getOrgName(orgId);
      const name = [member?.first_name, member?.last_name].filter(Boolean).join(' ').trim();
      const subject = `${orgName} Payment Receipt`;
      const amountDollars = ((amountCents ?? 0) / 100).toFixed(2);
      const bodyText = `Hello${name ? ' ' + name : ''},\n\nPayment of $${amountDollars} recorded via ${method}.\n\nThank you,\n${orgName}\n`;
      const safeName = escapeHtml(name || 'there');
      const bodyHtml = `<p>Hello ${safeName},</p><p>Payment of <strong>$${amountDollars}</strong> recorded via <strong>${escapeHtml(method)}</strong>.</p><p>Thank you,<br>${escapeHtml(orgName)}</p>`;

      db.prepare(`
        INSERT INTO email_outbox (email_type, to_emails, subject, body_html, body_text, attachments_json, status)
        VALUES ('RECEIPT', ?, ?, ?, ?, NULL, 'QUEUED')
      `).run(to, subject, bodyHtml, bodyText);
    } catch (err) {
      console.error('Receipt queue failed (webhook):', err);
    }
  };

  app.post('/webhook/stripe', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    let event;
    try {
      event = parseStripeEvent(req);
    } catch (err) {
      console.error('Webhook signature verification failed:', err?.message || err);
      return res.status(400).send(`Webhook Error: ${err?.message || 'Invalid signature'}`);
    }

    const updateAutopayBySubscriptionId = (subscriptionId, status, options = {}) => {
      if (!subscriptionId || !status) return;
      const fields = ['autopay_status = ?', "autopay_updated_at = datetime('now')"];
      const values = [status];
      if (options.clearSubscriptionId) {
        fields.push('stripe_subscription_id = NULL');
      }
      if (options.orgId) {
        values.push(options.orgId, subscriptionId);
        db.prepare(`UPDATE members SET ${fields.join(', ')} WHERE organization_id = ? AND stripe_subscription_id = ?`).run(...values);
      } else {
        values.push(subscriptionId);
        db.prepare(`UPDATE members SET ${fields.join(', ')} WHERE stripe_subscription_id = ?`).run(...values);
      }
    };

    const deriveAutopayStatus = (subscription) => {
      if (!subscription) return null;
      if (subscription.status === 'canceled' || subscription.canceled_at) return 'CANCELED';
      if (subscription.pause_collection) return 'PAUSED';
      if (subscription.cancel_at_period_end) return 'CANCELING';
      if (subscription.status === 'active') return 'ACTIVE';
      return null;
    };

    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object || {};
      if (session.mode === 'subscription') {
        let metadata = session.subscription_details?.metadata || session.metadata || {};
        let subscriptionId = session.subscription || null;
        if (!metadata.memberId && session.id) {
          try {
            const stripe = getStripe();
            const fullSession = await stripe.checkout.sessions.retrieve(session.id, { expand: ['subscription'] });
            subscriptionId = subscriptionId || fullSession?.subscription?.id || null;
            metadata = fullSession?.subscription?.metadata || metadata;
          } catch (err) {
            console.error('Failed to retrieve subscription metadata:', err?.message || err);
          }
        }
        const memberId = metadata.memberId ? Number(metadata.memberId) : null;
        const orgId = metadata.orgId ? Number(metadata.orgId) : 1;
        if (memberId && subscriptionId) {
          db.prepare(`
            UPDATE members
            SET stripe_subscription_id = ?, autopay_status = 'ACTIVE', autopay_updated_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ? AND organization_id = ?
          `).run(subscriptionId, memberId, orgId);
        }
        return res.sendStatus(200);
      }
      const metadata = session.metadata || {};
      const orgId = metadata.orgId ? Number(metadata.orgId) : 1;
      const memberId = metadata.memberId ? Number(metadata.memberId) : null;
      const campaignId = metadata.campaignId ? Number(metadata.campaignId) : null;
      const eventId = metadata.eventId ? Number(metadata.eventId) : null;
      const contributorName = (metadata.contributorName || '').toString().trim() || null;
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
        const attribution = validateAttribution({ memberId, campaignId, eventId, contributorType: metadata.contributorType, contributorName });
        const result = db.prepare(`
          INSERT INTO transactions (
            type,
            transaction_type,
            amount_cents,
            occurred_on,
            member_id,
            contributor_type,
            contributor_name,
            event_id,
            campaign_id,
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
          attribution.contributorType,
          attribution.contributorName,
          attribution.eventId,
          attribution.campaignId,
          'Stripe Payment',
          orgId,
          'STRIPE',
          session.id || null
        );
        if (result?.lastInsertRowid) {
          queueReceiptEmail({ memberId: attribution.memberId, orgId, amountCents, method: 'STRIPE' });
        }
      }
    }

    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data?.object || {};
      const metadata =
        invoice.subscription_details?.metadata ||
        invoice.lines?.data?.[0]?.metadata ||
        {};
      const orgId = metadata.orgId ? Number(metadata.orgId) : 1;
      const memberId = metadata.memberId ? Number(metadata.memberId) : null;
      const amountCents = Number(invoice.amount_paid ?? 0);
      if (amountCents > 0) {
        const attribution = validateAttribution({ memberId, campaignId: null, eventId: null, contributorType: 'MEMBER' });
        const result = db.prepare(`
          INSERT INTO transactions (
            type,
            transaction_type,
            amount_cents,
            occurred_on,
            member_id,
            contributor_type,
            note,
            organization_id,
            payment_method,
            status,
            source,
            reference,
            is_deleted
          )
          VALUES (?, ?, ?, date('now'), ?, ?, ?, ?, ?, 'COMPLETED', 'STRIPE', ?, 0)
        `).run(
          'dues',
          'DUES',
          amountCents,
          attribution.memberId,
          attribution.contributorType,
          'Stripe Subscription Payment',
          orgId,
          'STRIPE',
          invoice.id || null
        );
        if (result?.lastInsertRowid) {
          queueReceiptEmail({ memberId: attribution.memberId, orgId, amountCents, method: 'STRIPE' });
        }
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data?.object || {};
      const status = deriveAutopayStatus(subscription);
      const orgId = subscription?.metadata?.orgId ? Number(subscription.metadata.orgId) : null;
      updateAutopayBySubscriptionId(subscription.id, status, { orgId });
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data?.object || {};
      const orgId = subscription?.metadata?.orgId ? Number(subscription.metadata.orgId) : null;
      updateAutopayBySubscriptionId(subscription.id, 'CANCELED', { clearSubscriptionId: true, orgId });
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data?.object || {};
      const subscriptionId = invoice.subscription || null;
      const orgId = invoice.subscription_details?.metadata?.orgId
        ? Number(invoice.subscription_details.metadata.orgId)
        : null;
      if (subscriptionId) {
        updateAutopayBySubscriptionId(subscriptionId, 'PAUSED', { orgId });
      }
    }

    return res.sendStatus(200);
  });

  const port = Number(process.env.STRIPE_WEBHOOK_PORT || 4242);
  app.listen(port, () => {
    console.log(`Stripe webhook server running on http://localhost:${port}`);
  });
}

module.exports = { startWebhookServer };
