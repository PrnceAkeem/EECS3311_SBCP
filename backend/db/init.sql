CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  service TEXT NOT NULL,
  price TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  consultant_name TEXT NOT NULL,
  booking_date DATE NOT NULL,
  booking_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested', 'Confirmed', 'Pending Payment', 'Rejected', 'Cancelled', 'Paid', 'Completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT 'client'
  
);

CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);


--PAYMENTS TABLE (MAIN)
CREATE TABLE IF NOT EXISTS payments (
  payment_id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL,
  transaction_id TEXT UNIQUE NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('credit_card','debit_card','paypal','bank_transfer')),
  amount TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);


--CREDIT CARD PAYMENTS

CREATE TABLE IF NOT EXISTS credit_card_payments (
  id SERIAL PRIMARY KEY,
  payment_id INT UNIQUE,
  card_number TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  cvv TEXT NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(payment_id)
);


--DEBIT CARD PAYMENTS
CREATE TABLE IF NOT EXISTS debit_card_payments (
  id SERIAL PRIMARY KEY,
  payment_id INT UNIQUE,
  card_number TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  cvv TEXT NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(payment_id)
);

--PAYPAL PAYMENTS
CREATE TABLE IF NOT EXISTS paypal_payments (
  id SERIAL PRIMARY KEY,
  payment_id INT UNIQUE,
  paypal_email TEXT NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(payment_id)
);


--BANK TRANSFER PAYMENTS
CREATE TABLE IF NOT EXISTS bank_transfer_payments (
  id SERIAL PRIMARY KEY,
  payment_id INT UNIQUE,
  account_number TEXT NOT NULL,
  routing_number TEXT NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(payment_id)
);