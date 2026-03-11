# Phase 2 — Service Booking & Consulting Platform
Group 8, EECS 3311 Software Design
York University, Lassonde School of Engineering
Winter 2026

## What This Phase Does

Phase 2 extends Phase 1 with a fully modular backend, payment processing, refund handling,
consultant availability management, consultant registration approvals, and admin system policies.

Three user roles are supported:
- **Client** — browse services, create bookings, cancel, pay for confirmed sessions, view payment history
- **Consultant** — manage availability slots, confirm/reject/complete bookings
- **Admin** — manage the consultant directory, approve registrations, configure system policies, oversee all bookings

The frontend is static HTML/CSS/JS served by Express. The backend is a Node.js/Express API backed by PostgreSQL (bookings + availability) and JSON files (payment methods, consultants, policies).

---

## How to Run

Requires Docker Desktop to be running.

```bash
# from the Phase_2/ directory
docker compose up --build
```

| URL | What it is |
|-----|-----------|
| `http://localhost:3000` | App (login page) |
| `http://localhost:3000/health` | Health check |

```bash
docker compose down       # stop
docker compose down -v    # stop + delete DB volume
```

### Demo login credentials

| Role | Email | Password |
|------|-------|----------|
| Client | client@synergy.ca | pass12345 |
| Consultant | consultant@synergy.ca | pass12345 |
| Admin | admin@synergy.ca | pass12345 |

---

## Backend Module Structure

The original single `server.js` (1600+ lines) has been split into focused modules.
When debugging, go directly to the file responsible for the area that broke.

```
backend/src/
├── server.js              Entry point — mounts routes, starts server (~46 lines)
├── config.js              All constants and default values (PORT, file paths, status lists)
├── db.js                  DB pool, ensureSchema(), withDbRetries()
├── dataStore.js           JSON file I/O (payment methods, consultants, registrations, policies)
├── helpers.js             Input sanitization, validators, price/date transforms, mapBookingRow
├── sse.js                 SSE stream set + broadcastBookingEvent() (Observer wiring)
├── patterns/
│   ├── state/             State pattern — BookingStateMachine + per-state classes
│   ├── strategy/          Strategy pattern — PaymentStrategies + PaymentStrategyFactory
│   ├── observer/          Observer pattern — NotificationManager, Email/SMS/Push notifiers
│   └── factory/           Factory pattern — UserFactory, Client, Consultant, Admin
└── routes/
    ├── bookings.js        GET/POST /api/bookings, PATCH /:id/status, GET /stream
    ├── paymentMethods.js  GET/POST/PATCH/DELETE /api/payment-methods
    ├── consultants.js     GET/POST /api/consultants + registration approval endpoints
    ├── availability.js    GET/POST/DELETE /api/availability
    └── policies.js        GET/PUT /api/policies
```

### Where to look when something breaks

| Symptom | File to check |
|---------|---------------|
| Booking won't save to DB | `routes/bookings.js` → POST handler |
| Status change rejected | `routes/bookings.js` → PATCH handler + `patterns/state/` |
| Payment fails | `routes/bookings.js` → "Paid" block + `patterns/strategy/` |
| Refund not issued | `routes/bookings.js` → "Paid → Cancelled" block |
| SSE not pushing updates | `sse.js` → `broadcastBookingEvent()` |
| Notifications not logging | `sse.js` + `patterns/observer/` |
| Consultant not appearing | `dataStore.js` → `readConsultants()` / `normalizeConsultants()` |
| Policy not applying | `routes/policies.js` + `helpers.js` → `normalizePoliciesPayload()` |
| DB schema out of sync | `db.js` → `ensureSchema()` |
| Validation error unclear | `helpers.js` → `validatePaymentMethodPayload()` or sanitize functions |

---

## Request Flow

```
Client browser
      |
      | fetch() / EventSource
      v
frontend/js/bookings-data.js  (window.BookingStore)
  getBookings()         -> GET   /api/bookings
  addBooking()          -> POST  /api/bookings
  updateBookingStatus() -> PATCH /api/bookings/:id/status
  subscribe()           -> GET   /api/bookings/stream  (SSE)

frontend/js/methods.js  (direct fetch)
  loadMethods()         -> GET    /api/payment-methods
  save method           -> POST   /api/payment-methods
  delete method         -> DELETE /api/payment-methods/:id

booking.js payment modal
  fetch saved methods   -> GET  /api/payment-methods
  pay for booking       -> PATCH /api/bookings/:id/status  (via BookingStore)
      |
      | JSON over HTTP
      v
backend/src/server.js  (Express — routes only, no logic)
      |
      ├── routes/bookings.js       State + Strategy + Factory + Observer
      ├── routes/paymentMethods.js
      ├── routes/consultants.js
      ├── routes/availability.js
      └── routes/policies.js
      |
      v
PostgreSQL (bookings, availability_slots)
backend/data/*.json    (payment-methods, consultants, registrations, policies)
```

---

## API Endpoints

### Bookings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bookings` | List all bookings |
| POST | `/api/bookings` | Create a booking |
| PATCH | `/api/bookings/:id/status` | Update booking status |
| GET | `/api/bookings/stream` | SSE stream for live updates |

### Payment Methods
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/payment-methods` | List saved methods |
| POST | `/api/payment-methods` | Add a method |
| PATCH | `/api/payment-methods/:id` | Edit label or details |
| DELETE | `/api/payment-methods/:id` | Remove a method |

### Consultants
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/consultants` | List all consultants |
| POST | `/api/consultants` | Add consultant (admin) |
| GET | `/api/consultants/registrations` | List self-registrations |
| POST | `/api/consultants/registrations` | Submit a registration |
| PATCH | `/api/consultants/registrations/:id` | Approve or reject (admin) |

### Availability
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/availability` | List slots (filter by consultant/date) |
| POST | `/api/availability` | Add a slot |
| DELETE | `/api/availability/:id` | Remove a slot |

### Policies
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/policies` | Get system policies |
| PUT | `/api/policies` | Update system policies (admin) |

---

## Booking Status Model

Transitions are enforced by the State Pattern (`patterns/state/BookingStateMachine.js`).

```
Requested ──► Confirmed ──► Pending Payment ──► Paid ──► Completed
    │              │               │              │
    └──► Rejected  └──► Cancelled  └──► Cancelled └──► Cancelled (triggers refund)
```

Terminal states — no further transitions allowed: `Completed`, `Rejected`, `Cancelled`

---

## GoF Design Patterns

| Pattern | File | When It Runs |
|---------|------|-------------|
| **State** | `patterns/state/BookingStateMachine.js` | Every `PATCH /api/bookings/:id/status` — rejects illegal transitions |
| **Strategy** | `patterns/strategy/PaymentStrategies.js` | When status moves to `Paid` — picks the right payment handler (Credit Card, Debit, Bank Transfer, PayPal) |
| **Observer** | `patterns/observer/NotificationManager.js` | After every status change — `broadcastBookingEvent()` fans out to Email, SMS, and Push notifiers + SSE clients |
| **Factory** | `patterns/factory/UserFactory.js` | On `POST /api/bookings` — builds typed `Client` and `Consultant` objects for the booking |

---

## Repository
GitHub: [https://github.com/PrnceAkeem/EECS3311_SBCP]
