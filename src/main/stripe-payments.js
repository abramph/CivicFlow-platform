const { getStripe } = require('./stripe-client.js');
const { getDatabase } = require('./db.js');

function getAppBaseUrl() {
  return process.env.APP_BASE_URL || 'https://civicflow.app';
}

function getOrgStripeAccountId(db, orgId) {
  const row = db.prepare('SELECT stripe_account_id FROM organization WHERE id = ?').get(orgId);
  return row?.stripe_account_id || null;
}

const ORG_LEVEL_TYPES = new Set(['DONATION', 'CAMPAIGN_CONTRIBUTION', 'EVENT_REVENUE', 'OTHER_INCOME']);

function normalizeTransactionType(value) {
  const t = String(value || '').trim().toUpperCase();
  if (!t) return 'DONATION';
  if (t === 'DUES' || t === 'DUES_PAYMENT' || t === 'RECEIPT' || t === 'INVOICE') return 'DUES';
  if (t === 'DONATION' || t === 'CONTRIBUTION') return 'DONATION';
  if (t === 'CAMPAIGN_CONTRIBUTION' || t === 'CAMPAIGN_REVENUE') return 'CAMPAIGN_CONTRIBUTION';
  if (t === 'EVENT_REVENUE') return 'EVENT_REVENUE';
  if (t === 'OTHER_INCOME') return 'OTHER_INCOME';
  return 'DONATION';
}

async function createCheckoutSession({ orgId = 1, memberId, amount, description, type, campaignId, eventId, contributorName, contributorType }) {
  const db = getDatabase();
  if (!db) throw new Error('Database not initialized');
  const normalizedType = normalizeTransactionType(type);
  const normalizedContributorType = String(contributorType || '').trim().toUpperCase();
  const allowNonMember = (normalizedContributorType && normalizedContributorType !== 'MEMBER') || !!campaignId || !!eventId;
  if (!memberId && !ORG_LEVEL_TYPES.has(normalizedType) && !allowNonMember) {
    throw new Error('Member ID is required for this transaction type');
  }
  const stripe = getStripe();

  const destination = getOrgStripeAccountId(db, orgId);
  if (!destination) {
    return { error: 'Organization not connected to Stripe' };
  }

  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('Payment amount must be greater than 0');
  }

  const amountCents = Math.round(normalizedAmount * 100);
  const feeAmount = Math.round(normalizedAmount * 0.01 * 100);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card', 'us_bank_account'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: description || 'Membership Dues' },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      ...(feeAmount > 0 ? { application_fee_amount: feeAmount } : {}),
      transfer_data: { destination },
    },
    metadata: {
      orgId: String(orgId),
      memberId: memberId ? String(memberId) : '',
      type: normalizedType,
      transaction_type: normalizedType,
      campaignId: campaignId ? String(campaignId) : '',
      eventId: eventId ? String(eventId) : '',
      contributorName: contributorName ? String(contributorName) : '',
      contributorType: normalizedContributorType || '',
    },
    success_url: `${getAppBaseUrl()}/payment-success`,
    cancel_url: `${getAppBaseUrl()}/payment-cancel`,
  });

  return { url: session.url };
}

async function createSubscriptionCheckout({ orgId = 1, memberId, amount, interval }) {
  const db = getDatabase();
  if (!db) throw new Error('Database not initialized');
  const stripe = getStripe();

  const destination = getOrgStripeAccountId(db, orgId);
  if (!destination) {
    return { error: 'Organization not connected to Stripe' };
  }

  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('Payment amount must be greater than 0');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card', 'us_bank_account'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          recurring: {
            interval: interval || 'month',
          },
          product_data: {
            name: 'Membership Dues (AutoPay)',
          },
          unit_amount: Math.round(normalizedAmount * 100),
        },
        quantity: 1,
      },
    ],
    subscription_data: {
      metadata: {
        orgId: String(orgId),
        memberId: memberId ? String(memberId) : '',
        type: 'DUES',
        transaction_type: 'DUES',
      },
      application_fee_percent: 1.0,
      transfer_data: {
        destination,
      },
    },
    success_url: `${getAppBaseUrl()}/payment-success`,
    cancel_url: `${getAppBaseUrl()}/payment-cancel`,
  });

  return { url: session.url };
}

module.exports = {
  createCheckoutSession,
  createSubscriptionCheckout,
};
