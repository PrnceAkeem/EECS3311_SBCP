// routes/bookings.js — booking CRUD + SSE stream.
// Patterns used here: State (transition validation), Strategy (payment), Factory (actors).

const express = require("express");
const router  = express.Router();

const { pool }               = require("../db");
const { readSystemPolicies } = require("../dataStore");
const {
  sanitizeStatus, sanitizeActor, sanitizeDate, sanitizeSlotTime,
  isValidEmail, applyPricingPolicy, parsePriceAmount, parseBookingDateTime,
  paymentMethodPrefix, buildTransactionId,
  buildCanonicalBookingRef, buildCanonicalCustomerId,
  findPaymentMethodById, createBookingActors, mapBookingRow
} = require("../helpers");
const { streamClients, broadcastBookingEvent } = require("../sse");
const BookingStateMachine       = require("../patterns/state/BookingStateMachine");
const { PaymentStrategyFactory } = require("../patterns/strategy/PaymentStrategies");

// Reusable SELECT column list to keep queries consistent.
const COLS = `
  id, booking_ref, customer_id, service, price,
  client_name, client_email, consultant_name,
  booking_date::text AS booking_date, booking_time, status,
  payment_status, payment_transaction_id, payment_processed_at,
  refund_transaction_id, refund_processed_at,
  created_at, updated_at, updated_by`;

// GET /api/bookings
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(`SELECT ${COLS} FROM bookings ORDER BY id ASC`);
    res.json(result.rows.map(mapBookingRow));
  } catch (err) {
    console.error("GET /api/bookings", err);
    res.status(500).json({ error: "Failed to fetch bookings." });
  }
});

// POST /api/bookings
router.post("/", async (req, res) => {
  const { service, price, clientName, clientEmail, consultantName, bookingDate, bookingTime } = req.body || {};
  const safeDate = sanitizeDate(bookingDate);
  const safeTime = sanitizeSlotTime(bookingTime);

  if (!service || !price || !clientName || !clientEmail || !consultantName || !safeDate || !safeTime) {
    return res.status(400).json({ error: "Missing required booking fields." });
  }
  if (!isValidEmail(clientEmail)) {
    return res.status(400).json({ error: "Client email format is invalid." });
  }

  // Factory pattern — build typed client & consultant objects.
  let actors;
  try {
    actors = createBookingActors({ service, clientName, clientEmail, consultantName });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Failed to create booking actors." });
  }

  try {
    // Slot must exist and be available.
    const slotResult = await pool.query(
      `SELECT id, is_available FROM availability_slots
       WHERE consultant_name = $1 AND slot_date = $2 AND slot_time = $3 LIMIT 1`,
      [actors.consultant.name, safeDate, safeTime]
    );
    if (!slotResult.rows.length)          return res.status(422).json({ error: "Selected consultant/time is not available. Please choose an available slot." });
    if (!slotResult.rows[0].is_available) return res.status(409).json({ error: "This time slot is no longer available." });

    // No double-booking.
    const conflict = await pool.query(
      `SELECT id FROM bookings
       WHERE consultant_name = $1 AND booking_date = $2 AND booking_time = $3
         AND status NOT IN ('Rejected','Cancelled','Completed') LIMIT 1`,
      [actors.consultant.name, safeDate, safeTime]
    );
    if (conflict.rows.length) return res.status(409).json({ error: "Consultant is already booked for this date/time." });

    const policies     = readSystemPolicies();
    const adjustedPrice = applyPricingPolicy(price, policies.pricingMultiplier);

    const insert = await pool.query(
      `INSERT INTO bookings (service, price, client_name, client_email, consultant_name, booking_date, booking_time, status, payment_status, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Requested',NULL,'client') RETURNING id`,
      [service.trim().slice(0, 120), adjustedPrice, actors.client.name, actors.client.email, actors.consultant.name, safeDate, safeTime]
    );

    const newId  = insert.rows[0].id;
    const result = await pool.query(
      `UPDATE bookings SET booking_ref = $1, customer_id = $2 WHERE id = $3 RETURNING ${COLS}`,
      [buildCanonicalBookingRef(newId), buildCanonicalCustomerId(newId), newId]
    );

    // Mark the slot as taken.
    await pool.query(
      `UPDATE availability_slots SET is_available = FALSE, updated_at = NOW() WHERE id = $1`,
      [slotResult.rows[0].id]
    );

    const booking = mapBookingRow(result.rows[0]);
    broadcastBookingEvent("created", booking, { pricingMultiplier: policies.pricingMultiplier });
    res.status(201).json(booking);
  } catch (err) {
    console.error("POST /api/bookings", err);
    res.status(500).json({ error: "Failed to create booking." });
  }
});

