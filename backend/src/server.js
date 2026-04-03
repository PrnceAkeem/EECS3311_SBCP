const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
// OpenRouter is called via the REST API — no extra package needed.

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
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

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

const DEFAULT_EXPERTISE_OPTIONS = [
  "Software Architecture Review",
  "Cloud Migration Consulting",
  "Career Path Consulting",
  "Technical Interview Prep",
  "Startup Strategy Session",
  "Code Review & Mentorship"
];

const LEGACY_EXPERTISE_ALIASES = new Map([
  ["software architecture", "Software Architecture Review"],
  ["technical interviews", "Technical Interview Prep"],
  ["career coaching", "Career Path Consulting"],
  ["cloud migration", "Cloud Migration Consulting"]
]);

const DEFAULT_CONSULTANTS = [
  {
    id: "con_1",
    name: "John Smith",
    email: "john.smith@consultant.synergy.local",
    expertise: "Software Architecture Review",
    createdAt: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "con_2",
    name: "Angela Fox",
    email: "angela.fox@consultant.synergy.local",
    expertise: "Technical Interview Prep",
    createdAt: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "con_3",
    name: "Brian Flys",
    email: "brian.flys@consultant.synergy.local",
    expertise: "Career Path Consulting",
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

function mapPaymentMethodRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    details: row.details || {},
    customerId: row.customer_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function listPaymentMethodsFromDb() {
  const result = await pool.query(
    `SELECT
       id,
       customer_id,
       type,
       label,
       details,
       created_at,
       updated_at
     FROM payment_methods
     ORDER BY created_at DESC, id DESC`
  );

  return result.rows.map(mapPaymentMethodRow).filter(Boolean);
}

async function findPaymentMethodById(methodId) {
  if (!methodId) {
    return null;
  }

  const result = await pool.query(
    `SELECT
       id,
       customer_id,
       type,
       label,
       details,
       created_at,
       updated_at
     FROM payment_methods
     WHERE id = $1
     LIMIT 1`,
    [methodId]
  );

  return mapPaymentMethodRow(result.rows[0]);
}

async function migratePaymentMethodsJsonToDb() {
  const methods = readPaymentMethods();
  if (!methods.length) {
    return;
  }

  for (const method of methods) {
    const id = sanitizeText(method.id, 80) || `pm_${Date.now()}`;
    const type = sanitizeText(method.type, 40);
    const label = sanitizeText(method.label, 80);
    const details = method.details && typeof method.details === "object"
      ? method.details
      : {};
    const createdAt = normalizeIsoDateTime(method.createdAt);
    const updatedAt = normalizeIsoDateTime(method.updatedAt);

    if (!ALLOWED_METHOD_TYPES.includes(type) || !label) {
      // eslint-disable-next-line no-continue
      continue;
    }

    await pool.query(
      `INSERT INTO payment_methods (
         id,
         customer_id,
         type,
         label,
         details,
         created_at,
         updated_at
       )
       VALUES (
         $1,
         COALESCE($2, 'cu_demo'),
         $3,
         $4,
         $5::jsonb,
         COALESCE($6::timestamptz, NOW()),
         $7::timestamptz
       )
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        sanitizeText(method.customerId, 80) || "cu_demo",
        type,
        label,
        JSON.stringify(details),
        createdAt,
        updatedAt
      ]
    );
  }
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

function normalizeIsoDateTime(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normalizeExpertiseValue(value) {
  const normalized = sanitizeText(value, 120);
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  const directMatch = DEFAULT_EXPERTISE_OPTIONS.find(
    (option) => option.toLowerCase() === lower
  );
  if (directMatch) {
    return directMatch;
  }

  return LEGACY_EXPERTISE_ALIASES.get(lower) || "";
}

async function listConsultantsFromDb() {
  const result = await pool.query(
    `SELECT
       id,
       name,
       email,
       expertise,
       created_at
     FROM consultants
     ORDER BY name ASC`
  );

  return result.rows.map(toPublicConsultant).filter(Boolean);
}

async function listExpertiseOptionsFromDb() {
  return DEFAULT_EXPERTISE_OPTIONS.map((name, index) => ({
    id: index + 1,
    name,
    createdAt: null
  }));
}

async function buildNextConsultantId() {
  const result = await pool.query(
    `SELECT COALESCE(MAX((regexp_match(id, '^con_([0-9]+)$'))[1]::int), 0) AS max_id
     FROM consultants
     WHERE id ~ '^con_[0-9]+$'`
  );
  const maxId = Number(result.rows?.[0]?.max_id || 0);
  return `con_${maxId + 1}`;
}

async function migrateConsultantsJsonToDb() {
  const consultants = readConsultants()
    .map(toPublicConsultant)
    .filter(Boolean);

  if (!consultants.length) {
    return;
  }

  const seenNames = new Set();
  const seenEmails = new Set();

  for (const consultant of consultants) {
    const name = sanitizeText(consultant.name, 80);
    const email = sanitizeText(consultant.email, 120).toLowerCase();
    const expertise = normalizeExpertiseValue(consultant.expertise);
    const createdAt = normalizeIsoDateTime(consultant.createdAt);

    if (!name) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const nameKey = name.toLowerCase();
    const emailKey = email.toLowerCase();
    if (seenNames.has(nameKey) || (emailKey && seenEmails.has(emailKey))) {
      // eslint-disable-next-line no-continue
      continue;
    }

    seenNames.add(nameKey);
    if (emailKey) {
      seenEmails.add(emailKey);
    }

    await pool.query(
      `INSERT INTO consultants (id, name, email, expertise, created_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           email = EXCLUDED.email,
           expertise = EXCLUDED.expertise`,
      [
        sanitizeText(consultant.id, 80) || await buildNextConsultantId(),
        name,
        email,
        expertise,
        createdAt
      ]
    );
  }
}

async function upsertCustomer({
  customerId,
  name,
  email
}) {
  const normalizedCustomerId = sanitizeText(customerId, 80);
  const normalizedName = sanitizeText(name, 80);
  const normalizedEmail = sanitizeText(email, 120).toLowerCase();

  if (!normalizedCustomerId || !normalizedName || !normalizedEmail) {
    return null;
  }

  const existingByEmailResult = await pool.query(
    `SELECT id
     FROM customers
     WHERE LOWER(email) = $1
     LIMIT 1`,
    [normalizedEmail]
  );

  if (existingByEmailResult.rows.length) {
    const existingId = existingByEmailResult.rows[0].id;
    const result = await pool.query(
      `UPDATE customers
       SET
         name = $2,
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, email, created_at, updated_at`,
      [existingId, normalizedName]
    );
    return result.rows[0] || null;
  }

  const result = await pool.query(
    `INSERT INTO customers (id, name, email, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE
     SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       updated_at = NOW()
     RETURNING id, name, email, created_at, updated_at`,
    [normalizedCustomerId, normalizedName, normalizedEmail]
  );

  return result.rows[0] || null;
}

async function syncCustomersFromBookings() {
  const bookingRows = await pool.query(
    `SELECT
       id,
       customer_id,
       client_name,
       LOWER(client_email) AS client_email
     FROM bookings
     WHERE TRIM(COALESCE(client_name, '')) <> ''
       AND TRIM(COALESCE(client_email, '')) <> ''
     ORDER BY id ASC`
  );

  for (const row of bookingRows.rows) {
    const fallbackCustomerId =
      sanitizeText(row.customer_id, 80) || buildCanonicalCustomerId(row.id);

    const customer = await upsertCustomer({
      customerId: fallbackCustomerId,
      name: row.client_name,
      email: row.client_email
    });

    const canonicalCustomerId = customer?.id || fallbackCustomerId;
    if (!canonicalCustomerId || canonicalCustomerId === row.customer_id) {
      // eslint-disable-next-line no-continue
      continue;
    }

    await pool.query(
      `UPDATE bookings
       SET customer_id = $1
       WHERE id = $2`,
      [canonicalCustomerId, row.id]
    );
  }
}

async function seedDefaultCustomer() {
  await pool.query(
    `INSERT INTO customers (id, name, email, created_at, updated_at)
     VALUES ('cu_demo', 'Demo Client', 'client@synergy.local', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`
  );
}

async function syncPaymentsFromBookings() {
  await pool.query(
    `INSERT INTO payments (
       booking_id,
       customer_id,
       payment_method_id,
       kind,
       status,
       amount,
       transaction_id,
       metadata,
       created_at,
       processed_at
     )
     SELECT
       id,
       customer_id,
       NULL,
       'payment',
       COALESCE(payment_status, 'Success'),
       COALESCE(price, '0'),
       payment_transaction_id,
       '{}'::jsonb,
       COALESCE(payment_processed_at, updated_at, created_at, NOW()),
       COALESCE(payment_processed_at, updated_at, created_at, NOW())
     FROM bookings
     WHERE payment_transaction_id IS NOT NULL
       AND TRIM(COALESCE(payment_transaction_id, '')) <> ''
     ON CONFLICT (transaction_id) DO NOTHING`
  );

  await pool.query(
    `INSERT INTO payments (
       booking_id,
       customer_id,
       payment_method_id,
       kind,
       status,
       amount,
       transaction_id,
       metadata,
       created_at,
       processed_at
     )
     SELECT
       id,
       customer_id,
       NULL,
       'refund',
       'Refunded',
       COALESCE(price, '0'),
       refund_transaction_id,
       '{}'::jsonb,
       COALESCE(refund_processed_at, updated_at, created_at, NOW()),
       COALESCE(refund_processed_at, updated_at, created_at, NOW())
     FROM bookings
     WHERE refund_transaction_id IS NOT NULL
       AND TRIM(COALESCE(refund_transaction_id, '')) <> ''
     ON CONFLICT (transaction_id) DO NOTHING`
  );
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
    createdAt: consultant.createdAt || consultant.created_at || null
  };
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

function buildFallbackChatReply(message, consultants, policies) {
  const prompt = String(message || "").trim().toLowerCase();
  const cancellationHours = Number(policies?.cancellationWindowHours || 24);
  const refundPolicy = String(
    policies?.refundPolicy || "Refunds follow the current cancellation policy."
  );

  const expertiseSet = new Set(DEFAULT_EXPERTISE_OPTIONS);
  if (Array.isArray(consultants)) {
    consultants.forEach((consultant) => {
      const normalized = normalizeExpertiseValue(consultant?.expertise);
      if (normalized) {
        expertiseSet.add(normalized);
      }
    });
  }
  const expertiseList = Array.from(expertiseSet);

  if (
    /\b(hi|hello|hey|greetings|good morning|good afternoon|good evening)\b/.test(prompt)
  ) {
    return "Hello. I can help with bookings, payment methods, cancellation/refunds, and available services.";
  }

  if (/\b(book|booking|session|appointment|reserve)\b/.test(prompt)) {
    return [
      "Booking flow:",
      "1) Pick a service and consultant.",
      "2) Select an available date/time slot.",
      "3) Submit the booking request.",
      "4) Wait for consultant confirmation.",
      "5) Complete payment when the booking reaches Pending Payment."
    ].join("\n");
  }

  if (/\b(payment|pay|card|paypal|bank transfer|method)\b/.test(prompt)) {
    return [
      "Accepted payment methods:",
      "- Credit Card",
      "- Debit Card",
      "- PayPal",
      "- Bank Transfer"
    ].join("\n");
  }

  if (/\b(cancel|cancellation|refund)\b/.test(prompt)) {
    return [
      `Cancellation window: at least ${cancellationHours} hours before the session.`,
      `Refund policy: ${refundPolicy}`
    ].join("\n");
  }

  if (/\b(service|services|available|offer|category|categories|expertise)\b/.test(prompt)) {
    const servicesText = expertiseList.map((item) => `- ${item}`).join("\n");
    return `Available consulting services:\n${servicesText}`;
  }

  if (/\b(status|state|lifecycle|progress)\b/.test(prompt)) {
    return "Booking lifecycle: Requested -> Confirmed -> Pending Payment -> Paid -> Completed. It can also be Rejected or Cancelled.";
  }

  return [
    "I can help with:",
    "- how to book a consulting session",
    "- accepted payment methods",
    "- cancellation and refund rules",
    "- available consulting services"
  ].join("\n");
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
      row.booking_ref || buildCanonicalBookingRef(normalizedBookingId) || null,
    customerId:
      row.customer_id || buildCanonicalCustomerId(normalizedBookingId) || null,
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
    `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_unique
     ON customers(LOWER(email))`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_payment_methods_customer_id
     ON payment_methods(customer_id)`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      booking_id INTEGER NOT NULL,
      customer_id TEXT,
      payment_method_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      amount TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )`
  );

  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transaction_unique
     ON payments(transaction_id)`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_payments_booking_id
     ON payments(booking_id)`
  );

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

  await seedDefaultCustomer();
  await syncCustomersFromBookings();

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
    `CREATE TABLE IF NOT EXISTS consultants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      expertise TEXT NOT NULL DEFAULT 'general',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_consultants_name_unique
     ON consultants(LOWER(name))`
  );

  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_consultants_email_unique
     ON consultants(LOWER(email))
     WHERE email <> ''`
  );

  await pool.query(
    `UPDATE consultants
     SET expertise = CASE
       WHEN LOWER(expertise) = 'software architecture' THEN 'Software Architecture Review'
       WHEN LOWER(expertise) = 'technical interviews' THEN 'Technical Interview Prep'
       WHEN LOWER(expertise) = 'career coaching' THEN 'Career Path Consulting'
       WHEN LOWER(expertise) = 'cloud migration' THEN 'Cloud Migration Consulting'
       ELSE expertise
     END`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS expertise_options (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_expertise_options_name_unique
     ON expertise_options(LOWER(name))`
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

    const persistedCustomer = await upsertCustomer({
      customerId: canonicalCustomerId,
      name: actors.client.name,
      email: actors.client.email
    });

    let bookingRow = result.rows[0];
    if (persistedCustomer?.id && persistedCustomer.id !== canonicalCustomerId) {
      const bookingSyncResult = await pool.query(
        `UPDATE bookings
         SET customer_id = $1
         WHERE id = $2
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
        [persistedCustomer.id, insertedBookingId]
      );

      if (bookingSyncResult.rows.length) {
        bookingRow = bookingSyncResult.rows[0];
      }
    }

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
         customer_id,
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

      const savedMethod = await findPaymentMethodById(paymentMethodId);
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

    const booking = mapBookingRow(bookingRow);

    if (paymentReceipt) {
      await pool.query(
        `INSERT INTO payments (
           booking_id,
           customer_id,
           payment_method_id,
           kind,
           status,
           amount,
           transaction_id,
           metadata,
           processed_at
         )
         VALUES (
           $1,
           $2,
           $3,
           'payment',
           'Success',
           $4,
           $5,
           $6::jsonb,
           $7::timestamptz
         )
         ON CONFLICT (transaction_id) DO UPDATE
         SET
           status = EXCLUDED.status,
           amount = EXCLUDED.amount,
           metadata = EXCLUDED.metadata,
           processed_at = EXCLUDED.processed_at`,
        [
          bookingId,
          current.customer_id || booking.customerId || null,
          paymentMethodId,
          parsePriceAmount(current.price),
          paymentReceipt.transactionId,
          JSON.stringify({
            methodType: paymentReceipt.methodType,
            methodLabel: paymentReceipt.methodLabel
          }),
          paymentReceipt.processedAt
        ]
      );
    }

    if (refundReceipt) {
      await pool.query(
        `INSERT INTO payments (
           booking_id,
           customer_id,
           payment_method_id,
           kind,
           status,
           amount,
           transaction_id,
           metadata,
           processed_at
         )
         VALUES (
           $1,
           $2,
           NULL,
           'refund',
           'Refunded',
           $3,
           $4,
           $5::jsonb,
           $6::timestamptz
         )
         ON CONFLICT (transaction_id) DO UPDATE
         SET
           status = EXCLUDED.status,
           amount = EXCLUDED.amount,
           metadata = EXCLUDED.metadata,
           processed_at = EXCLUDED.processed_at`,
        [
          bookingId,
          current.customer_id || booking.customerId || null,
          parsePriceAmount(current.price),
          refundReceipt.refundTransactionId,
          JSON.stringify({
            sourcePaymentTransactionId: nextPaymentTransactionId || null
          }),
          refundReceipt.refundedAt
        ]
      );
    }

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

app.get("/api/customers", async (_request, response) => {
  try {
    const result = await pool.query(
      `SELECT
         id,
         name,
         email,
         created_at,
         updated_at
       FROM customers
       ORDER BY created_at ASC, id ASC`
    );

    response.json(result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to load customers", error);
    response.status(500).json({ error: "Failed to load customers." });
  }
});

app.get("/api/payments", async (_request, response) => {
  try {
    const result = await pool.query(
      `SELECT
         id,
         booking_id,
         customer_id,
         payment_method_id,
         kind,
         status,
         amount,
         transaction_id,
         metadata,
         created_at,
         processed_at
       FROM payments
       ORDER BY id DESC`
    );

    response.json(result.rows.map((row) => ({
      id: row.id,
      bookingId: row.booking_id,
      customerId: row.customer_id,
      paymentMethodId: row.payment_method_id,
      kind: row.kind,
      status: row.status,
      amount: row.amount,
      transactionId: row.transaction_id,
      metadata: row.metadata || {},
      createdAt: row.created_at,
      processedAt: row.processed_at
    })));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to load payments", error);
    response.status(500).json({ error: "Failed to load payments." });
  }
});

app.get("/api/payment-methods", async (_request, response) => {
  try {
    const methods = await listPaymentMethodsFromDb();
    response.json(methods.map(toPublicPaymentMethod));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to load payment methods", error);
    response.status(500).json({ error: "Failed to load payment methods." });
  }
});

app.post("/api/payment-methods", async (request, response) => {
  const normalized = validatePaymentMethodPayload(request.body);
  if (normalized.error) {
    response.status(400).json({ error: normalized.error });
    return;
  }

  const newMethod = {
    id: `pm_${Date.now()}`,
    customerId: sanitizeText(request.body?.customerId, 80) || "cu_demo",
    type: normalized.type,
    label: normalized.label,
    details: normalized.details,
    createdAt: new Date().toISOString(),
    updatedAt: null
  };

  try {
    await upsertCustomer({
      customerId: newMethod.customerId,
      name: "Demo Client",
      email: "client@synergy.local"
    });

    await pool.query(
      `INSERT INTO payment_methods (
         id,
         customer_id,
         type,
         label,
         details,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, NULL)`,
      [
        newMethod.id,
        newMethod.customerId,
        newMethod.type,
        newMethod.label,
        JSON.stringify(newMethod.details || {}),
        newMethod.createdAt
      ]
    );

    response.status(201).json(toPublicPaymentMethod(newMethod));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to save payment method", error);
    response.status(500).json({ error: "Failed to save payment method." });
  }
});

app.patch("/api/payment-methods/:id", async (request, response) => {
  const { id } = request.params;
  try {
    const currentMethod = await findPaymentMethodById(id);
    if (!currentMethod) {
      response.status(404).json({ error: "Payment method not found." });
      return;
    }

    const incoming = request.body || {};

    const isLabelOnlyUpdate =
      Object.prototype.hasOwnProperty.call(incoming, "label") &&
      !Object.prototype.hasOwnProperty.call(incoming, "type") &&
      !Object.prototype.hasOwnProperty.call(incoming, "details");

    if (isLabelOnlyUpdate) {
      const nextLabel = sanitizeText(incoming.label, 80) || currentMethod.label;
      const updatedAt = new Date().toISOString();
      await pool.query(
        `UPDATE payment_methods
         SET label = $1,
             updated_at = $2::timestamptz
         WHERE id = $3`,
        [nextLabel, updatedAt, id]
      );
      response.json(
        toPublicPaymentMethod({
          ...currentMethod,
          label: nextLabel,
          updatedAt
        })
      );
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

    const updatedAt = new Date().toISOString();
    await pool.query(
      `UPDATE payment_methods
       SET
         type = $1,
         label = $2,
         details = $3::jsonb,
         updated_at = $4::timestamptz
       WHERE id = $5`,
      [
        normalized.type,
        normalized.label,
        JSON.stringify(normalized.details || {}),
        updatedAt,
        id
      ]
    );

    response.json(
      toPublicPaymentMethod({
        ...currentMethod,
        type: normalized.type,
        label: normalized.label,
        details: normalized.details,
        updatedAt
      })
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to update payment method", error);
    response.status(500).json({ error: "Failed to update payment method." });
  }
});

app.delete("/api/payment-methods/:id", async (request, response) => {
  const { id } = request.params;
  try {
    const result = await pool.query(
      `DELETE FROM payment_methods
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (!result.rows.length) {
      response.status(404).json({ error: "Payment method not found." });
      return;
    }

    response.status(204).end();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to delete payment method", error);
    response.status(500).json({ error: "Failed to delete payment method." });
  }
});

app.get("/api/consultants", async (_request, response) => {
  try {
    const consultants = await listConsultantsFromDb();
    response.json(consultants);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to load consultants", error);
    response.status(500).json({ error: "Failed to load consultants." });
  }
});

app.post("/api/consultants", async (request, response) => {
  const actor = sanitizeActor(request.body?.actor);
  if (actor !== "admin") {
    response.status(403).json({ error: "Only admin can add consultants." });
    return;
  }

  const name = sanitizeText(request.body?.name, 80);
  const expertise = normalizeExpertiseValue(request.body?.expertise);
  const email = sanitizeText(request.body?.email, 120).toLowerCase();

  if (!name) {
    response.status(400).json({ error: "Consultant name is required." });
    return;
  }

  if (email && !isValidEmail(email)) {
    response.status(400).json({ error: "Consultant email format is invalid." });
    return;
  }

  if (!expertise) {
    response.status(400).json({
      error: `Expertise must match one of: ${DEFAULT_EXPERTISE_OPTIONS.join(", ")}.`
    });
    return;
  }

  try {
    const consultantId = await buildNextConsultantId();
    const createdAt = new Date().toISOString();

    const result = await pool.query(
      `INSERT INTO consultants (id, name, email, expertise, created_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)
       RETURNING id, name, email, expertise, created_at`,
      [consultantId, name, email, expertise, createdAt]
    );

    response.status(201).json(toPublicConsultant(result.rows[0]));
  } catch (error) {
    if (error && error.code === "23505") {
      response.status(409).json({ error: "Consultant already exists." });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("Failed to create consultant", error);
    response.status(500).json({ error: "Failed to create consultant." });
  }
});

app.get("/api/policies/expertise-options", async (_request, response) => {
  try {
    const options = await listExpertiseOptionsFromDb();
    response.json(options);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to load expertise options", error);
    response.status(500).json({ error: "Failed to load expertise options." });
  }
});

app.post("/api/policies/expertise-options", async (_request, response) => {
  response.status(405).json({
    error: "Expertise options are fixed to the platform service catalog and cannot be modified."
  });
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

app.patch("/api/consultants/registrations/:id", async (request, response) => {
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

  if (status === "Approved") {
    const approvedRegistration = registrations[index];
    const approvedName = String(approvedRegistration.name || "").trim().toLowerCase();
    const approvedEmail = String(approvedRegistration.email || "").trim().toLowerCase();
    const approvedExpertise =
      normalizeExpertiseValue(approvedRegistration.expertise) || DEFAULT_EXPERTISE_OPTIONS[0];

    try {
      const alreadyExistsQuery = await pool.query(
        `SELECT id
         FROM consultants
         WHERE LOWER(name) = $1
            OR ($2 <> '' AND LOWER(email) = $2)
         LIMIT 1`,
        [approvedName, approvedEmail]
      );

      if (!alreadyExistsQuery.rows.length) {
        const consultantId = await buildNextConsultantId();
        await pool.query(
          `INSERT INTO consultants (id, name, email, expertise, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [
            consultantId,
            sanitizeText(approvedRegistration.name, 80),
            sanitizeText(approvedRegistration.email, 120).toLowerCase(),
            approvedExpertise
          ]
        );
      }

    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to approve consultant registration into DB", error);
      response.status(500).json({ error: "Failed to finalize consultant approval." });
      return;
    }
  }

  writeConsultantRegistrations(registrations);
  response.json(registrations[index]);
});

app.get("/api/policies", async (_request, response) => {
  try {
    const policies = readSystemPolicies();
    const expertiseOptions = await listExpertiseOptionsFromDb();
    response.json({
      ...policies,
      expertiseOptions: expertiseOptions.map((item) => item.name)
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to load policies", error);
    response.status(500).json({ error: "Failed to load policies." });
  }
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

  // Build public platform context from safe/public sources only.
  let consultants = [];
  try {
    consultants = await listConsultantsFromDb();
  } catch {
    consultants = readConsultants().map(toPublicConsultant).filter(Boolean);
  }
  const policies = readSystemPolicies();

  if (!OPENROUTER_API_KEY) {
    return response.json({
      reply: buildFallbackChatReply(message, consultants, policies),
      mode: "fallback"
    });
  }

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
    const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: "qwen/qwen3.6-plus:free",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message.trim() }
        ],
        max_tokens: 512
      })
    });

    if (!orResponse.ok) {
      const errBody = await orResponse.text();
      // eslint-disable-next-line no-console
      console.error("OpenRouter API error:", orResponse.status, errBody);
      return response.json({
        reply: buildFallbackChatReply(message, consultants, policies),
        mode: "fallback"
      });
    }

    const data = await orResponse.json();
    const reply =
      data.choices?.[0]?.message?.content ||
      "I'm sorry, I could not generate a response. Please try again.";

    return response.json({ reply });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("AI chat error:", error.message);
    return response.json({
      reply: buildFallbackChatReply(message, consultants, policies),
      mode: "fallback"
    });
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
  await migrateConsultantsJsonToDb();
  await migratePaymentMethodsJsonToDb();
  await syncCustomersFromBookings();
  await syncPaymentsFromBookings();

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
