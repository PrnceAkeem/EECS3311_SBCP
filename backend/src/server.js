const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
// Google Gemini is called via the REST API — no extra package needed.

const BookingStateMachine = require("./patterns/state/BookingStateMachine");
const { PaymentStrategyFactory } = require("./patterns/strategy/PaymentStrategies");
const {
  NotificationManager,
  EmailNotifier,
  SmsNotifier,
  PushNotifier
} = require("./patterns/observer/NotificationManager");
const UserFactory = require("./patterns/factory/UserFactory");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://synergy_user:synergy_pass@localhost:5432/synergy";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const DATA_DIR = path.join(__dirname, "..", "data");
const PAYMENT_METHODS_FILE = path.join(DATA_DIR, "payment-methods.json");
const CONSULTANT_REGISTRATIONS_FILE = path.join(DATA_DIR, "consultant-registrations.json");
const CONSULTANTS_FILE = path.join(DATA_DIR, "consultants.json");
const SYSTEM_POLICIES_FILE = path.join(DATA_DIR, "system-policies.json");

const DEFAULT_POLICIES = {
  cancellationWindowHours: 24,
  pricingMultiplier: 1,
  notificationsEnabled: true,
  refundPolicy: "Paid bookings cancelled before the session are refunded automatically."
};

const DEFAULT_CONSULTANTS = [
  {
    id: "con_1",
    name: "John Smith",
    email: "john.smith@consultant.synergy.local",
    expertise: "Software Architecture",
    createdAt: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "con_2",
    name: "Angela Fox",
    email: "angela.fox@consultant.synergy.local",
    expertise: "Technical Interviews",
    createdAt: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "con_3",
    name: "Brian Flys",
    email: "brian.flys@consultant.synergy.local",
    expertise: "Career Coaching",
    createdAt: "2026-01-01T00:00:00.000Z"
  }
];

const STATUS_VALUES = [
  "Requested",
  "Confirmed",
  "Pending Payment",
  "Paid",
  "Completed",
  "Rejected",
  "Cancelled"
];
const STATUS_SQL = STATUS_VALUES.map((status) => `'${status}'`).join(", ");
const VALID_STATUSES = new Set(STATUS_VALUES);
const VALID_ACTORS = new Set(["client", "consultant", "admin", "system"]);

const ALLOWED_METHOD_TYPES = [
  "Credit Card",
  "Debit Card",
  "Bank Transfer",
  "PayPal"
];

const VALID_REGISTRATION_STATUSES = new Set(["Pending", "Approved", "Rejected"]);

const pool = new Pool({ connectionString: DATABASE_URL });
const streamClients = new Set();
const userFactory = new UserFactory();
const notificationManager = new NotificationManager();

notificationManager.attach(new EmailNotifier());
notificationManager.attach(new SmsNotifier());
notificationManager.attach(new PushNotifier());

app.use(express.json({ limit: "1mb" }));

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFile(filePath, fallbackValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function writeJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function ensureDataFiles() {
  ensureDir(DATA_DIR);

  if (!fs.existsSync(PAYMENT_METHODS_FILE)) {
    writeJsonFile(PAYMENT_METHODS_FILE, []);
  }
  if (!fs.existsSync(CONSULTANT_REGISTRATIONS_FILE)) {
    writeJsonFile(CONSULTANT_REGISTRATIONS_FILE, []);
  }
  if (!fs.existsSync(CONSULTANTS_FILE)) {
    writeJsonFile(CONSULTANTS_FILE, DEFAULT_CONSULTANTS);
  }
  if (!fs.existsSync(SYSTEM_POLICIES_FILE)) {
    writeJsonFile(SYSTEM_POLICIES_FILE, DEFAULT_POLICIES);
  }
}

function readPaymentMethods() {
  return readJsonFile(PAYMENT_METHODS_FILE, []);
}

function writePaymentMethods(methods) {
  writeJsonFile(PAYMENT_METHODS_FILE, methods);
}

function readConsultantRegistrations() {
  return readJsonFile(CONSULTANT_REGISTRATIONS_FILE, []);
}

function writeConsultantRegistrations(registrations) {
  writeJsonFile(CONSULTANT_REGISTRATIONS_FILE, registrations);
}

function readConsultants() {
  return readJsonFile(CONSULTANTS_FILE, DEFAULT_CONSULTANTS);
}

function writeConsultants(consultants) {
  writeJsonFile(CONSULTANTS_FILE, consultants);
}

function readSystemPolicies() {
  const rawPolicies = readJsonFile(SYSTEM_POLICIES_FILE, DEFAULT_POLICIES);
  return {
    ...DEFAULT_POLICIES,
    ...rawPolicies
  };
}

function writeSystemPolicies(policies) {
  writeJsonFile(SYSTEM_POLICIES_FILE, policies);
}

function toPublicPaymentMethod(method) {
  if (!method) {
    return null;
  }
  return {
    id: method.id,
    type: method.type,
    label: method.label,
    createdAt: method.createdAt,
    updatedAt: method.updatedAt || null
  };
}

function toPublicConsultant(consultant) {
  if (!consultant) {
    return null;
  }

  return {
    id: consultant.id,
    name: consultant.name,
    email: consultant.email || "",
    expertise: consultant.expertise || "general",
    createdAt: consultant.createdAt || null
  };
}

function findPaymentMethodById(methodId) {
  if (!methodId) {
    return null;
  }
  const methods = readPaymentMethods();
  return methods.find((method) => method.id === methodId) || null;
}

function sanitizeText(value, maxLen = 120) {
  return String(value || "").trim().slice(0, maxLen);
}

function sanitizeDate(value) {
  const dateText = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return dateText;
  }
  return "";
}

