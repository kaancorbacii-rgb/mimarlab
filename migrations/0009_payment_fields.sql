-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: badge_requests.payment_provider/payment_token/payment_id
-- for the iyzico Checkout Form integration (bkz. src/routes/payments.js).

ALTER TABLE badge_requests ADD COLUMN payment_provider TEXT;
ALTER TABLE badge_requests ADD COLUMN payment_token TEXT;
ALTER TABLE badge_requests ADD COLUMN payment_id TEXT;
