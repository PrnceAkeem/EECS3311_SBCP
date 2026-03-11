// dataStore.js — all file-based persistence (payment methods, consultants,
// registrations, system policies).  No imports from helpers.js (avoids circular deps).

const fs   = require("fs");
const path = require("path");
const {
  DATA_DIR, PAYMENT_METHODS_FILE, CONSULTANT_REGISTRATIONS_FILE,
  CONSULTANTS_FILE, SYSTEM_POLICIES_FILE, DEFAULT_POLICIES, DEFAULT_CONSULTANTS
} = require("./config");

// ── Low-level file helpers ─────────────────────────────────────────────────

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return fallback; }
}

function writeJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// Creates all JSON data files on first run if they do not exist yet.
function ensureDataFiles() {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(PAYMENT_METHODS_FILE))            writeJsonFile(PAYMENT_METHODS_FILE, []);
  if (!fs.existsSync(CONSULTANT_REGISTRATIONS_FILE))   writeJsonFile(CONSULTANT_REGISTRATIONS_FILE, []);
  if (!fs.existsSync(CONSULTANTS_FILE))                writeJsonFile(CONSULTANTS_FILE, DEFAULT_CONSULTANTS);
  if (!fs.existsSync(SYSTEM_POLICIES_FILE))            writeJsonFile(SYSTEM_POLICIES_FILE, DEFAULT_POLICIES);
}

// ── Shared string helper (defined here so dataStore has no upstream deps) ──

function sanitizeText(value, maxLen = 120) {
  return String(value || "").trim().slice(0, maxLen);
}

// ── Payment methods ────────────────────────────────────────────────────────

function readPaymentMethods()    { return readJsonFile(PAYMENT_METHODS_FILE, []); }
function writePaymentMethods(m)  { writeJsonFile(PAYMENT_METHODS_FILE, m); }

// ── Consultant registrations ───────────────────────────────────────────────

function readConsultantRegistrations()   { return readJsonFile(CONSULTANT_REGISTRATIONS_FILE, []); }
function writeConsultantRegistrations(r) { writeJsonFile(CONSULTANT_REGISTRATIONS_FILE, r); }

// ── Consultants ────────────────────────────────────────────────────────────

function consultantIdNumber(consultantId) {
  const match = String(consultantId || "").trim().match(/^con_(\d+)$/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeConsultants(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((c) => ({
      name:      sanitizeText(c?.name, 80),
      email:     sanitizeText(c?.email, 120).toLowerCase(),
      expertise: sanitizeText(c?.expertise, 120) || "general",
      createdAt: c?.createdAt || new Date().toISOString()
    }))
    .filter((c) => c.name)
    .map((c, i) => ({ id: `con_${i + 1}`, ...c }));
}

function readConsultants() {
  const raw        = readJsonFile(CONSULTANTS_FILE, DEFAULT_CONSULTANTS);
  const normalized = normalizeConsultants(raw);
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) writeJsonFile(CONSULTANTS_FILE, normalized);
  return normalized;
}

function writeConsultants(c) { writeJsonFile(CONSULTANTS_FILE, c); }

// ── System policies ────────────────────────────────────────────────────────

function readSystemPolicies()   { return { ...DEFAULT_POLICIES, ...readJsonFile(SYSTEM_POLICIES_FILE, DEFAULT_POLICIES) }; }
function writeSystemPolicies(p) { writeJsonFile(SYSTEM_POLICIES_FILE, p); }

// ──────────────────────────────────────────────────────────────────────────

module.exports = {
  ensureDataFiles,
  readPaymentMethods, writePaymentMethods,
  readConsultantRegistrations, writeConsultantRegistrations,
  readConsultants, writeConsultants,
  readSystemPolicies, writeSystemPolicies,
  consultantIdNumber, sanitizeText
};
