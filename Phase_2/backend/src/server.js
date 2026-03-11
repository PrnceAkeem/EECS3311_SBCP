// server.js — entry point. Wires up Express, mounts routes, starts the server.
// Business logic lives in the modules below — keep this file slim.

const express = require("express");
const path    = require("path");

const { PORT }                              = require("./config");
const { pool, ensureSchema, withDbRetries } = require("./db");
const { ensureDataFiles }                   = require("./dataStore");

const bookingsRouter       = require("./routes/bookings");
const paymentMethodsRouter = require("./routes/paymentMethods");
const consultantsRouter    = require("./routes/consultants");
const availabilityRouter   = require("./routes/availability");
const policiesRouter       = require("./routes/policies");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ── Health check ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── API routes ─────────────────────────────────────────────────────────────
app.use("/api/bookings",        bookingsRouter);
app.use("/api/payment-methods", paymentMethodsRouter);
app.use("/api/consultants",     consultantsRouter);
app.use("/api/availability",    availabilityRouter);
app.use("/api/policies",        policiesRouter);

// ── Static frontend ────────────────────────────────────────────────────────
const frontendPath = path.join(__dirname, "..", "..", "frontend");
app.use(express.static(frontendPath));
app.get("/", (_req, res) => res.sendFile(path.join(frontendPath, "index.html")));

// ── Startup ────────────────────────────────────────────────────────────────
async function startServer() {
  ensureDataFiles();
  await withDbRetries(30, 2000, () => pool.query("SELECT 1"));
  await ensureSchema();
  app.listen(PORT, () => console.log(`Synergy app listening on port ${PORT}`));
}

startServer().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