function sanitizeSlotTime(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");

  const match = raw.match(/^(0?[1-9]|1[0-2]):([0-5][0-9])\s(AM|PM)$/);
  if (!match) {
    return "";
  }

  const hour = String(Number(match[1])).padStart(2, "0");
  return `${hour}:${match[2]} ${match[3]}`;
}

function parseBookingDateTime(dateText, timeText) {
  const normalizedDate = sanitizeDate(dateText);
  const normalizedTime = sanitizeSlotTime(timeText);

  if (!normalizedDate || !normalizedTime) {
    return null;
  }

  const [timePart, meridian] = normalizedTime.split(" ");
  const [hh, mm] = timePart.split(":").map(Number);

  let hours = hh;
  if (meridian === "AM" && hours === 12) {
    hours = 0;
  }
  if (meridian === "PM" && hours !== 12) {
    hours += 12;
  }

  const [year, month, day] = normalizedDate.split("-").map(Number);
  return new Date(year, month - 1, day, hours, mm, 0, 0);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isFutureExpiry(expiryText) {
  const match = String(expiryText || "").trim().match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
  if (!match) {
    return false;
  }

  const expiryMonth = Number(match[1]);
  const expiryYear = 2000 + Number(match[2]);
  const expiryDate = new Date(expiryYear, expiryMonth, 0, 23, 59, 59, 999);
  return expiryDate.getTime() >= Date.now();
}

function normalizeNumericId(rawValue) {
  const numericValue = Number(rawValue);
  if (Number.isInteger(numericValue) && numericValue > 0) {
    return numericValue;
  }
  return null;
}

function buildCanonicalBookingRef(bookingId) {
  const normalizedId = normalizeNumericId(bookingId);
  return normalizedId ? `bk_${normalizedId}` : null;
}

function buildCanonicalCustomerId(bookingId) {
  const normalizedId = normalizeNumericId(bookingId);
  return normalizedId ? `cu_${normalizedId}` : null;
}

function paymentMethodPrefix(methodType) {
  if (methodType === "Credit Card") return "CC";
  if (methodType === "Debit Card") return "DC";
  if (methodType === "Bank Transfer") return "BT";
  if (methodType === "PayPal") return "PP";
  return "PAY";
}

function buildTransactionId(prefix, bookingId = null) {
  const normalizedId = normalizeNumericId(bookingId);
  if (normalizedId) {
    return `${prefix}-${String(normalizedId).padStart(6, "0")}`;
  }

  const timePart = Date.now().toString().slice(-6);
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${timePart}-${randomPart}`;
}

function parsePriceAmount(rawPrice) {
  const parsed = Number(String(rawPrice || "").replace(/[^0-9.]/g, ""));
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed.toFixed(2);
  }
  return String(rawPrice || "0");
}

function applyPricingPolicy(rawPrice, pricingMultiplier) {
  const parsed = Number(String(rawPrice || "").replace(/[^0-9.]/g, ""));
  const multiplier = Number(pricingMultiplier);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return String(rawPrice || "0");
  }
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return `$${parsed.toFixed(2)}`;
  }

  return `$${(parsed * multiplier).toFixed(2)}`;
}

function sanitizeStatus(status) {
  if (VALID_STATUSES.has(status)) {
    return status;
  }
  return "Requested";
}

function sanitizeActor(actor) {
  if (VALID_ACTORS.has(actor)) {
    return actor;
  }
  return "system";
}

function sanitizeRegistrationStatus(status) {
  const normalized = String(status || "").trim();
  if (VALID_REGISTRATION_STATUSES.has(normalized)) {
    return normalized;
  }
  return "Pending";
}

function normalizePoliciesPayload(rawPayload) {
  const payload = rawPayload || {};
  const currentPolicies = readSystemPolicies();

  let cancellationWindowHours = Number(payload.cancellationWindowHours);
  if (!Number.isFinite(cancellationWindowHours) || cancellationWindowHours < 0) {
    cancellationWindowHours = Number(currentPolicies.cancellationWindowHours);
  }

  let pricingMultiplier = Number(payload.pricingMultiplier);
  if (!Number.isFinite(pricingMultiplier) || pricingMultiplier <= 0) {
    pricingMultiplier = Number(currentPolicies.pricingMultiplier);
  }

  const rawNotifications = payload.notificationsEnabled;
  let notificationsEnabled = currentPolicies.notificationsEnabled;
  if (typeof rawNotifications === "boolean") {
    notificationsEnabled = rawNotifications;
  } else if (rawNotifications === "true") {
    notificationsEnabled = true;
  } else if (rawNotifications === "false") {
    notificationsEnabled = false;
  }

  const refundPolicy = sanitizeText(
    payload.refundPolicy || currentPolicies.refundPolicy,
    300
  );

  return {
    cancellationWindowHours: Math.min(cancellationWindowHours, 168),
    pricingMultiplier: Number(pricingMultiplier.toFixed(2)),
    notificationsEnabled,
    refundPolicy: refundPolicy || DEFAULT_POLICIES.refundPolicy
  };
}

function validatePaymentMethodPayload(input) {
  const payload = input || {};
  const type = sanitizeText(payload.type, 40);
  const details = payload.details || {};

  if (!ALLOWED_METHOD_TYPES.includes(type)) {
    return {
      error: `type must be one of: ${ALLOWED_METHOD_TYPES.join(", ")}.`
    };
  }

  if (type === "Credit Card" || type === "Debit Card") {
    const cardholderName = sanitizeText(details.cardholderName, 60);
    const cardNumber = String(details.cardNumber || "").replace(/\D/g, "");
    const expiry = String(details.expiry || "").trim();
    const cvv = String(details.cvv || "").replace(/\D/g, "");

    if (!cardholderName) {
      return { error: "Cardholder name is required." };
    }
    if (!/^\d{16}$/.test(cardNumber)) {
      return { error: "Card number must be exactly 16 digits." };
    }
    if (!isFutureExpiry(expiry)) {
      return { error: "Expiry must use MM/YY format and be a future date." };
    }
    if (!/^\d{3,4}$/.test(cvv)) {
      return { error: "CVV must be 3 or 4 digits." };
    }

    const last4 = cardNumber.slice(-4);
    const label =
      sanitizeText(payload.label, 80) || `${cardholderName} - ending in ${last4}`;

    return {
      type,
      label,
      details: {
        cardholderName,
        cardNumber,
        last4,
        expiry,
        cvv
      }
    };
  }

  if (type === "Bank Transfer") {
    const bankName = sanitizeText(details.bankName, 60);
    const accountNumber = String(details.accountNumber || "").replace(/\D/g, "");
    const routingNumber = String(details.routingNumber || "").replace(/\D/g, "");

    if (!bankName) {
      return { error: "Bank name is required for bank transfer." };
    }
    if (!/^\d{6,17}$/.test(accountNumber)) {
      return { error: "Account number must be 6 to 17 digits." };
    }
    if (!/^\d{9}$/.test(routingNumber)) {
      return { error: "Routing number must be exactly 9 digits." };
    }

    const last4 = accountNumber.slice(-4);
    const label = sanitizeText(payload.label, 80) || `${bankName} (Acct ••••${last4})`;

    return {
      type,
      label,
      details: {
        bankName,
        accountNumber,
        routingNumber,
        last4
      }
    };
  }

  if (type === "PayPal") {
    const paypalEmail = sanitizeText(details.paypalEmail, 80);
    if (!isValidEmail(paypalEmail)) {
      return { error: "A valid PayPal email is required." };
    }

    const label = sanitizeText(payload.label, 80) || paypalEmail;

    return {
      type,
      label,
      details: {
        paypalEmail
      }
    };
  }

  return { error: "Unsupported payment type." };
}

function buildUserId(role) {
  const randomPart = Math.random().toString(36).slice(2, 7);
  return `${role}-${Date.now()}-${randomPart}`;
}

function toInternalEmail(displayName, role) {
  const slug = String(displayName || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${slug || "unknown"}@${role}.synergy.local`;
}

function createBookingActors(payload) {
  const client = userFactory.createUser(
    "client",
    buildUserId("client"),
    payload.clientName,
    payload.clientEmail
  );

  const consultant = userFactory.createUser(
    "consultant",
    buildUserId("consultant"),
    payload.consultantName,
    toInternalEmail(payload.consultantName, "consultant"),
    { expertise: payload.service }
  );

  return { client, consultant };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function mapBookingRow(row) {
  if (!row) {
    return null;
  }

  const normalizedBookingId = normalizeNumericId(row.id);
  const bookingDateValue =
    row.booking_date instanceof Date
      ? row.booking_date.toISOString().slice(0, 10)
      : String(row.booking_date || "");

  return {
    id: row.id,
    bookingRef:
      buildCanonicalBookingRef(normalizedBookingId) || row.booking_ref || null,
    customerId:
      buildCanonicalCustomerId(normalizedBookingId) || row.customer_id || null,
    service: row.service,
    price: row.price,
    clientName: row.client_name,
    clientEmail: row.client_email,
    consultantName: row.consultant_name,
    bookingDate: bookingDateValue,
    bookingTime: row.booking_time,
    status: row.status,
    paymentStatus: row.payment_status || null,
    paymentTransactionId: row.payment_transaction_id || null,
    paymentProcessedAt: row.payment_processed_at || null,
    refundTransactionId: row.refund_transaction_id || null,
    refundProcessedAt: row.refund_processed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  };
}

async function ensureSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS bookings (
       id SERIAL PRIMARY KEY,
       service TEXT NOT NULL,
       price TEXT NOT NULL,
       client_name TEXT NOT NULL,
       client_email TEXT NOT NULL,
       consultant_name TEXT NOT NULL,
       booking_date DATE NOT NULL,
       booking_time TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'Requested',
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_by TEXT NOT NULL DEFAULT 'client'
     )`
  );

  await pool.query(
    `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'bookings_status_check'
           AND conrelid = 'bookings'::regclass
       ) THEN
         ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
       END IF;
     END $$;`
  );

  await pool.query(
    `ALTER TABLE bookings
     ADD CONSTRAINT bookings_status_check
     CHECK (status IN (${STATUS_SQL}))`
  );

  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_ref TEXT`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_id TEXT`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_transaction_id TEXT`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_processed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_transaction_id TEXT`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_processed_at TIMESTAMPTZ`);

  await pool.query(
    `UPDATE bookings
     SET booking_ref = 'bk_' || id,
         customer_id = 'cu_' || id
     WHERE booking_ref IS DISTINCT FROM ('bk_' || id)
        OR customer_id IS DISTINCT FROM ('cu_' || id)`
  );

  await pool.query(
    `UPDATE bookings
     SET payment_transaction_id = (
           COALESCE(NULLIF(split_part(payment_transaction_id, '-', 1), ''), 'PAY')
           || '-' || LPAD(id::text, 6, '0')
         ),
         payment_processed_at = COALESCE(payment_processed_at, updated_at, created_at)
     WHERE payment_status IN ('Success', 'Refunded')
       AND payment_transaction_id IS DISTINCT FROM (
         COALESCE(NULLIF(split_part(payment_transaction_id, '-', 1), ''), 'PAY')
         || '-' || LPAD(id::text, 6, '0')
       )`
  );

  await pool.query(
    `UPDATE bookings
     SET refund_transaction_id = 'RF-' || LPAD(id::text, 6, '0'),
         refund_processed_at = COALESCE(refund_processed_at, updated_at, created_at)
     WHERE payment_status = 'Refunded'
       AND refund_transaction_id IS DISTINCT FROM ('RF-' || LPAD(id::text, 6, '0'))`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS availability_slots (
      id SERIAL PRIMARY KEY,
      consultant_name TEXT NOT NULL,
      slot_date DATE NOT NULL,
      slot_time TEXT NOT NULL,
      is_available BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_availability_unique
     ON availability_slots(consultant_name, slot_date, slot_time)`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_bookings_created_at
     ON bookings(created_at DESC)`
  );
}

