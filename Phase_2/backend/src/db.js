// db.js — database connection, schema setup, and retry logic.

const { Pool } = require("pg");
const { DATABASE_URL, STATUS_SQL } = require("./config");

const pool = new Pool({ connectionString: DATABASE_URL });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDbRetries(maxRetries, retryDelayMs, fn) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      console.log(`DB not ready (attempt ${attempt}/${maxRetries}), retrying in ${retryDelayMs}ms...`);
      await wait(retryDelayMs);
    }
  }
}

async function ensureSchema() {
  // Core bookings table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id              SERIAL PRIMARY KEY,
      service         TEXT NOT NULL,
      price           TEXT NOT NULL,
      client_name     TEXT NOT NULL,
      client_email    TEXT NOT NULL,
      consultant_name TEXT NOT NULL,
      booking_date    DATE NOT NULL,
      booking_time    TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'Requested',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by      TEXT NOT NULL DEFAULT 'client'
    )`);

  // Keep the status CHECK constraint in sync with STATUS_VALUES
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_status_check' AND conrelid = 'bookings'::regclass)
      THEN ALTER TABLE bookings DROP CONSTRAINT bookings_status_check; END IF;
    END $$;`);
  await pool.query(`ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (${STATUS_SQL}))`);

  // Add columns introduced after initial release
  for (const sql of [
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_ref            TEXT",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_id            TEXT",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status         TEXT",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_transaction_id TEXT",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_processed_at   TIMESTAMPTZ",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_transaction_id  TEXT",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_processed_at    TIMESTAMPTZ"
  ]) await pool.query(sql);

  // Back-fill canonical IDs
  await pool.query(`
    UPDATE bookings SET booking_ref = 'bk_' || id, customer_id = 'cu_' || id
    WHERE booking_ref IS DISTINCT FROM ('bk_' || id)
       OR customer_id IS DISTINCT FROM ('cu_' || id)`);

  // Back-fill payment transaction IDs
  await pool.query(`
    UPDATE bookings
    SET payment_transaction_id = (COALESCE(NULLIF(split_part(payment_transaction_id,'-',1),''),'PAY') || '-' || LPAD(id::text,6,'0')),
        payment_processed_at   = COALESCE(payment_processed_at, updated_at, created_at)
    WHERE payment_status IN ('Success','Refunded')
      AND payment_transaction_id IS DISTINCT FROM
          (COALESCE(NULLIF(split_part(payment_transaction_id,'-',1),''),'PAY') || '-' || LPAD(id::text,6,'0'))`);

  // Back-fill refund transaction IDs
  await pool.query(`
    UPDATE bookings
    SET refund_transaction_id = 'RF-' || LPAD(id::text,6,'0'),
        refund_processed_at   = COALESCE(refund_processed_at, updated_at, created_at)
    WHERE payment_status = 'Refunded'
      AND refund_transaction_id IS DISTINCT FROM ('RF-' || LPAD(id::text,6,'0'))`);

  // Availability slots table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS availability_slots (
      id              SERIAL PRIMARY KEY,
      consultant_name TEXT NOT NULL,
      slot_date       DATE NOT NULL,
      slot_time       TEXT NOT NULL,
      is_available    BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_availability_unique ON availability_slots(consultant_name, slot_date, slot_time)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC)`);
}

module.exports = { pool, ensureSchema, withDbRetries };
