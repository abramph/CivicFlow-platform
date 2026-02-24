const { getStripe } = require('./stripe-client.js');
const { getDatabase } = require('./db.js');
const { info } = require('./logger.js');

function getAppBaseUrl() {
  return process.env.APP_BASE_URL || 'https://civicflow.app';
}

async function createConnectAccount(orgId = 1, orgEmail = null) {
  const db = getDatabase();
  if (!db) throw new Error('Database not initialized');
  const stripe = getStripe();

  const account = await stripe.accounts.create({
    type: 'express',
    email: orgEmail || undefined,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });

  db.prepare('UPDATE organization SET stripe_account_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    account.id,
    orgId
  );

  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: `${getAppBaseUrl()}/reauth`,
    return_url: `${getAppBaseUrl()}/success`,
    type: 'account_onboarding',
  });

  info('Stripe Connect onboarding created for org', orgId, account.id);
  return { url: accountLink.url, accountId: account.id };
}

module.exports = { createConnectAccount };