async function withDbRetries(maxRetries, retryDelayMs, fn) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }
      // eslint-disable-next-line no-console
      console.log(
        `Database not ready yet (attempt ${attempt}/${maxRetries}). Retrying in ${retryDelayMs}ms...`
      );
      await wait(retryDelayMs);
    }
  }
  return null;
}

function broadcastBookingEvent(type, booking, metadata = null) {
  const policies = readSystemPolicies();

  if (policies.notificationsEnabled) {
    notificationManager.sendNotification(`booking.${type}`, {
      bookingId: booking?.id || null,
      status: booking?.status || null,
      updatedBy: booking?.updatedBy || null,
      metadata: metadata || undefined
    });
  }

  if (!streamClients.size) {
    return;
  }

  const payload = JSON.stringify(
    metadata ? { type, booking, metadata } : { type, booking }
  );
  const eventChunk = `event: booking\ndata: ${payload}\n\n`;

  streamClients.forEach((clientResponse) => {
    clientResponse.write(eventChunk);
  });
}

app.get("/health", (_request, response) => {
  response.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/bookings", async (_request, response) => {
  try {
    const result = await pool.query(
      `SELECT
         id,
         booking_ref,
         customer_id,
         service,
         price,
         client_name,
         client_email,
         consultant_name,
         booking_date::text AS booking_date,
         booking_time,
         status,
         payment_status,
         payment_transaction_id,
         payment_processed_at,
         refund_transaction_id,
         refund_processed_at,
         created_at,
         updated_at,
         updated_by
       FROM bookings
       ORDER BY id ASC`
    );

    response.json(result.rows.map(mapBookingRow));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to fetch bookings", error);
    response.status(500).json({ error: "Failed to fetch bookings." });
  }
});

