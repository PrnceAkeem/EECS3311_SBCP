-- Initial database schema for Synergy Consulting Platform.
-- This file runs once when the PostgreSQL container is first created.
-- server.js also runs ensureSchema() on every startup to keep
-- the table and its columns up to date.

CREATE TABLE IF NOT EXISTS bookings (
  id                     SERIAL PRIMARY KEY,
  booking_ref            TEXT,
  customer_id            TEXT,
  service                TEXT NOT NULL,
  price                  TEXT NOT NULL,
  client_name            TEXT NOT NULL,
  client_email           TEXT NOT NULL,
  consultant_name        TEXT NOT NULL,
  booking_date           DATE NOT NULL,
  booking_time           TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'Requested'
                           CHECK (status IN (
                             'Requested', 'Confirmed', 'Pending Payment',
                             'Paid', 'Completed', 'Rejected', 'Cancelled'
                           )),
  payment_status         TEXT,
  payment_transaction_id TEXT,
  payment_processed_at   TIMESTAMPTZ,
  refund_transaction_id  TEXT,
  refund_processed_at    TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by             TEXT NOT NULL DEFAULT 'client'
);

CREATE TABLE IF NOT EXISTS availability_slots (
  id              SERIAL PRIMARY KEY,
  consultant_name TEXT NOT NULL,
  slot_date       DATE NOT NULL,
  slot_time       TEXT NOT NULL,
  is_available    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (consultant_name, slot_date, slot_time)
);

CREATE TABLE IF NOT EXISTS consultants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '',
  expertise  TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consultants_name_unique
  ON consultants(LOWER(name));

CREATE UNIQUE INDEX IF NOT EXISTS idx_consultants_email_unique
  ON consultants(LOWER(email))
  WHERE email <> '';

CREATE TABLE IF NOT EXISTS expertise_options (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_expertise_options_name_unique
  ON expertise_options(LOWER(name));

CREATE TABLE IF NOT EXISTS customers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_unique
  ON customers(LOWER(email));

CREATE TABLE IF NOT EXISTS payment_methods (
  id         TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  type       TEXT NOT NULL,
  label      TEXT NOT NULL,
  details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_customer_id
  ON payment_methods(customer_id);

CREATE TABLE IF NOT EXISTS payments (
  id               SERIAL PRIMARY KEY,
  booking_id       INTEGER NOT NULL,
  customer_id      TEXT,
  payment_method_id TEXT,
  kind             TEXT NOT NULL,
  status           TEXT NOT NULL,
  amount           TEXT NOT NULL,
  transaction_id   TEXT NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transaction_unique
  ON payments(transaction_id);

CREATE INDEX IF NOT EXISTS idx_payments_booking_id
  ON payments(booking_id);

CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_availability_date ON availability_slots(slot_date, slot_time);
