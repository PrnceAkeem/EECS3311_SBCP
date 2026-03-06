const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

// =============================================================================
// GoF State Pattern — import the state machine
// BookingStateMachine validates that a status transition is allowed before
// we touch the database. e.g. you cannot move from "Completed" → "Cancelled".
// =============================================================================
const BookingStateMachine = require("./patterns/state/BookingStateMachine");
const { PaymentStrategyFactory } = require("./patterns/strategy/PaymentStrategies");
const {
  NotificationManager,
  EmailNotifier,
  SmsNotifier,
  PushNotifier
} = require("./patterns/observer/NotificationManager");
const UserFactory = require("./patterns/factory/UserFactory");

// Runtime interaction map:
// - REST endpoints accept booking/payment requests from frontend pages.
// - State pattern validates every status transition.
// - Factory Method creates role-specific booking actors.
// - Strategy handles payment processing when status moves to "Paid".
// - Observer emits notification logs when booking events are broadcast.

// =============================================================================
// Payment Methods — stored in a JSON file for easy viewing and editing.
// The file lives at backend/data/payment-methods.json.
// This is simpler than PostgreSQL and makes it easy to inspect or reset data.
// =============================================================================
const PAYMENT_METHODS_FILE = path.join(__dirname, "..", "data", "payment-methods.json");

// Reads the payment methods array from disk. Returns [] if the file is missing.
function readPaymentMethods() {
  try {
    return JSON.parse(fs.readFileSync(PAYMENT_METHODS_FILE, "utf8"));
  } catch {
    return [];
  }
}