app.post("/api/bookings", async (request, response) => {
  const {
    service,
    price,
    clientName,
    clientEmail,
    consultantName,
    bookingDate,
    bookingTime
  } = request.body || {};

  const safeBookingDate = sanitizeDate(bookingDate);
  const safeBookingTime = sanitizeSlotTime(bookingTime);

  if (
    !service ||
    !price ||
    !clientName ||
    !clientEmail ||
    !consultantName ||
    !safeBookingDate ||
    !safeBookingTime
  ) {
    response.status(400).json({ error: "Missing required booking fields." });
    return;
  }

  if (!isValidEmail(clientEmail)) {
    response.status(400).json({ error: "Client email format is invalid." });
    return;
  }

  try {
    let actors;
    try {
      actors = createBookingActors({
        service,
        clientName,
        clientEmail,
        consultantName
      });
    } catch (factoryError) {
      response.status(400).json({
        error: factoryError.message || "Failed to create booking actors."
      });
      return;
    }

    const slotResult = await pool.query(
      `SELECT id, is_available
       FROM availability_slots
       WHERE consultant_name = $1
         AND slot_date = $2
         AND slot_time = $3
       LIMIT 1`,
      [actors.consultant.name, safeBookingDate, safeBookingTime]
    );

    if (!slotResult.rows.length) {
      response.status(422).json({
        error: "Selected consultant/time is not available. Please choose an available slot."
      });
      return;
    }

    if (!slotResult.rows[0].is_available) {
      response.status(409).json({
        error: "This time slot is no longer available."
      });
      return;
    }

    const conflictResult = await pool.query(
      `SELECT id
       FROM bookings
       WHERE consultant_name = $1
         AND booking_date = $2
         AND booking_time = $3
         AND status NOT IN ('Rejected', 'Cancelled', 'Completed')
       LIMIT 1`,
      [actors.consultant.name, safeBookingDate, safeBookingTime]
    );

    if (conflictResult.rows.length) {
      response.status(409).json({
        error: "Consultant is already booked for this date/time."
      });
      return;
    }

    const policies = readSystemPolicies();
    const adjustedPrice = applyPricingPolicy(price, policies.pricingMultiplier);

    const insertResult = await pool.query(
      `INSERT INTO bookings (
         service,
         price,
         client_name,
         client_email,
         consultant_name,
         booking_date,
         booking_time,
         status,
         payment_status,
         updated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Requested', NULL, 'client')
       RETURNING id`,
      [
        sanitizeText(service, 120),
        adjustedPrice,
        actors.client.name,
        actors.client.email,
        actors.consultant.name,
        safeBookingDate,
        safeBookingTime
      ]
    );

    const insertedBookingId = insertResult.rows[0].id;
    const canonicalBookingRef = buildCanonicalBookingRef(insertedBookingId);
    const canonicalCustomerId = buildCanonicalCustomerId(insertedBookingId);

    const result = await pool.query(
      `UPDATE bookings
       SET booking_ref = $1,
           customer_id = $2
       WHERE id = $3
       RETURNING
         id,
         booking_ref,
         customer_id,
         service,
         price,
         client_name,
         client_email,
         consultant_name,
         booking_date::text AS booking_date,
         booking_time,
         status,
         payment_status,
         payment_transaction_id,
         payment_processed_at,
         refund_transaction_id,
         refund_processed_at,
         created_at,
         updated_at,
         updated_by`,
      [canonicalBookingRef, canonicalCustomerId, insertedBookingId]
    );

    await pool.query(
      `UPDATE availability_slots
       SET is_available = FALSE,
           updated_at = NOW()
       WHERE id = $1`,
      [slotResult.rows[0].id]
    );

    const booking = mapBookingRow(result.rows[0]);
    const metadata = {
      pricingMultiplier: policies.pricingMultiplier
    };
    broadcastBookingEvent("created", booking, metadata);
    response.status(201).json(booking);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to create booking", error);
    response.status(500).json({ error: "Failed to create booking." });
  }
});

