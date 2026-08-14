-- CONNECT-B: Unestra Demo Church is a permanent synthetic demo asset (same
-- convention as the reviewer demo orgs, migration 20260813023000). Billing
-- exemption removes the trial wall AND authorizes TEST-MODE Stripe Connect
-- onboarding for this org (stripe-connect.ts restricts test mode to
-- billing-exempt organizations).
UPDATE "Organization"
SET "billingExempt" = true
WHERE "id" = 'cmst2aq1w0009762ygnxlsmfn'
  AND "slug" = 'demo-church';
