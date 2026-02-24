const Stripe = require('stripe');

let stripeClient = null;

function getStripe() {
  if (stripeClient) return stripeClient;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY. Set it in the app environment to enable Stripe.');
  }
  stripeClient = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });
  return stripeClient;
}

module.exports = { getStripe };