app.patch("/api/bookings/:id/status", async (request, response) => {
  const bookingId = Number(request.params.id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    response.status(400).json({ error: "Invalid booking id." });
    return;
  }

  const nextStatus = sanitizeStatus(request.body?.status);
  const actor = sanitizeActor(request.body?.actor);
  const paymentMethodId = request.body?.paymentMethodId;
  const paymentMethodType = request.body?.paymentMethodType;

  try {
    const currentRow = await pool.query(
      `SELECT
         status,
         price,
         consultant_name,
         booking_date::text AS booking_date,
         booking_time,
         payment_status,
         payment_transaction_id,
         payment_processed_at,
         refund_transaction_id,
         refund_processed_at
       FROM bookings
       WHERE id = $1`,
      [bookingId]
    );

    if (!currentRow.rows.length) {
      response.status(404).json({ error: "Booking not found." });
      return;
    }

    const current = currentRow.rows[0];
    const currentStatus = current.status;

    try {
      BookingStateMachine.transition(currentStatus, nextStatus);
    } catch (transitionError) {
      response.status(422).json({ error: transitionError.message });
      return;
    }

    if (nextStatus === "Cancelled" && actor === "client") {
      const policies = readSystemPolicies();
      const bookingAt = parseBookingDateTime(current.booking_date, current.booking_time);
      const minWindowMs = Number(policies.cancellationWindowHours) * 60 * 60 * 1000;

      if (
        bookingAt &&
        Number.isFinite(minWindowMs) &&
        minWindowMs > 0 &&
        bookingAt.getTime() - Date.now() < minWindowMs
      ) {
        response.status(422).json({
          error: `Cancellations must be made at least ${policies.cancellationWindowHours} hours before the session.`
        });
        return;
      }
    }

    let paymentReceipt = null;
    let refundReceipt = null;

    let nextPaymentStatus = current.payment_status || null;
    let nextPaymentTransactionId = current.payment_transaction_id || null;
    let nextPaymentProcessedAt = current.payment_processed_at || null;
    let nextRefundTransactionId = current.refund_transaction_id || null;
    let nextRefundProcessedAt = current.refund_processed_at || null;

    if (nextStatus === "Pending Payment") {
      nextPaymentStatus = "Pending";
      nextPaymentTransactionId = null;
      nextPaymentProcessedAt = null;
      nextRefundTransactionId = null;
      nextRefundProcessedAt = null;
    }

    if (nextStatus === "Paid") {
      if (!paymentMethodType || !paymentMethodId) {
        response.status(400).json({
          error: "paymentMethodType and paymentMethodId are required when paying."
        });
        return;
      }

      if (actor !== "client") {
        response.status(403).json({ error: "Only the client can complete payment." });
        return;
      }

      const savedMethod = findPaymentMethodById(paymentMethodId);
      if (!savedMethod) {
        response.status(400).json({ error: "Selected payment method was not found." });
        return;
      }

      if (savedMethod.type !== paymentMethodType) {
        response.status(400).json({
          error: "paymentMethodType does not match the saved payment method."
        });
        return;
      }

      let paymentStrategy;
      try {
        paymentStrategy = PaymentStrategyFactory.create(savedMethod.type);
      } catch (strategyError) {
        response.status(400).json({
          error: strategyError.message || "Unsupported payment method."
        });
        return;
      }

      const paymentResult = paymentStrategy.process(parsePriceAmount(current.price), {
        methodId: savedMethod.id,
        methodType: savedMethod.type,
        label: savedMethod.label,
        details: savedMethod.details || {}
      });

      if (!paymentResult.success) {
        response.status(422).json({
          error: paymentResult.message || "Payment processing failed."
        });
        return;
      }

      const canonicalPaymentTransactionId =
        current.payment_transaction_id ||
        buildTransactionId(paymentMethodPrefix(savedMethod.type), bookingId);
      const canonicalPaymentProcessedAt =
        current.payment_processed_at || new Date().toISOString();

      paymentReceipt = {
        transactionId: canonicalPaymentTransactionId,
        methodType: savedMethod.type,
        methodLabel: savedMethod.label,
        processedAt: canonicalPaymentProcessedAt
      };

      nextPaymentStatus = "Success";
      nextPaymentTransactionId = paymentReceipt.transactionId;
      nextPaymentProcessedAt = paymentReceipt.processedAt;
      nextRefundTransactionId = null;
      nextRefundProcessedAt = null;
    }

    if (currentStatus === "Paid" && nextStatus === "Cancelled") {
      const refundTransactionId =
        current.refund_transaction_id || buildTransactionId("RF", bookingId);
      const refundedAt = current.refund_processed_at || new Date().toISOString();

      refundReceipt = {
        refundTransactionId,
        refundedAt
      };

      nextPaymentStatus = "Refunded";
      nextRefundTransactionId = refundTransactionId;
      nextRefundProcessedAt = refundedAt;
    }

    const result = await pool.query(
      `UPDATE bookings
       SET
         status = $1,
         updated_at = NOW(),
         updated_by = $2,
         payment_status = $4,
         payment_transaction_id = $5,
         payment_processed_at = $6,
         refund_transaction_id = $7,
         refund_processed_at = $8
       WHERE id = $3
       RETURNING
         id,
         booking_ref,
         customer_id,
         service,
         price,
         client_name,
         client_email,
         consultant_name,
         booking_date::text AS booking_date,
         booking_time,
         status,
         payment_status,
         payment_transaction_id,
         payment_processed_at,
         refund_transaction_id,
         refund_processed_at,
         created_at,
         updated_at,
         updated_by`,
      [
        nextStatus,
        actor,
        bookingId,
        nextPaymentStatus,
        nextPaymentTransactionId,
        nextPaymentProcessedAt,
        nextRefundTransactionId,
        nextRefundProcessedAt
      ]
    );

    if (!result.rows.length) {
      response.status(404).json({ error: "Booking not found." });
      return;
    }

    if (nextStatus === "Cancelled" || nextStatus === "Rejected") {
      await pool.query(
        `UPDATE availability_slots
         SET is_available = TRUE,
             updated_at = NOW()
         WHERE consultant_name = $1
           AND slot_date = $2
           AND slot_time = $3`,
        [current.consultant_name, current.booking_date, current.booking_time]
      );
    }

    const booking = mapBookingRow(result.rows[0]);

    const metadataPayload = {};
    if (paymentReceipt) {
      metadataPayload.payment = paymentReceipt;
    }
    if (refundReceipt) {
      metadataPayload.refund = refundReceipt;
    }

    const hasMetadata = Object.keys(metadataPayload).length > 0;
    const responsePayload = {
      ...booking,
      ...(paymentReceipt ? { payment: paymentReceipt } : {}),
      ...(refundReceipt ? { refund: refundReceipt } : {})
    };

    broadcastBookingEvent(
      "updated",
      booking,
      hasMetadata ? metadataPayload : null
    );

    response.json(responsePayload);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to update booking status", error);
    response.status(500).json({ error: "Failed to update booking status." });
  }
});

