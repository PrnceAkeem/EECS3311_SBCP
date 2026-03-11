// routes/consultants.js — consultant directory + registration approval flow.

const express = require("express");
const router  = express.Router();

const {
  readConsultants, writeConsultants,
  readConsultantRegistrations, writeConsultantRegistrations,
  consultantIdNumber, sanitizeText
} = require("../dataStore");
const { toPublicConsultant, isValidEmail, sanitizeActor, sanitizeRegistrationStatus } = require("../helpers");

// ── Consultant directory ───────────────────────────────────────────────────

// GET /api/consultants
router.get("/", (_req, res) => {
  const consultants = readConsultants()
    .map(toPublicConsultant)
    .filter(Boolean)
    .sort((a, b) => {
      const aId = consultantIdNumber(a.id) || Number.MAX_SAFE_INTEGER;
      const bId = consultantIdNumber(b.id) || Number.MAX_SAFE_INTEGER;
      return aId - bId;
    });
  res.json(consultants);
});

// POST /api/consultants  (admin only)
router.post("/", (req, res) => {
  const actor = sanitizeActor(req.body?.actor);
  if (actor !== "admin") return res.status(403).json({ error: "Only admin can add consultants." });

  const name      = sanitizeText(req.body?.name, 80);
  const expertise = sanitizeText(req.body?.expertise, 120) || "general";
  const email     = sanitizeText(req.body?.email, 120).toLowerCase();

  if (!name)                       return res.status(400).json({ error: "Consultant name is required." });
  if (email && !isValidEmail(email)) return res.status(400).json({ error: "Consultant email format is invalid." });

  const consultants = readConsultants();
  const nameKey = name.toLowerCase();
  const duplicate = consultants.find((c) => {
    const cName  = String(c.name  || "").trim().toLowerCase();
    const cEmail = String(c.email || "").trim().toLowerCase();
    return (cName && cName === nameKey) || (email && cEmail && cEmail === email);
  });
  if (duplicate) return res.status(409).json({ error: "Consultant already exists." });

  const consultant = { id: `con_${consultants.length + 1}`, name, email, expertise, createdAt: new Date().toISOString() };
  consultants.push(consultant);
  writeConsultants(consultants);
  res.status(201).json(toPublicConsultant(consultant));
});

// ── Consultant registrations ───────────────────────────────────────────────

// GET /api/consultants/registrations
router.get("/registrations", (_req, res) => {
  const registrations = readConsultantRegistrations()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(registrations);
});

// POST /api/consultants/registrations  (consultant self-registers)
router.post("/registrations", (req, res) => {
  const name      = sanitizeText(req.body?.name, 80);
  const email     = sanitizeText(req.body?.email, 120).toLowerCase();
  const expertise = sanitizeText(req.body?.expertise, 120) || "general";

  if (!name || !email)      return res.status(400).json({ error: "name and email are required." });
  if (!isValidEmail(email)) return res.status(400).json({ error: "email format is invalid." });

  const registrations = readConsultantRegistrations();
  if (registrations.find((r) => r.email === email && r.status !== "Rejected")) {
    return res.status(409).json({ error: "A registration already exists for this email." });
  }

  const registration = {
    id:         `reg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name, email, expertise,
    status:     "Pending",
    createdAt:  new Date().toISOString(),
    reviewedAt: null, reviewedBy: null
  };
  registrations.push(registration);
  writeConsultantRegistrations(registrations);
  res.status(201).json(registration);
});

// PATCH /api/consultants/registrations/:id  (admin approves or rejects)
router.patch("/registrations/:id", (req, res) => {
  const { id } = req.params;
  const status  = sanitizeRegistrationStatus(req.body?.status);
  const actor   = sanitizeActor(req.body?.actor);

  if (status === "Pending") return res.status(400).json({ error: "status must be Approved or Rejected." });
  if (actor !== "admin")    return res.status(403).json({ error: "Only admin can review consultant registrations." });

  const registrations = readConsultantRegistrations();
  const idx = registrations.findIndex((r) => r.id === id);
  if (idx === -1) return res.status(404).json({ error: "Consultant registration not found." });

  registrations[idx] = { ...registrations[idx], status, reviewedAt: new Date().toISOString(), reviewedBy: actor };
  writeConsultantRegistrations(registrations);

  // Auto-add to directory when approved.
  if (status === "Approved") {
    const reg         = registrations[idx];
    const consultants = readConsultants();
    const approvedName  = String(reg.name  || "").trim().toLowerCase();
    const approvedEmail = String(reg.email || "").trim().toLowerCase();
    const exists = consultants.some((c) => {
      const cName  = String(c.name  || "").trim().toLowerCase();
      const cEmail = String(c.email || "").trim().toLowerCase();
      return (approvedName && cName === approvedName) || (approvedEmail && cEmail && cEmail === approvedEmail);
    });
    if (!exists) {
      consultants.push({ id: `con_${consultants.length + 1}`, name: reg.name, email: reg.email, expertise: reg.expertise || "general", createdAt: new Date().toISOString() });
      writeConsultants(consultants);
    }
  }

  res.json(registrations[idx]);
});

module.exports = router;
