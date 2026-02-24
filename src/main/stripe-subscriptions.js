const { getStripe } = require('./stripe-client.js');

async function pauseSubscription(subscriptionId) {
  const stripe = getStripe();
  return stripe.subscriptions.update(subscriptionId, {
    pause_collection: { behavior: 'mark_uncollectible' },
  });
}

async function resumeSubscription(subscriptionId) {
  const stripe = getStripe();
  return stripe.subscriptions.update(subscriptionId, {
    pause_collection: null,
  });
}

async function cancelSubscriptionAtPeriodEnd(subscriptionId) {
  const stripe = getStripe();
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
}

async function cancelSubscriptionNow(subscriptionId) {
  const stripe = getStripe();
  return stripe.subscriptions.cancel(subscriptionId);
}

module.exports = {
  pauseSubscription,
  resumeSubscription,
  cancelSubscriptionAtPeriodEnd,
  cancelSubscriptionNow,
};
