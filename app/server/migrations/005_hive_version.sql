-- Live updates: a per-hive change counter the clients poll.
ALTER TABLE hives ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0;
ALTER TABLE hives ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
