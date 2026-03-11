// config.js — all constants and default values in one place.
// Nothing here imports from the rest of the app.

const path = require("path");

const PORT         = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || "postgres://synergy_user:synergy_pass@localhost:5432/synergy";

const DATA_DIR                      = path.join(__dirname, "..", "data");
const PAYMENT_METHODS_FILE          = path.join(DATA_DIR, "payment-methods.json");
const CONSULTANT_REGISTRATIONS_FILE = path.join(DATA_DIR, "consultant-registrations.json");
const CONSULTANTS_FILE              = path.join(DATA_DIR, "consultants.json");
const SYSTEM_POLICIES_FILE          = path.join(DATA_DIR, "system-policies.json");

const DEFAULT_POLICIES = {
  cancellationWindowHours: 24,
  pricingMultiplier:       1,
  notificationsEnabled:    true,
  refundPolicy: "Paid bookings cancelled before the session are refunded automatically."
};

const DEFAULT_CONSULTANTS = [
  { id: "con_1", name: "John Smith",  email: "john.smith@consultant.synergy.local",  expertise: "Software Architecture", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "con_2", name: "Angela Fox",  email: "angela.fox@consultant.synergy.local",  expertise: "Technical Interviews",  createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "con_3", name: "Brian Flys",  email: "brian.flys@consultant.synergy.local",  expertise: "Career Coaching",       createdAt: "2026-01-01T00:00:00.000Z" }
];

const STATUS_VALUES = ["Requested", "Confirmed", "Pending Payment", "Paid", "Completed", "Rejected", "Cancelled"];
const STATUS_SQL    = STATUS_VALUES.map((s) => `'${s}'`).join(", ");
const VALID_STATUSES              = new Set(STATUS_VALUES);
const VALID_ACTORS                = new Set(["client", "consultant", "admin", "system"]);
const ALLOWED_METHOD_TYPES        = ["Credit Card", "Debit Card", "Bank Transfer", "PayPal"];
const VALID_REGISTRATION_STATUSES = new Set(["Pending", "Approved", "Rejected"]);

module.exports = {
  PORT, DATABASE_URL,
  DATA_DIR, PAYMENT_METHODS_FILE, CONSULTANT_REGISTRATIONS_FILE, CONSULTANTS_FILE, SYSTEM_POLICIES_FILE,
  DEFAULT_POLICIES, DEFAULT_CONSULTANTS,
  STATUS_VALUES, STATUS_SQL, VALID_STATUSES, VALID_ACTORS,
  ALLOWED_METHOD_TYPES, VALID_REGISTRATION_STATUSES
};