app.get("/api/payment-methods", (_request, response) => {
  const methods = readPaymentMethods().map(toPublicPaymentMethod);
  response.json(methods);
});

app.post("/api/payment-methods", (request, response) => {
  const normalized = validatePaymentMethodPayload(request.body);
  if (normalized.error) {
    response.status(400).json({ error: normalized.error });
    return;
  }

  const methods = readPaymentMethods();
  const newMethod = {
    id: `pm_${Date.now()}`,
    type: normalized.type,
    label: normalized.label,
    details: normalized.details,
    createdAt: new Date().toISOString(),
    updatedAt: null
  };

  methods.push(newMethod);
  writePaymentMethods(methods);
  response.status(201).json(toPublicPaymentMethod(newMethod));
});

app.patch("/api/payment-methods/:id", (request, response) => {
  const { id } = request.params;
  const methods = readPaymentMethods();
  const index = methods.findIndex((method) => method.id === id);

  if (index === -1) {
    response.status(404).json({ error: "Payment method not found." });
    return;
  }

  const currentMethod = methods[index];
  const incoming = request.body || {};

  const isLabelOnlyUpdate =
    Object.prototype.hasOwnProperty.call(incoming, "label") &&
    !Object.prototype.hasOwnProperty.call(incoming, "type") &&
    !Object.prototype.hasOwnProperty.call(incoming, "details");

  if (isLabelOnlyUpdate) {
    currentMethod.label = sanitizeText(incoming.label, 80) || currentMethod.label;
    currentMethod.updatedAt = new Date().toISOString();
    methods[index] = currentMethod;
    writePaymentMethods(methods);
    response.json(toPublicPaymentMethod(currentMethod));
    return;
  }

  const mergedPayload = {
    type: incoming.type || currentMethod.type,
    label: Object.prototype.hasOwnProperty.call(incoming, "label")
      ? incoming.label
      : currentMethod.label,
    details: {
      ...(currentMethod.details || {}),
      ...((incoming.details && typeof incoming.details === "object") ? incoming.details : {})
    }
  };

  const normalized = validatePaymentMethodPayload(mergedPayload);
  if (normalized.error) {
    response.status(400).json({ error: normalized.error });
    return;
  }

  methods[index] = {
    ...currentMethod,
    type: normalized.type,
    label: normalized.label,
    details: normalized.details,
    updatedAt: new Date().toISOString()
  };

  writePaymentMethods(methods);
  response.json(toPublicPaymentMethod(methods[index]));
});

app.delete("/api/payment-methods/:id", (request, response) => {
  const { id } = request.params;
  const methods = readPaymentMethods();
  const idx = methods.findIndex((method) => method.id === id);

  if (idx === -1) {
    response.status(404).json({ error: "Payment method not found." });
    return;
  }

  methods.splice(idx, 1);
  writePaymentMethods(methods);
  response.status(204).end();
});

app.get("/api/consultants", (_request, response) => {
  const consultants = readConsultants()
    .map(toPublicConsultant)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  response.json(consultants);
});