// Writes the payment methods array back to disk, pretty-printed.
function writePaymentMethods(data) {
  const dir = path.dirname(PAYMENT_METHODS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PAYMENT_METHODS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function findPaymentMethodById(methodId) {
  if (!methodId) {
    return null;
  }
  const methods = readPaymentMethods();
  return methods.find((method) => method.id === methodId) || null;
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://synergy_user:synergy_pass@localhost:5432/synergy";

// All valid booking statuses — must stay in sync with the State Pattern classes.
// "Pending Payment" is the intermediate state between Confirmed and Paid.
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

const pool = new Pool({ connectionString: DATABASE_URL });
const streamClients = new Set();
const userFactory = new UserFactory();
const notificationManager = new NotificationManager();

notificationManager.attach(new EmailNotifier());
notificationManager.attach(new SmsNotifier());
notificationManager.attach(new PushNotifier());

app.use(express.json({ limit: "1mb" }));

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function mapBookingRow(row) {
  if (!row) {
    return null;
  }

  const bookingDateValue =
    row.booking_date instanceof Date
      ? row.booking_date.toISOString().slice(0, 10)
      : String(row.booking_date || "");

  return {
    id: row.id,
    bookingRef: row.booking_ref || null,
    customerId: row.customer_id || null,
    service: row.service,
    price: row.price,
    clientName: row.client_name,
    clientEmail: row.client_email,
    consultantName: row.consultant_name,
    bookingDate: bookingDateValue,
    bookingTime: row.booking_time,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  };
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
  // Factory Method integration point:
  // server.js does not instantiate concrete user classes directly.
  // It asks UserFactory for each role-specific object.
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

function parsePriceAmount(rawPrice) {
  const parsed = Number(String(rawPrice || "").replace(/[^0-9.]/g, ""));
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed.toFixed(2);
  }
  return String(rawPrice || "0");
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

  // Add booking_ref and customer_id columns for display-friendly prefixed IDs.
  await pool.query(
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_ref TEXT`
  );
  await pool.query(
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_id TEXT`
  );

  // Backfill any rows that existed before these columns were added.
  await pool.query(
    `UPDATE bookings
     SET booking_ref = 'bk_' || id,
         customer_id = 'cu_' || id
     WHERE booking_ref IS NULL`
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
  notificationManager.sendNotification(`booking.${type}`, {
    bookingId: booking?.id || null,
    status: booking?.status || null,
    updatedBy: booking?.updatedBy || null,
    metadata: metadata || undefined
  });

  if (!streamClients.size) {
    return;
  }

  const payload = JSON.stringify(
    metadata ? { type: type, booking: booking, metadata: metadata } : { type: type, booking: booking }
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

  if (
    !service ||
    !price ||
    !clientName ||
    !clientEmail ||
    !consultantName ||
    !bookingDate ||
    !bookingTime
  ) {
    response.status(400).json({ error: "Missing required booking fields." });
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

    const now = Date.now();
    const bookingRef = `bk_${now}`;
    const customerId = `cu_${now}${Math.random().toString(36).slice(2, 6)}`;

    const result = await pool.query(
      `INSERT INTO bookings (
         booking_ref,
         customer_id,
         service,
         price,
         client_name,
         client_email,
         consultant_name,
         booking_date,
         booking_time,
         status,
         updated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Requested', 'client')
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
         created_at,
         updated_at,
         updated_by`,
      [
        bookingRef,
        customerId,
        service,
        price,
        actors.client.name,
        actors.client.email,
        actors.consultant.name,
        bookingDate,
        bookingTime
      ]
    );

    const booking = mapBookingRow(result.rows[0]);
    broadcastBookingEvent("created", booking);
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
    // -------------------------------------------------------------------------
    // GoF State Pattern — validate the transition BEFORE updating the database.
    //
    // Step 1: Fetch the booking's current status from the DB.
    // Step 2: Ask the BookingStateMachine if the transition is allowed.
    // Step 3: If not allowed, return a 422 error with a clear message.
    // Step 4: If allowed, proceed with the UPDATE query as normal.
    // -------------------------------------------------------------------------

    // Step 1: Get the current status
    const currentRow = await pool.query(
      "SELECT status, price FROM bookings WHERE id = $1",
      [bookingId]
    );

    if (!currentRow.rows.length) {
      response.status(404).json({ error: "Booking not found." });
      return;
    }

    const currentStatus = currentRow.rows[0].status;
    const currentPrice = currentRow.rows[0].price;

    // Step 2 & 3: Validate the transition using the State Pattern
    try {
      BookingStateMachine.transition(currentStatus, nextStatus);
    } catch (transitionError) {
      // The state machine threw — this transition is not allowed
      response.status(422).json({
        error: transitionError.message
      });
      return;
    }

    let paymentReceipt = null;
    if (nextStatus === "Paid") {
      if (!paymentMethodType || !paymentMethodId) {
        response.status(400).json({
          error: "paymentMethodType and paymentMethodId are required when paying."
        });
        return;
      }

      if (actor !== "client") {
        response.status(403).json({
          error: "Only the client can complete payment."
        });
        return;
      }

      const savedMethod = findPaymentMethodById(paymentMethodId);
      if (!savedMethod) {
        response.status(400).json({
          error: "Selected payment method was not found."
        });
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

      const paymentResult = paymentStrategy.process(parsePriceAmount(currentPrice), {
        methodId: savedMethod.id,
        methodType: savedMethod.type,
        label: savedMethod.label
      });

      if (!paymentResult.success) {
        response.status(422).json({
          error: paymentResult.message || "Payment processing failed."
        });
        return;
      }


      paymentReceipt = {
        transactionId: paymentResult.transactionId,
        methodType: savedMethod.type,
        methodLabel: savedMethod.label,
        processedAt: new Date().toISOString()
      };
    }

    // Step 4: Transition is valid — update the database
    const result = await pool.query(
      `UPDATE bookings
       SET
         status = $1,
         updated_at = NOW(),
         updated_by = $2
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
         created_at,
         updated_at,
         updated_by`,
      [nextStatus, actor, bookingId]
    );

    if (!result.rows.length) {
      response.status(404).json({ error: "Booking not found." });
      return;
    }

    const booking = mapBookingRow(result.rows[0]);
    const responsePayload = paymentReceipt ? { ...booking, payment: paymentReceipt } : booking;
    const metadataPayload = paymentReceipt ? { payment: paymentReceipt } : null;
    broadcastBookingEvent("updated", booking, metadataPayload);
    response.json(responsePayload);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to update booking status", error);
    response.status(500).json({ error: "Failed to update booking status." });
  }
});

// =============================================================================
// Payment Methods API
// GET    /api/payment-methods      — list all saved methods
// POST   /api/payment-methods      — add a new method { type, label }
// DELETE /api/payment-methods/:id  — remove a method by id
// =============================================================================

// Must match exactly what the frontend dropdowns offer.
// Spec requires: Credit Card, Debit Card, Bank Transfer, PayPal.
const ALLOWED_METHOD_TYPES = [
  "Credit Card",
  "Debit Card",
  "Bank Transfer",
  "PayPal"
];

app.get("/api/payment-methods", (_request, response) => {
  response.json(readPaymentMethods());
});

app.post("/api/payment-methods", (request, response) => {
  const { type, label } = request.body || {};

  if (!type || !label) {
    response.status(400).json({ error: "type and label are required." });
    return;
  }
  if (!ALLOWED_METHOD_TYPES.includes(type)) {
    response.status(400).json({
      error: `type must be one of: ${ALLOWED_METHOD_TYPES.join(", ")}.`
    });
    return;
  }

  const methods = readPaymentMethods();
  const newMethod = {
    id: `pm_${Date.now()}`,
    type: type,
    label: String(label).slice(0, 80), // cap label length
    createdAt: new Date().toISOString()
  };
  methods.push(newMethod);
  writePaymentMethods(methods);
  response.status(201).json(newMethod);
});

app.delete("/api/payment-methods/:id", (request, response) => {
  const { id } = request.params;
  const methods = readPaymentMethods();
  const idx = methods.findIndex((m) => m.id === id);
  if (idx === -1) {
    response.status(404).json({ error: "Payment method not found." });
    return;
  }
  methods.splice(idx, 1);
  writePaymentMethods(methods);
  response.status(204).end();
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

const frontendPath = path.join(__dirname, "..", "..", "frontend");
app.use(express.static(frontendPath));

app.get("/", (_request, response) => {
  response.sendFile(path.join(frontendPath, "index.html"));
});

async function startServer() {
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
