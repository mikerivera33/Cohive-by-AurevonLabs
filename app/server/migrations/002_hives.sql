-- Hives become the membership unit: trips, Nest listings and Table entries
-- belong to a hive; members and invites attach to the hive.

CREATE TABLE IF NOT EXISTS hives (
  id         text PRIMARY KEY,
  owner_id   text REFERENCES users(id) ON DELETE SET NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hive_members (
  hive_id   text NOT NULL REFERENCES hives(id) ON DELETE CASCADE,
  member_id text NOT NULL,
  user_id   text REFERENCES users(id) ON DELETE SET NULL,
  name      text NOT NULL,
  color     text NOT NULL,
  role      text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hive_id, member_id)
);
CREATE INDEX IF NOT EXISTS hive_members_user_idx ON hive_members(user_id);

ALTER TABLE trips ADD COLUMN IF NOT EXISTS hive_id text REFERENCES hives(id) ON DELETE CASCADE;

-- Backfill: every pre-hive trip becomes its own hive with the same id and members.
INSERT INTO hives (id, owner_id, name)
  SELECT id, owner_id, name FROM trips WHERE hive_id IS NULL
  ON CONFLICT (id) DO NOTHING;
INSERT INTO hive_members (hive_id, member_id, user_id, name, color, role, joined_at)
  SELECT trip_id, member_id, user_id, name, color, role, joined_at FROM trip_members
  ON CONFLICT DO NOTHING;
UPDATE trips SET hive_id = id WHERE hive_id IS NULL;
ALTER TABLE trips ALTER COLUMN hive_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS trips_hive_idx ON trips(hive_id);

ALTER TABLE invites ADD COLUMN IF NOT EXISTS hive_id text REFERENCES hives(id) ON DELETE CASCADE;
UPDATE invites SET hive_id = trip_id WHERE hive_id IS NULL;
ALTER TABLE invites ALTER COLUMN hive_id SET NOT NULL;
ALTER TABLE invites ALTER COLUMN trip_id DROP NOT NULL;

DROP TABLE IF EXISTS trip_members;

CREATE TABLE IF NOT EXISTS listings (
  id         bigserial PRIMARY KEY,
  hive_id    text NOT NULL REFERENCES hives(id) ON DELETE CASCADE,
  data       jsonb NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_hive_idx ON listings(hive_id);

CREATE TABLE IF NOT EXISTS restaurants (
  id         bigserial PRIMARY KEY,
  hive_id    text NOT NULL REFERENCES hives(id) ON DELETE CASCADE,
  data       jsonb NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurants_hive_idx ON restaurants(hive_id);