app.post("/api/consultants", (request, response) => {
  const actor = sanitizeActor(request.body?.actor);
  if (actor !== "admin") {
    response.status(403).json({ error: "Only admin can add consultants." });
    return;
  }

  const name = sanitizeText(request.body?.name, 80);
  const expertise = sanitizeText(request.body?.expertise, 120) || "general";
  const email = sanitizeText(request.body?.email, 120).toLowerCase();

  if (!name) {
    response.status(400).json({ error: "Consultant name is required." });
    return;
  }

  if (email && !isValidEmail(email)) {
    response.status(400).json({ error: "Consultant email format is invalid." });
    return;
  }

  const consultants = readConsultants();
  const nameKey = name.toLowerCase();
  const emailKey = email.toLowerCase();
  const duplicate = consultants.find((consultant) => {
    const consultantName = String(consultant.name || "").trim().toLowerCase();
    const consultantEmail = String(consultant.email || "").trim().toLowerCase();
    if (consultantName && consultantName === nameKey) {
      return true;
    }
    if (emailKey && consultantEmail && consultantEmail === emailKey) {
      return true;
    }
    return false;
  });

  if (duplicate) {
    response.status(409).json({ error: "Consultant already exists." });
    return;
  }

  const consultant = {
    id: `con_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    email,
    expertise,
    createdAt: new Date().toISOString()
  };

  consultants.push(consultant);
  writeConsultants(consultants);
  response.status(201).json(toPublicConsultant(consultant));
});

app.get("/api/availability", async (request, response) => {
  const consultantName = sanitizeText(request.query.consultantName, 120);
  const bookingDate = sanitizeDate(request.query.bookingDate);

  const clauses = [];
  const values = [];

  if (consultantName) {
    values.push(consultantName);
    clauses.push(`consultant_name = $${values.length}`);
  }

  if (bookingDate) {
    values.push(bookingDate);
    clauses.push(`slot_date = $${values.length}`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  try {
    const result = await pool.query(
      `SELECT
         id,
         consultant_name,
         slot_date::text AS slot_date,
         slot_time,
         is_available,
         created_at,
         updated_at
       FROM availability_slots
       ${whereClause}
       ORDER BY slot_date ASC, slot_time ASC`,
      values
    );

    response.json(result.rows.map((row) => ({
      id: row.id,
      consultantName: row.consultant_name,
      bookingDate: row.slot_date,
      bookingTime: row.slot_time,
      isAvailable: row.is_available,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to fetch availability", error);
    response.status(500).json({ error: "Failed to fetch availability." });
  }
});

app.post("/api/availability", async (request, response) => {
  const consultantName = sanitizeText(request.body?.consultantName, 120);
  const bookingDate = sanitizeDate(request.body?.bookingDate);
  const bookingTime = sanitizeSlotTime(request.body?.bookingTime);

  if (!consultantName || !bookingDate || !bookingTime) {
    response.status(400).json({
      error: "consultantName, bookingDate, and bookingTime are required."
    });
    return;
  }

  const slotDate = parseBookingDateTime(bookingDate, bookingTime);
  if (!slotDate || slotDate.getTime() < Date.now()) {
    response.status(422).json({
      error: "Availability must be set for a future date/time."
    });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO availability_slots (
         consultant_name,
         slot_date,
         slot_time,
         is_available,
         updated_at
       )
       VALUES ($1, $2, $3, TRUE, NOW())
       ON CONFLICT (consultant_name, slot_date, slot_time)
       DO UPDATE SET
         is_available = TRUE,
         updated_at = NOW()
       RETURNING
         id,
         consultant_name,
         slot_date::text AS slot_date,
         slot_time,
         is_available,
         created_at,
         updated_at`,
      [consultantName, bookingDate, bookingTime]
    );

    const row = result.rows[0];
    response.status(201).json({
      id: row.id,
      consultantName: row.consultant_name,
      bookingDate: row.slot_date,
      bookingTime: row.slot_time,
      isAvailable: row.is_available,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to create availability slot", error);
    response.status(500).json({ error: "Failed to create availability slot." });
  }
});

app.delete("/api/availability/:id", async (request, response) => {
  const availabilityId = Number(request.params.id);
  if (!Number.isInteger(availabilityId) || availabilityId <= 0) {
    response.status(400).json({ error: "Invalid availability id." });
    return;
  }

  try {
    const result = await pool.query(
      `DELETE FROM availability_slots
       WHERE id = $1
       RETURNING id`,
      [availabilityId]
    );

    if (!result.rows.length) {
      response.status(404).json({ error: "Availability slot not found." });
      return;
    }

    response.status(204).end();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to delete availability slot", error);
    response.status(500).json({ error: "Failed to delete availability slot." });
  }
});

app.get("/api/consultants/registrations", (_request, response) => {
  const registrations = readConsultantRegistrations().sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  response.json(registrations);
});

app.post("/api/consultants/registrations", (request, response) => {
  const name = sanitizeText(request.body?.name, 80);
  const email = sanitizeText(request.body?.email, 120).toLowerCase();
  const expertise = sanitizeText(request.body?.expertise, 120) || "general";

  if (!name || !email) {
    response.status(400).json({ error: "name and email are required." });
    return;
  }
  if (!isValidEmail(email)) {
    response.status(400).json({ error: "email format is invalid." });
    return;
  }

  const registrations = readConsultantRegistrations();
  const duplicate = registrations.find((item) => item.email === email && item.status !== "Rejected");
  if (duplicate) {
    response.status(409).json({ error: "A registration already exists for this email." });
    return;
  }

  const registration = {
    id: `reg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    email,
    expertise,
    status: "Pending",
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null
  };

  registrations.push(registration);
  writeConsultantRegistrations(registrations);
  response.status(201).json(registration);
});

app.patch("/api/consultants/registrations/:id", (request, response) => {
  const { id } = request.params;
  const status = sanitizeRegistrationStatus(request.body?.status);
  const actor = sanitizeActor(request.body?.actor);

  if (status === "Pending") {
    response.status(400).json({ error: "status must be Approved or Rejected." });
    return;
  }
  if (actor !== "admin") {
    response.status(403).json({ error: "Only admin can review consultant registrations." });
    return;
  }

  const registrations = readConsultantRegistrations();
  const index = registrations.findIndex((item) => item.id === id);
  if (index === -1) {
    response.status(404).json({ error: "Consultant registration not found." });
    return;
  }

  registrations[index] = {
    ...registrations[index],
    status,
    reviewedAt: new Date().toISOString(),
    reviewedBy: actor
  };

  writeConsultantRegistrations(registrations);

  if (status === "Approved") {
    const approvedRegistration = registrations[index];
    const consultants = readConsultants();
    const approvedName = String(approvedRegistration.name || "").trim().toLowerCase();
    const approvedEmail = String(approvedRegistration.email || "").trim().toLowerCase();
    const alreadyExists = consultants.some((consultant) => {
      const consultantName = String(consultant.name || "").trim().toLowerCase();
      const consultantEmail = String(consultant.email || "").trim().toLowerCase();
      if (approvedName && consultantName === approvedName) {
        return true;
      }
      if (approvedEmail && consultantEmail && consultantEmail === approvedEmail) {
        return true;
      }
      return false;
    });

    if (!alreadyExists) {
      consultants.push({
        id: `con_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: approvedRegistration.name,
        email: approvedRegistration.email,
        expertise: approvedRegistration.expertise || "general",
        createdAt: new Date().toISOString()
      });
      writeConsultants(consultants);
    }
  }

  response.json(registrations[index]);
});