// PATCH /api/bookings/:id/status
router.patch("/:id/status", async (req, res) => {
  const bookingId = Number(req.params.id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return res.status(400).json({ error: "Invalid booking id." });
  }

  const nextStatus       = sanitizeStatus(req.body?.status);
  const actor            = sanitizeActor(req.body?.actor);
  const paymentMethodId  = req.body?.paymentMethodId;
  const paymentMethodType = req.body?.paymentMethodType;

  try {
    const { rows } = await pool.query(
      `SELECT status, price, consultant_name,
              booking_date::text AS booking_date, booking_time,
              payment_status, payment_transaction_id, payment_processed_at,
              refund_transaction_id, refund_processed_at
       FROM bookings WHERE id = $1`,
      [bookingId]
    );
    if (!rows.length) return res.status(404).json({ error: "Booking not found." });

    const current = rows[0];

    // State pattern — validates the transition is legal.
    try {
      BookingStateMachine.transition(current.status, nextStatus);
    } catch (err) {
      return res.status(422).json({ error: err.message });
    }

    // Cancellation window check (client-initiated only).
    if (nextStatus === "Cancelled" && actor === "client") {
      const policies  = readSystemPolicies();
      const bookingAt = parseBookingDateTime(current.booking_date, current.booking_time);
      const windowMs  = Number(policies.cancellationWindowHours) * 3_600_000;
      if (bookingAt && Number.isFinite(windowMs) && windowMs > 0 && bookingAt.getTime() - Date.now() < windowMs) {
        return res.status(422).json({
          error: `Cancellations must be made at least ${policies.cancellationWindowHours} hours before the session.`
        });
      }
    }

    // Carry forward existing payment tracking columns by default.
    let nextPaymentStatus        = current.payment_status || null;
    let nextPaymentTransactionId = current.payment_transaction_id || null;
    let nextPaymentProcessedAt   = current.payment_processed_at || null;
    let nextRefundTransactionId  = current.refund_transaction_id || null;
    let nextRefundProcessedAt    = current.refund_processed_at || null;
    let paymentReceipt           = null;
    let refundReceipt            = null;

    if (nextStatus === "Pending Payment") {
      // Reset payment fields — fresh payment will be captured later.
      nextPaymentStatus = "Pending";
      nextPaymentTransactionId = nextPaymentProcessedAt = nextRefundTransactionId = nextRefundProcessedAt = null;
    }

    if (nextStatus === "Paid") {
      if (!paymentMethodType || !paymentMethodId)
        return res.status(400).json({ error: "paymentMethodType and paymentMethodId are required when paying." });
      if (actor !== "client")
        return res.status(403).json({ error: "Only the client can complete payment." });

      const savedMethod = findPaymentMethodById(paymentMethodId);
      if (!savedMethod)
        return res.status(400).json({ error: "Selected payment method was not found." });
      if (savedMethod.type !== paymentMethodType)
        return res.status(400).json({ error: "paymentMethodType does not match the saved payment method." });

      // Strategy pattern — pick the right payment handler for this method type.
      let strategy;
      try { strategy = PaymentStrategyFactory.create(savedMethod.type); }
      catch (err) { return res.status(400).json({ error: err.message || "Unsupported payment method." }); }

      const result = strategy.process(parsePriceAmount(current.price), {
        methodId: savedMethod.id, methodType: savedMethod.type,
        label: savedMethod.label, details: savedMethod.details || {}
      });
      if (!result.success) return res.status(422).json({ error: result.message || "Payment processing failed." });

      const txnId     = current.payment_transaction_id || buildTransactionId(paymentMethodPrefix(savedMethod.type), bookingId);
      const processedAt = current.payment_processed_at || new Date().toISOString();

      paymentReceipt           = { transactionId: txnId, methodType: savedMethod.type, methodLabel: savedMethod.label, processedAt };
      nextPaymentStatus        = "Success";
      nextPaymentTransactionId = txnId;
      nextPaymentProcessedAt   = processedAt;
      nextRefundTransactionId  = null;
      nextRefundProcessedAt    = null;
    }

    if (current.status === "Paid" && nextStatus === "Cancelled") {
      const rfTxnId = current.refund_transaction_id || buildTransactionId("RF", bookingId);
      const rfAt    = current.refund_processed_at   || new Date().toISOString();
      refundReceipt           = { refundTransactionId: rfTxnId, refundedAt: rfAt };
      nextPaymentStatus       = "Refunded";
      nextRefundTransactionId = rfTxnId;
      nextRefundProcessedAt   = rfAt;
    }

    const updated = await pool.query(
      `UPDATE bookings
       SET status=$1, updated_at=NOW(), updated_by=$2,
           payment_status=$4, payment_transaction_id=$5, payment_processed_at=$6,
           refund_transaction_id=$7, refund_processed_at=$8
       WHERE id=$3 RETURNING ${COLS}`,
      [nextStatus, actor, bookingId,
       nextPaymentStatus, nextPaymentTransactionId, nextPaymentProcessedAt,
       nextRefundTransactionId, nextRefundProcessedAt]
    );
    if (!updated.rows.length) return res.status(404).json({ error: "Booking not found." });

    // Free the slot when the booking ends.
    if (nextStatus === "Cancelled" || nextStatus === "Rejected") {
      await pool.query(
        `UPDATE availability_slots SET is_available = TRUE, updated_at = NOW()
         WHERE consultant_name=$1 AND slot_date=$2 AND slot_time=$3`,
        [current.consultant_name, current.booking_date, current.booking_time]
      );
    }

    const booking     = mapBookingRow(updated.rows[0]);
    const metaPayload = {
      ...(paymentReceipt ? { payment: paymentReceipt } : {}),
      ...(refundReceipt  ? { refund:  refundReceipt  } : {})
    };

    // Observer pattern — broadcast to all SSE clients + notification notifiers.
    broadcastBookingEvent("updated", booking, Object.keys(metaPayload).length ? metaPayload : null);
    res.json({ ...booking, ...metaPayload });
  } catch (err) {
    console.error("PATCH /api/bookings/:id/status", err);
    res.status(500).json({ error: "Failed to update booking status." });
  }
});

// GET /api/bookings/stream  — SSE (real-time updates)
// NOTE: must be declared before /:id routes so Express doesn't treat "stream" as an id.
router.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write("event: connected\ndata: {}\n\n");
  streamClients.add(res);
  req.on("close", () => streamClients.delete(res));
});

module.exports = router;
