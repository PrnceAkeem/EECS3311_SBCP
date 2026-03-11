// routes/availability.js — consultant availability slot management.

const express = require("express");
const router  = express.Router();

const { pool }                                      = require("../db");
const { sanitizeText }                              = require("../dataStore");
const { sanitizeDate, sanitizeSlotTime, parseBookingDateTime } = require("../helpers");

// GET /api/availability?consultantName=&bookingDate=
router.get("/", async (req, res) => {
  const consultantName = sanitizeText(req.query.consultantName, 120);
  const bookingDate    = sanitizeDate(req.query.bookingDate);

  const clauses = [], values = [];
  if (consultantName) { values.push(consultantName); clauses.push(`consultant_name = $${values.length}`); }
  if (bookingDate)    { values.push(bookingDate);    clauses.push(`slot_date = $${values.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  try {
    const result = await pool.query(
      `SELECT id, consultant_name, slot_date::text AS slot_date, slot_time, is_available, created_at, updated_at
       FROM availability_slots ${where}
       ORDER BY slot_date ASC, slot_time ASC`,
      values
    );
    res.json(result.rows.map((r) => ({
      id:             r.id,
      consultantName: r.consultant_name,
      bookingDate:    r.slot_date,
      bookingTime:    r.slot_time,
      isAvailable:    r.is_available,
      createdAt:      r.created_at,
      updatedAt:      r.updated_at
    })));
  } catch (err) {
    console.error("GET /api/availability", err);
    res.status(500).json({ error: "Failed to fetch availability." });
  }
});

// POST /api/availability
router.post("/", async (req, res) => {
  const consultantName = sanitizeText(req.body?.consultantName, 120);
  const bookingDate    = sanitizeDate(req.body?.bookingDate);
  const bookingTime    = sanitizeSlotTime(req.body?.bookingTime);

  if (!consultantName || !bookingDate || !bookingTime) {
    return res.status(400).json({ error: "consultantName, bookingDate, and bookingTime are required." });
  }

  const slotDate = parseBookingDateTime(bookingDate, bookingTime);
  if (!slotDate || slotDate.getTime() < Date.now()) {
    return res.status(422).json({ error: "Availability must be set for a future date/time." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO availability_slots (consultant_name, slot_date, slot_time, is_available, updated_at)
       VALUES ($1, $2, $3, TRUE, NOW())
       ON CONFLICT (consultant_name, slot_date, slot_time) DO UPDATE SET is_available = TRUE, updated_at = NOW()
       RETURNING id, consultant_name, slot_date::text AS slot_date, slot_time, is_available, created_at, updated_at`,
      [consultantName, bookingDate, bookingTime]
    );
    const r = result.rows[0];
    res.status(201).json({
      id:             r.id,
      consultantName: r.consultant_name,
      bookingDate:    r.slot_date,
      bookingTime:    r.slot_time,
      isAvailable:    r.is_available,
      createdAt:      r.created_at,
      updatedAt:      r.updated_at
    });
  } catch (err) {
    console.error("POST /api/availability", err);
    res.status(500).json({ error: "Failed to create availability slot." });
  }
});

// DELETE /api/availability/:id
router.delete("/:id", async (req, res) => {
  const slotId = Number(req.params.id);
  if (!Number.isInteger(slotId) || slotId <= 0) {
    return res.status(400).json({ error: "Invalid availability id." });
  }

  try {
    const result = await pool.query(
      `DELETE FROM availability_slots WHERE id = $1 RETURNING id`,
      [slotId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Availability slot not found." });
    res.status(204).end();
  } catch (err) {
    console.error("DELETE /api/availability/:id", err);
    res.status(500).json({ error: "Failed to delete availability slot." });
  }
});

module.exports = router;
