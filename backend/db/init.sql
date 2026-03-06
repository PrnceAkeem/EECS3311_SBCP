-- Initial database schema for Synergy Consulting Platform.
-- This file runs once when the PostgreSQL container is first created.
-- server.js also runs ensureSchema() on every startup to keep
-- the table and its columns up to date.

CREATE TABLE IF NOT EXISTS bookings (
  id               SERIAL PRIMARY KEY,
  booking_ref      TEXT,
  customer_id      TEXT,
  service          TEXT NOT NULL,
  price            TEXT NOT NULL,
  client_name      TEXT NOT NULL,
  client_email     TEXT NOT NULL,
  consultant_name  TEXT NOT NULL,
  booking_date     DATE NOT NULL,
  booking_time     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'Requested'
                     CHECK (status IN (
                       'Requested', 'Confirmed', 'Pending Payment',
                       'Paid', 'Completed', 'Rejected', 'Cancelled'
                     )),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       TEXT NOT NULL DEFAULT 'client'
);

CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