app.get("/api/policies", (_request, response) => {
  response.json(readSystemPolicies());
});

app.put("/api/policies", (request, response) => {
  const nextPolicies = normalizePoliciesPayload(request.body);
  writeSystemPolicies(nextPolicies);
  response.json(nextPolicies);
});

app.get("/api/bookings/stream", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();

  response.write("event: connected\ndata: {}\n\n");
  streamClients.add(response);

  request.on("close", () => {
    streamClients.delete(response);
  });
});

// ─── AI Customer Assistant ────────────────────────────────────────────────────
// POST /api/chat
// Accepts { message: string } and returns { reply: string }.
// The AI is given only public platform context — no personal user data or
// private booking details are ever forwarded to the model.
app.post("/api/chat", async (request, response) => {
  const { message } = request.body || {};

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return response.status(400).json({ error: "message is required" });
  }

  if (!GEMINI_API_KEY) {
    return response
      .status(503)
      .json({ error: "AI assistant is not configured (missing API key)" });
  }

  // Build public platform context — read from JSON files, never from the DB
  const consultants = readConsultants();
  const policies = readSystemPolicies();

  const consultantList = consultants
    .map((c) => `  • ${c.name} — ${c.expertise}`)
    .join("\n");

  const systemPrompt = `You are a helpful customer assistant for Synergy, a Service Booking & Consulting Platform.

PLATFORM OVERVIEW:
Synergy connects clients with professional consultants for services such as software architecture consulting, career coaching, technical interviews, and more.

BOOKING PROCESS:
1. Browse the available consultants and services on the platform.
2. Select a consultant and an available time slot, then submit a booking request.
3. Wait for the consultant to accept or reject your request.
4. Once confirmed, process your payment to secure the session.
5. Attend the consulting session. The consultant will mark it as completed afterward.

BOOKING STATES:
Requested → Confirmed → Pending Payment → Paid → Completed
A booking can also be Rejected or Cancelled at various stages.

AVAILABLE CONSULTANTS (public information only):
${consultantList || "  No consultants are currently listed."}

PAYMENT METHODS ACCEPTED:
  • Credit Card (16-digit card number, expiry date, CVV)
  • Debit Card (same validation as credit card)
  • PayPal (PayPal email address)
  • Bank Transfer (account number and routing number)

CANCELLATION & REFUND POLICY:
  • Cancellation window: ${policies.cancellationWindowHours} hours before the session.
  • Refund policy: ${policies.refundPolicy}

IMPORTANT RULES FOR YOUR RESPONSES:
- Answer only questions about the platform, its services, booking process, payment, and policies.
- Do NOT reveal or ask for any personal information, payment card details, or private booking data.
- Do NOT perform any actions on behalf of the user (e.g., creating or cancelling bookings).
- If asked something outside the platform scope, politely redirect the user.
- Keep answers concise and helpful.`;

  try {
    const geminiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: message.trim() }] }],
        generationConfig: { maxOutputTokens: 512 }
      })
    });

    if (!geminiResponse.ok) {
      const errBody = await geminiResponse.text();
      // eslint-disable-next-line no-console
      console.error("Gemini API error:", geminiResponse.status, errBody);
      return response
        .status(502)
        .json({ error: "AI assistant encountered an error. Please try again." });
    }

    const data = await geminiResponse.json();
    const reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I'm sorry, I could not generate a response. Please try again.";

    return response.json({ reply });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("AI chat error:", error.message);
    return response
      .status(502)
      .json({ error: "AI assistant encountered an error. Please try again." });
  }
});

const frontendPath = path.join(__dirname, "..", "..", "frontend");
app.use(express.static(frontendPath));

app.get("/", (_request, response) => {
  response.sendFile(path.join(frontendPath, "index.html"));
});

async function startServer() {
  ensureDataFiles();

  await withDbRetries(30, 2000, async () => {
    await pool.query("SELECT 1");
  });

  await ensureSchema();

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Synergy app listening on port ${PORT}`);
  });
}

startServer().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});
