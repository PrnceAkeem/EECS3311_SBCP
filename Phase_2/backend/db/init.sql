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

CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_availability_date ON availability_slots(slot_date, slot_time);
