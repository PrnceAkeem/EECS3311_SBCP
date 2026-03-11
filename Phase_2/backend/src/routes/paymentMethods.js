// routes/paymentMethods.js — CRUD for client-saved payment methods (JSON file store).

const express = require("express");
const router  = express.Router();

const { readPaymentMethods, writePaymentMethods } = require("../dataStore");
const { toPublicPaymentMethod, validatePaymentMethodPayload, sanitizeText } = require("../helpers");

// GET /api/payment-methods
router.get("/", (_req, res) => {
  res.json(readPaymentMethods().map(toPublicPaymentMethod));
});

// POST /api/payment-methods
router.post("/", (req, res) => {
  const normalized = validatePaymentMethodPayload(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  const methods = readPaymentMethods();
  const method  = {
    id:        `pm_${Date.now()}`,
    type:      normalized.type,
    label:     normalized.label,
    details:   normalized.details,
    createdAt: new Date().toISOString(),
    updatedAt: null
  };

  methods.push(method);
  writePaymentMethods(methods);
  res.status(201).json(toPublicPaymentMethod(method));
});

// PATCH /api/payment-methods/:id  — label-only or full update
router.patch("/:id", (req, res) => {
  const methods = readPaymentMethods();
  const idx     = methods.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Payment method not found." });

  const current  = methods[idx];
  const incoming = req.body || {};

  // If only "label" is sent, skip full re-validation.
  const isLabelOnly =
    Object.prototype.hasOwnProperty.call(incoming, "label") &&
    !Object.prototype.hasOwnProperty.call(incoming, "type") &&
    !Object.prototype.hasOwnProperty.call(incoming, "details");

  if (isLabelOnly) {
    current.label     = sanitizeText(incoming.label, 80) || current.label;
    current.updatedAt = new Date().toISOString();
    methods[idx]      = current;
    writePaymentMethods(methods);
    return res.json(toPublicPaymentMethod(current));
  }

  // Full update — merge then re-validate.
  const normalized = validatePaymentMethodPayload({
    type:    incoming.type || current.type,
    label:   Object.prototype.hasOwnProperty.call(incoming, "label") ? incoming.label : current.label,
    details: { ...(current.details || {}), ...(incoming.details && typeof incoming.details === "object" ? incoming.details : {}) }
  });
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  methods[idx] = { ...current, type: normalized.type, label: normalized.label, details: normalized.details, updatedAt: new Date().toISOString() };
  writePaymentMethods(methods);
  res.json(toPublicPaymentMethod(methods[idx]));
});

// DELETE /api/payment-methods/:id
router.delete("/:id", (req, res) => {
  const methods = readPaymentMethods();
  const idx     = methods.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Payment method not found." });
  methods.splice(idx, 1);
  writePaymentMethods(methods);
  res.status(204).end();
});

module.exports = router;
