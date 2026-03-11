// helpers.js — input sanitization, validators, transforms, and DB row mapping.
// Imports from dataStore.js (data reads) but NOT vice-versa — no circular deps.

const { VALID_STATUSES, VALID_ACTORS, VALID_REGISTRATION_STATUSES, ALLOWED_METHOD_TYPES, DEFAULT_POLICIES } = require("./config");
const { readPaymentMethods, readSystemPolicies, sanitizeText } = require("./dataStore");
const UserFactory = require("./patterns/factory/UserFactory");

const userFactory = new UserFactory();

// ── Input sanitization ─────────────────────────────────────────────────────

function sanitizeDate(value) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function sanitizeSlotTime(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  const m   = raw.match(/^(0?[1-9]|1[0-2]):([0-5][0-9])\s(AM|PM)$/);
  if (!m) return "";
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]} ${m[3]}`;
}

function sanitizeStatus(status) {
  return VALID_STATUSES.has(status) ? status : "Requested";
}

function sanitizeActor(actor) {
  return VALID_ACTORS.has(actor) ? actor : "system";
}

function sanitizeRegistrationStatus(status) {
  const s = String(status || "").trim();
  return VALID_REGISTRATION_STATUSES.has(s) ? s : "Pending";
}

// ── Validators ─────────────────────────────────────────────────────────────

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isFutureExpiry(text) {
  const m = String(text || "").trim().match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
  if (!m) return false;
  return new Date(2000 + Number(m[2]), Number(m[1]), 0, 23, 59, 59, 999).getTime() >= Date.now();
}

// ── ID / number helpers ────────────────────────────────────────────────────

function normalizeNumericId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function buildCanonicalBookingRef(bookingId) {
  const n = normalizeNumericId(bookingId);
  return n ? `bk_${n}` : null;
}

function buildCanonicalCustomerId(bookingId) {
  const n = normalizeNumericId(bookingId);
  return n ? `cu_${n}` : null;
}

function paymentMethodPrefix(methodType) {
  const map = { "Credit Card": "CC", "Debit Card": "DC", "Bank Transfer": "BT", "PayPal": "PP" };
  return map[methodType] || "PAY";
}

function buildTransactionId(prefix, bookingId = null) {
  const n = normalizeNumericId(bookingId);
  if (n) return `${prefix}-${String(n).padStart(6, "0")}`;
  return `${prefix}-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// ── Price helpers ──────────────────────────────────────────────────────────

