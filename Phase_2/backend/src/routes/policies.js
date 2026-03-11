// routes/policies.js — system policy read and update (admin only).

const express = require("express");
const router  = express.Router();

const { readSystemPolicies, writeSystemPolicies } = require("../dataStore");
const { normalizePoliciesPayload }                = require("../helpers");

// GET /api/policies
router.get("/", (_req, res) => {
  res.json(readSystemPolicies());
});

// PUT /api/policies
router.put("/", (req, res) => {
  const next = normalizePoliciesPayload(req.body);
  writeSystemPolicies(next);
  res.json(next);
});

module.exports = router;
