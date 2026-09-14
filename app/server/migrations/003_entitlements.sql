-- Paid entitlements and referral attribution. The server is the authority
-- on what a user has paid for; store adapters (RevenueCat, Stripe, App Store
-- Server Notifications) post normalised events to /api/billing/webhook.

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by text REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS entitlements (
  user_id    text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier       text NOT NULL,
  source     text NOT NULL DEFAULT 'demo',
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency for webhooks: each provider event id is applied once.
CREATE TABLE IF NOT EXISTS billing_events (
  event_id    text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
