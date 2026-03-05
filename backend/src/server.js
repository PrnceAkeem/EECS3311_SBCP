const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const {
    RequestedState,
    ConfirmedState,
    PendingPaymentState,
    PaidState,
    CompletedState,
    CancelledState,
    RejectedState
} = require("./statePattern");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://synergy_user:synergy_pass@localhost:5432/synergy";

const STATUS_VALUES = [
  "Requested",
  "Confirmed",
  "Pending Payment",
  "Rejected",
  "Cancelled",
  "Paid",
  "Completed"
];
const STATUS_SQL = STATUS_VALUES.map((status) => `'${status}'`).join(", ");
const VALID_STATUSES = new Set(STATUS_VALUES);
const VALID_ACTORS = new Set(["client", "consultant", "admin", "system"]);

const pool = new Pool({ connectionString: DATABASE_URL });
const streamClients = new Set();

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
    service: row.service,
    price: row.price,
    clientName: row.client_name,
    clientEmail: row.client_email,
    consultantName: row.consultant_name,
    bookingDate: bookingDateValue,
    bookingTime: row.booking_time,
    status: row.status,
    updatedBy: row.updated_by
  };
}

// Simple wrapper for state pattern validation
function validateStateTransition(currentStatus, nextStatus) {
    // Create a simple booking object that the state can work with
    const booking = {
        status: currentStatus,
        setState: function(newState) {
            this.status = newState.getStatus();
        }
    };
    
    // Set initial state
    let currentState;
    switch (currentStatus) {
        case "Requested":
            currentState = new RequestedState(booking);
            break;
        case "Confirmed":
            currentState = new ConfirmedState(booking);
            break;
        case "Pending Payment":
            currentState = new PendingPaymentState(booking);
            break;
        case "Paid":
            currentState = new PaidState(booking);
            break;
        case "Completed":
            currentState = new CompletedState(booking);
            break;
        case "Cancelled":
            currentState = new CancelledState(booking);
            break;
        case "Rejected":
            currentState = new RejectedState(booking);
            break;
        default:
            throw new Error(`Invalid current status: ${currentStatus}`);
    }
    
    booking.state = currentState;
    
    // Try to perform the transition
    try {
        switch (nextStatus) {
            case "Confirmed":
                if (typeof currentState.confirm === 'function') {
                    currentState.confirm();
                } else {
                    throw new Error(`Cannot transition to Confirmed from ${currentStatus}`);
                }
                break;
            case "Pending Payment":
                if (typeof currentState.pendingPayment === 'function') {
                    currentState.pendingPayment();
                } else {
                    throw new Error(`Cannot transition to Pending Payment from ${currentStatus}`);
                }
                break;
            case "Paid":
                if (typeof currentState.pay === 'function') {
                    currentState.pay();
                } else {
                    throw new Error(`Cannot transition to Paid from ${currentStatus}`);
                }
                break;
            case "Completed":
                if (typeof currentState.complete === 'function') {
                    currentState.complete();
                } else {
                    throw new Error(`Cannot transition to Completed from ${currentStatus}`);
                }
                break;
            case "Cancelled":
                if (typeof currentState.cancel === 'function') {
                    currentState.cancel();
                } else {
                    throw new Error(`Cannot transition to Cancelled from ${currentStatus}`);
                }
                break;
            case "Rejected":
                if (typeof currentState.reject === 'function') {
                    currentState.reject();
                } else {
                    throw new Error(`Cannot transition to Rejected from ${currentStatus}`);
                }
                break;
            default:
                throw new Error(`Invalid next status: ${nextStatus}`);
        }
        return true;
    } catch (error) {
        throw error;
    }
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
      console.log(
        `Database not ready yet (attempt ${attempt}/${maxRetries}). Retrying in ${retryDelayMs}ms...`
      );
      await wait(retryDelayMs);
    }
  }
  return null;
}

function broadcastBookingEvent(type, booking) {
  if (!streamClients.size) {
    return;
  }

  const payload = JSON.stringify({ type: type, booking: booking });
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
         service,
         price,
         client_name,
         client_email,
         consultant_name,
         booking_date::text AS booking_date,
         booking_time,
         status,
         updated_by
       FROM bookings
       ORDER BY id ASC`
    );

    response.json(result.rows.map(mapBookingRow));
  } catch (error) {
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
    const result = await pool.query(
      `INSERT INTO bookings (
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Requested', 'client')
       RETURNING
         id,
         service,
         price,
         client_name,
         client_email,
         consultant_name,
         booking_date::text AS booking_date,
         booking_time,
         status,
         updated_by`,
      [
        service,
        price,
        clientName,
        clientEmail,
        consultantName,
        bookingDate,
        bookingTime
      ]
    );

    const booking = mapBookingRow(result.rows[0]);
    broadcastBookingEvent("created", booking);
    response.status(201).json(booking);
  } catch (error) {
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

  try {
    // First get the current booking to check status
    const currentResult = await pool.query(
      `SELECT status FROM bookings WHERE id = $1`,
      [bookingId]
    );

    if (!currentResult.rows.length) {
      response.status(404).json({ error: "Booking not found." });
      return;
    }

    const currentStatus = currentResult.rows[0].status;
    
    // Validate the state transition using the state pattern
    try {
      validateStateTransition(currentStatus, nextStatus);
    } catch (stateError) {
      response.status(400).json({ error: stateError.message });
      return;
    }

    // If valid, update the database
    const result = await pool.query(
      `UPDATE bookings
       SET
         status = $1,
         updated_by = $2
       WHERE id = $3
       RETURNING
         id,
         service,
         price,
         client_name,
         client_email,
         consultant_name,
         booking_date::text AS booking_date,
         booking_time,
         status,
         updated_by`,
      [nextStatus, actor, bookingId]
    );

    const booking = mapBookingRow(result.rows[0]);
    broadcastBookingEvent("updated", booking);
    response.json(booking);
  } catch (error) {
    console.error("Failed to update booking status", error);
    response.status(500).json({ error: "Failed to update booking status." });
  }
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
    console.log(`Synergy app listening on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});