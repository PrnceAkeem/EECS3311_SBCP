const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://synergy_user:synergy_pass@localhost:5432/synergy";

const VALID_STATUSES = new Set(["Requested", "Completed", "Cancelled"]);
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

  return {
    id: row.id,
    service: row.service,
    price: row.price,
    clientName: row.client_name,
    clientEmail: row.client_email,
    consultantName: row.consultant_name,
    bookingDate: row.booking_date,
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
         booking_date,
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
         booking_date,
         booking_time,
         status,
         created_at,
         updated_at,
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

  try {
    const result = await pool.query(
      `UPDATE bookings
       SET
         status = $1,
         updated_at = NOW(),
         updated_by = $2
       WHERE id = $3
       RETURNING
         id,
         service,
         price,
         client_name,
         client_email,
         consultant_name,
         booking_date,
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
    broadcastBookingEvent("updated", booking);
    response.json(booking);
  } catch (error) {
    // eslint-disable-next-line no-console
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
