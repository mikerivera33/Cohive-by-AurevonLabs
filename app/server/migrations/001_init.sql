-- Cohive schema v1. Applied by server/db.mjs in filename order.

CREATE TABLE IF NOT EXISTS users (
  id             text PRIMARY KEY,
  email          text NOT NULL UNIQUE,
  name           text NOT NULL,
  salt           text,
  hash           text,
  provider       text,
  contact        text,
  oauth_verified boolean NOT NULL DEFAULT false,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS magic_links (
  token_hash text PRIMARY KEY,
  email      text NOT NULL,
  name       text,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

CREATE TABLE IF NOT EXISTS trips (
  id         text PRIMARY KEY,
  owner_id   text REFERENCES users(id) ON DELETE SET NULL,
  name       text NOT NULL,
  city       text NOT NULL DEFAULT '',
  country    text NOT NULL DEFAULT '',
  start_date text NOT NULL,
  days       integer NOT NULL,
  pace       text NOT NULL,
  start_hour integer NOT NULL,
  end_hour   integer NOT NULL,
  budget     numeric(14,2) NOT NULL DEFAULT 0,
  currency   text NOT NULL DEFAULT 'USD',
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- member_id is the stable ledger key; user_id binds it to an account
-- (NULL while an invite placeholder is still unclaimed).
CREATE TABLE IF NOT EXISTS trip_members (
  trip_id   text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id text NOT NULL,
  user_id   text REFERENCES users(id) ON DELETE SET NULL,
  name      text NOT NULL,
  color     text NOT NULL,
  role      text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, member_id)
);
CREATE INDEX IF NOT EXISTS trip_members_user_idx ON trip_members(user_id);

CREATE TABLE IF NOT EXISTS spots (
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  id      integer NOT NULL,
  data    jsonb NOT NULL,
  PRIMARY KEY (trip_id, id)
);

CREATE TABLE IF NOT EXISTS votes (
  trip_id text NOT NULL,
  spot_id integer NOT NULL,
  user_id text NOT NULL,
  tier    text NOT NULL,
  at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, spot_id, user_id),
  FOREIGN KEY (trip_id, spot_id) REFERENCES spots(trip_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expenses (
  id         bigserial PRIMARY KEY,
  trip_id    text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  label      text NOT NULL,
  category   text NOT NULL,
  amount     numeric(12,2) NOT NULL,
  paid_by    text,
  split_with jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_trip_idx ON expenses(trip_id);

CREATE TABLE IF NOT EXISTS fund_entries (
  id        bigserial PRIMARY KEY,
  trip_id   text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id text NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('contribution', 'withdrawal')),
  amount    numeric(12,2) NOT NULL CHECK (amount > 0),
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fund_entries_trip_idx ON fund_entries(trip_id);

CREATE TABLE IF NOT EXISTS invites (
  code       text PRIMARY KEY,
  trip_id    text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id  text,
  created_by text,
  expires_at timestamptz NOT NULL,
  max_uses   integer NOT NULL DEFAULT 1,
  uses       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invites_trip_idx ON invites(trip_id);