function parsePriceAmount(rawPrice) {
  const n = Number(String(rawPrice || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : String(rawPrice || "0");
}

function applyPricingPolicy(rawPrice, pricingMultiplier) {
  const price = Number(String(rawPrice || "").replace(/[^0-9.]/g, ""));
  const mult  = Number(pricingMultiplier);
  if (!Number.isFinite(price) || price <= 0) return String(rawPrice || "0");
  if (!Number.isFinite(mult)  || mult  <= 0) return `$${price.toFixed(2)}`;
  return `$${(price * mult).toFixed(2)}`;
}

// ── Date / time helpers ────────────────────────────────────────────────────

function parseBookingDateTime(dateText, timeText) {
  const d = sanitizeDate(dateText);
  const t = sanitizeSlotTime(timeText);
  if (!d || !t) return null;
  const [timePart, meridian] = t.split(" ");
  let [hh, mm] = timePart.split(":").map(Number);
  if (meridian === "AM" && hh === 12) hh = 0;
  if (meridian === "PM" && hh !== 12) hh += 12;
  const [year, month, day] = d.split("-").map(Number);
  return new Date(year, month - 1, day, hh, mm, 0, 0);
}

// ── Payment method validation (Strategy pattern input guard) ───────────────

function validatePaymentMethodPayload(input) {
  const payload = input || {};
  const type    = sanitizeText(payload.type, 40);
  const details = payload.details || {};

  if (!ALLOWED_METHOD_TYPES.includes(type)) {
    return { error: `type must be one of: ${ALLOWED_METHOD_TYPES.join(", ")}.` };
  }

  if (type === "Credit Card" || type === "Debit Card") {
    const cardholderName = sanitizeText(details.cardholderName, 60);
    const cardNumber     = String(details.cardNumber || "").replace(/\D/g, "");
    const expiry         = String(details.expiry || "").trim();
    const cvv            = String(details.cvv || "").replace(/\D/g, "");
    if (!cardholderName)               return { error: "Cardholder name is required." };
    if (!/^\d{16}$/.test(cardNumber))  return { error: "Card number must be exactly 16 digits." };
    if (!isFutureExpiry(expiry))       return { error: "Expiry must use MM/YY format and be a future date." };
    if (!/^\d{3,4}$/.test(cvv))        return { error: "CVV must be 3 or 4 digits." };
    const last4 = cardNumber.slice(-4);
    return { type, label: sanitizeText(payload.label, 80) || `${cardholderName} - ending in ${last4}`, details: { cardholderName, cardNumber, last4, expiry, cvv } };
  }

  if (type === "Bank Transfer") {
    const bankName      = sanitizeText(details.bankName, 60);
    const accountNumber = String(details.accountNumber || "").replace(/\D/g, "");
    const routingNumber = String(details.routingNumber || "").replace(/\D/g, "");
    if (!bankName)                            return { error: "Bank name is required for bank transfer." };
    if (!/^\d{6,17}$/.test(accountNumber))   return { error: "Account number must be 6 to 17 digits." };
    if (!/^\d{9}$/.test(routingNumber))      return { error: "Routing number must be exactly 9 digits." };
    const last4 = accountNumber.slice(-4);
    return { type, label: sanitizeText(payload.label, 80) || `${bankName} (Acct ••••${last4})`, details: { bankName, accountNumber, routingNumber, last4 } };
  }

  if (type === "PayPal") {
    const paypalEmail = sanitizeText(details.paypalEmail, 80);
    if (!isValidEmail(paypalEmail)) return { error: "A valid PayPal email is required." };
    return { type, label: sanitizeText(payload.label, 80) || paypalEmail, details: { paypalEmail } };
  }

  return { error: "Unsupported payment type." };
}

// ── Policy normalization ───────────────────────────────────────────────────

function normalizePoliciesPayload(rawPayload) {
  const payload = rawPayload || {};
  const current = readSystemPolicies();

  let cancellationWindowHours = Number(payload.cancellationWindowHours);
  if (!Number.isFinite(cancellationWindowHours) || cancellationWindowHours < 0)
    cancellationWindowHours = Number(current.cancellationWindowHours);

  let pricingMultiplier = Number(payload.pricingMultiplier);
  if (!Number.isFinite(pricingMultiplier) || pricingMultiplier <= 0)
    pricingMultiplier = Number(current.pricingMultiplier);

  const raw = payload.notificationsEnabled;
  let notificationsEnabled = current.notificationsEnabled;
  if (raw === true  || raw === "true")  notificationsEnabled = true;
  if (raw === false || raw === "false") notificationsEnabled = false;

  const refundPolicy = sanitizeText(payload.refundPolicy || current.refundPolicy, 300) || DEFAULT_POLICIES.refundPolicy;

  return {
    cancellationWindowHours: Math.min(cancellationWindowHours, 168),
    pricingMultiplier:       Number(pricingMultiplier.toFixed(2)),
    notificationsEnabled,
    refundPolicy
  };
}

// ── Factory helpers (UserFactory / booking actors) ─────────────────────────

function buildUserId(role) {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
    "client", buildUserId("client"), payload.clientName, payload.clientEmail
  );
  const consultant = userFactory.createUser(
    "consultant", buildUserId("consultant"), payload.consultantName,
    toInternalEmail(payload.consultantName, "consultant"), { expertise: payload.service }
  );
  return { client, consultant };
}

// ── Public-facing shapes ───────────────────────────────────────────────────

function toPublicPaymentMethod(m) {
  if (!m) return null;
  return { id: m.id, type: m.type, label: m.label, createdAt: m.createdAt, updatedAt: m.updatedAt || null };
}

function toPublicConsultant(c) {
  if (!c) return null;
  return { id: c.id, name: c.name, email: c.email || "", expertise: c.expertise || "general", createdAt: c.createdAt || null };
}

function findPaymentMethodById(methodId) {
  if (!methodId) return null;
  return readPaymentMethods().find((m) => m.id === methodId) || null;
}

// ── DB row → API object ────────────────────────────────────────────────────

function mapBookingRow(row) {
  if (!row) return null;
  const id          = normalizeNumericId(row.id);
  const bookingDate = row.booking_date instanceof Date
    ? row.booking_date.toISOString().slice(0, 10)
    : String(row.booking_date || "");
  return {
    id,
    bookingRef:           buildCanonicalBookingRef(id) || row.booking_ref || null,
    customerId:           buildCanonicalCustomerId(id) || row.customer_id || null,
    service:              row.service,
    price:                row.price,
    clientName:           row.client_name,
    clientEmail:          row.client_email,
    consultantName:       row.consultant_name,
    bookingDate,
    bookingTime:          row.booking_time,
    status:               row.status,
    paymentStatus:        row.payment_status || null,
    paymentTransactionId: row.payment_transaction_id || null,
    paymentProcessedAt:   row.payment_processed_at || null,
    refundTransactionId:  row.refund_transaction_id || null,
    refundProcessedAt:    row.refund_processed_at || null,
    createdAt:            row.created_at,
    updatedAt:            row.updated_at,
    updatedBy:            row.updated_by
  };
}

// ──────────────────────────────────────────────────────────────────────────

module.exports = {
  // sanitize
  sanitizeText, sanitizeDate, sanitizeSlotTime,
  sanitizeStatus, sanitizeActor, sanitizeRegistrationStatus,
  // validate
  isValidEmail, isFutureExpiry,
  validatePaymentMethodPayload, normalizePoliciesPayload,
  // id / price
  normalizeNumericId, buildCanonicalBookingRef, buildCanonicalCustomerId,
  paymentMethodPrefix, buildTransactionId,
  parsePriceAmount, applyPricingPolicy,
  // date / time
  parseBookingDateTime,
  // factory
  buildUserId, toInternalEmail, createBookingActors,
  // shapes
  toPublicPaymentMethod, toPublicConsultant, findPaymentMethodById,
  // db mapping
  mapBookingRow
};
