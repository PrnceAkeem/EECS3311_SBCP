# Service Booking and Consulting Platform
Group 8, EECS 3311 Software Design  
York University, Lassonde School of Engineering  
Winter 2026

## What This Project Does
This is a multi-role booking system with three user-facing flows:
- Client: create bookings, cancel, pay for confirmed bookings
- Consultant: review and update booking statuses
- Admin: review and update booking statuses

The frontend is static HTML/CSS/JS served by Express. The backend is a Node.js API using PostgreSQL for bookings and a JSON file for saved payment methods.

## How It Actually Works
```text
Client browser
      |
      | fetch() / EventSource
      v
frontend/js/bookings-data.js (window.BookingStore)  <-- main bridge
  - getBookings()         -> GET   /api/bookings
  - addBooking()          -> POST  /api/bookings
  - updateBookingStatus() -> PATCH /api/bookings/:id/status
  - subscribe()           -> GET   /api/bookings/stream (SSE)

frontend/js/methods.js (direct fetch)
  - loadMethods()         -> GET    /api/payment-methods
  - save method           -> POST   /api/payment-methods
  - delete method         -> DELETE /api/payment-methods/:id

booking.js payment modal (direct fetch exception)
  - fetch saved methods   -> GET /api/payment-methods
  - payment status update -> PATCH /api/bookings/:id/status via BookingStore
      |
      | JSON over HTTP
      v
backend/src/server.js (Express)
  - State Pattern    -> validates status transitions
  - Factory Pattern  -> builds role-based booking actors
  - Observer Pattern -> broadcasts booking events (SSE + notifiers)
  - Strategy Pattern -> processes payment when status becomes Paid
      |
      v
PostgreSQL (bookings) + backend/data/payment-methods.json
```

## Frontend Request Ownership
- `client.js`, `admin.js`, and `consultant.js` use `window.BookingStore` for booking API operations.
- `methods.js` owns payment method CRUD with direct `fetch()` calls.
- `booking.js` primarily uses `window.BookingStore` for bookings, but directly fetches payment methods for the payment modal.

## Backend Responsibilities
`backend/src/server.js` is the runtime entry point and does all of the following:
- Exposes REST endpoints for bookings and payment methods
- Validates status transitions with the State Pattern
- Applies payment processing rules with the Strategy Pattern
- Creates role objects through the Factory Pattern
- Broadcasts live booking updates over Server-Sent Events (Observer-based notifications)

## API Endpoints
### Bookings
- `GET /api/bookings` - list all bookings
- `POST /api/bookings` - create a booking
- `PATCH /api/bookings/:id/status` - update booking status
- `GET /api/bookings/stream` - SSE stream for live booking events

### Payment Methods
- `GET /api/payment-methods` - list saved methods
- `POST /api/payment-methods` - add a method (`{ type, label }`)
- `DELETE /api/payment-methods/:id` - remove a method

## Booking Status Model
Allowed transitions enforced by backend State Pattern:
- `Requested -> Confirmed | Rejected | Cancelled`
- `Confirmed -> Pending Payment | Cancelled`
- `Pending Payment -> Paid | Cancelled`
- `Paid -> Completed | Cancelled`
- `Completed`, `Rejected`, and `Cancelled` are terminal states

## Run With Docker

The system runs with **three containers**:

| Container | Role |
|---|---|
| `synergy-db` | PostgreSQL database |
| `synergy-backend` | Node.js / Express REST API + AI chatbot endpoint |
| `synergy-frontend` | nginx — serves static files and proxies `/api/` to backend |

### Setup

1. Copy the environment template and add your Openrouter key:
```bash
cp .env.example .env
# Then open .env and set OPENROUTER_API_KEY=your_key_here
```

2. Start all containers:
```bash
docker compose up --build   # first run or after code changes
docker compose up           # subsequent runs
```

3. Open the app:
- **App:** `http://localhost:3000`
- **Health check:** `http://localhost:3000/health`

Stop:
```bash
docker compose down
```

Stop and remove DB volume:
```bash
docker compose down -v
```

### AI Customer Assistant

The AI chatbot is available to clients on the Browse Services page. Click the 💬 bubble in the bottom-right corner to open it. It is powered by the OpenRouter Qwen3.6 Pro Free API (`Qwen3.6-Pro-free`) and answers questions about the platform, booking process, payment methods, and policies.

See `CHATBOT-DOC.md` for full documentation.

## GoF Design Patterns

All four patterns are implemented in `backend/src/patterns/` and wired in `backend/src/server.js`.

| Pattern | File | Where It Fires |
|---------|------|----------------|
| State | `backend/src/patterns/state/BookingStateMachine.js` | Every `PATCH /api/bookings/:id/status` call — validates the requested transition is legal before applying it |
| Strategy | `backend/src/patterns/strategy/PaymentStrategies.js` | When status moves to `Paid` — `PaymentStrategyFactory.create(methodType)` selects the right payment handler and returns a transaction ID |
| Observer | `backend/src/patterns/observer/NotificationManager.js` | After every successful status change — `broadcastBookingEvent()` calls `notificationManager.sendNotification()` which forwards to Email, SMS, and Push notifiers |
| Factory | `backend/src/patterns/factory/UserFactory.js` | On `POST /api/bookings` — `UserFactory.createUser()` builds typed Client and Consultant objects for the booking actors |

## Phase 2 Additions

- Completed frontend for all client, consultant, and admin workflows
- Client refund flow: "Cancel & Refund" button on paid bookings — backend auto-generates a refund transaction ID
- Three-container Docker deployment (db + backend + frontend/nginx)
- AI Customer Assistant chatbot (Openrouter Qwen3.6) embedded in the client interface
- See `PHASE2.md` for a full breakdown and `CHATBOT-DOC.md` for chatbot documentation

## Phase 1 Scope Note

Phase 1 covers the booking lifecycle end-to-end with all four GoF patterns wired and testable.
Includes availability management, consultant registration approvals, system policy configuration,
payment processing, and refund handling. Observer notifications log delivery actions to console.

## Repository
GitHub: [https://github.com/PrnceAkeem/EECS3311_SBCP]
