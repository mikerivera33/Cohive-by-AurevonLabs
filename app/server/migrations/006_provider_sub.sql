-- Identity hardening: the provider's stable subject id keys OAuth accounts
-- (Apple omits the email on repeat sign-ins); one account per provider subject.
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_sub text;
CREATE UNIQUE INDEX IF NOT EXISTS users_provider_sub_idx ON users (provider, provider_sub) WHERE provider_sub IS NOT NULL;
