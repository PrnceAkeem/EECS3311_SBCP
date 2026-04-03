# Service Booking and Consulting Platform
Group 8, EECS 3311 Software Design  
York University, Lassonde School of Engineering  
Winter 2026

## What This Project Does
This is a multi-role booking system with three user-facing flows:
- **Client:** browse consultants, request bookings, pay once confirmed, cancel with automatic refunds
- **Consultant:** accept/reject bookings, manage availability slots, register on the platform
- **Admin:** approve consultant registrations, manage the consultant directory, configure system policies

The frontend is static HTML/CSS/JS served by nginx. The backend is a Node.js/Express API using PostgreSQL for bookings and JSON flat files for payment methods, consultants, and policies.

A parallel **Java backend** implementation was also produced (see section below) that exposes the same REST API using the JDK's built-in `com.sun.net.httpserver` — no framework required.

## How It Actually Works

### Node.js Backend (primary — deployed via Docker)
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
  - State Pattern     -> validates status transitions
  - Factory Pattern   -> builds role-based booking actors
  - Observer Pattern  -> broadcasts booking events (SSE + notifiers)
  - Strategy Pattern  -> processes payment when status becomes Paid
  - Singleton Pattern -> SystemPolicyManager holds platform-wide policies
      |
      v
PostgreSQL (bookings, availability_slots)
backend/data/*.json (payment-methods, consultants, consultant-registrations, system-policies)
```

### Java Backend (alternative implementation — standalone, port 8080)
```text
Client browser
      |
      | fetch("http://localhost:8080/api/...", { method, headers, body })
      | ← plain HTTP over loopback →
      v
backend/java/src/main/java/Server.java  (com.sun.net.httpserver.HttpServer)
      |
      | routes to ApiHandler factory methods by path + HTTP method
      v
backend/java/src/main/java/api/ApiHandler.java
  - GetBookingsHandler        <- GET  /api/bookings
  - PostBookingHandler        <- POST /api/bookings
  - PatchBookingStatusHandler <- PATCH /api/bookings/:id/status
  - SseHandler                <- GET  /api/bookings/stream
  - GetPaymentMethodsHandler  <- GET  /api/payment-methods
  - PostPaymentMethodHandler  <- POST /api/payment-methods
  - DeletePaymentMethodHandler<- DELETE /api/payment-methods/:id
      |
      | JSON parsing done manually (no external JSON library)
      v
BookingStore (in-memory) + PaymentMethodStore (PostgreSQL via JDBC)
```

The Java backend demonstrates the same five GoF patterns:
- **Singleton** — `SystemPolicyManager.getInstance()` (thread-safe, lazy-initialised)
- **Factory** — `UserFactory.createUser()` produces `Client`, `Consultant`, `Admin` objects
- **Observer** — `NotificationManager` fans events to `EmailNotifier`, `SmsNotifier`, `PushNotifier`
- **State** — `BookingStateMachine.transition()` guards every status update
- **Strategy** — `PaymentStrategyFactory.create()` selects the correct payment handler

## Frontend Request Ownership
- `client.js`, `admin.js`, and `consultant.js` use `window.BookingStore` for booking API operations.
- `methods.js` owns payment method CRUD with direct `fetch()` calls.
- `booking.js` primarily uses `window.BookingStore` for bookings, but directly fetches payment methods for the payment modal.

## Backend Responsibilities
`backend/src/server.js` is the runtime entry point and does all of the following:
- Exposes REST endpoints for bookings, payment methods, consultants, availability, policies, and chat
- Validates status transitions with the State Pattern
- Applies payment processing rules with the Strategy Pattern
- Creates role-specific objects through the Factory Pattern
- Broadcasts live booking updates over Server-Sent Events (Observer-based notifications)
- Enforces platform policies through the Singleton SystemPolicyManager
- Proxies AI chatbot requests to the Google Gemini API

## API Endpoints

### Bookings
- `GET /api/bookings` — list all bookings
- `POST /api/bookings` — create a booking
- `PATCH /api/bookings/:id/status` — update booking status (triggers State + Strategy + Observer)
- `GET /api/bookings/stream` — SSE stream for live booking events

### Payment Methods
- `GET /api/payment-methods` — list saved methods
- `POST /api/payment-methods` — add a method
- `PATCH /api/payment-methods/:id` — update a saved method
- `DELETE /api/payment-methods/:id` — remove a method

### Consultants
- `GET /api/consultants` — list all approved consultants
- `POST /api/consultants` — add a consultant (admin)

### Consultant Registrations
- `GET /api/consultants/registrations` — list all registration requests
- `POST /api/consultants/registrations` — submit a registration request
- `PATCH /api/consultants/registrations/:id` — approve or reject (admin)

### Availability
- `GET /api/availability` — query availability slots
- `POST /api/availability` — add a slot (consultant)
- `DELETE /api/availability/:id` — remove a slot (consultant)

### System Policies
- `GET /api/policies` — read current policies
- `PUT /api/policies` — update policies (admin)

### Other
- `POST /api/chat` — AI Customer Assistant (proxied to Google Gemini)
- `GET /health` — health check

## Booking Status Model
Allowed transitions enforced by the State Pattern:
- `Requested → Confirmed | Rejected | Cancelled`
- `Confirmed → Pending Payment | Cancelled`
- `Pending Payment → Paid | Cancelled`
- `Paid → Completed | Cancelled`
- `Completed`, `Rejected`, and `Cancelled` are terminal states

## Role-Based Workflows

### Client
- Browse available consultants and time slots
- Request bookings; pay once the consultant confirms (`Pending Payment → Paid`)
- Cancel any booking; paid bookings trigger an automatic refund (`RF-XXXXXX` transaction ID)
- View full payment and refund history

### Consultant
- Accept or reject incoming booking requests
- Manage personal availability slots (required before clients can book)
- Submit a registration request to join the platform (admin must approve)

### Admin
- Approve or reject consultant registration requests
- Add consultants to the platform directory
- Manage system policies: cancellation window, pricing multiplier, refund policy, notifications flag
- View all bookings across all users

## Payment & Refund Transaction IDs

| Event | ID Format |
|-------|-----------|
| Credit Card payment | `CC-XXXXX` |
| Debit Card payment | `DC-XXXXX` |
| PayPal payment | `PP-XXXXX` |
| Bank Transfer payment | `BT-XXXXX` |
| Refund (any method) | `RF-XXXXX` |

## Run With Docker

The system runs with **three containers**:

| Container | Role |
|---|---|
| `synergy-db` | PostgreSQL 16 database |
| `synergy-backend` | Node.js / Express REST API + AI chatbot endpoint |
| `synergy-frontend` | nginx — serves static files and proxies `/api/` to backend |

### Setup

1. Copy the environment template and add your Gemini API key:
```bash
cp .env.example .env
# Then open .env and set GEMINI_API_KEY=your_key_here
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

## Run the Java Backend (standalone)

The Java backend is a drop-in replacement for the Node.js backend. It speaks the same API so the same frontend HTML/JS works against it without changes.

```bash
cd backend/java
mvn package
export DATABASE_URL=postgres://synergy_user:synergy_pass@localhost:5432/synergy
java -jar target/synergy-booking-1.0.0.jar
# API now available at http://localhost:8080
```

Requirements: JDK 17+, Maven 3.8+, a running PostgreSQL instance.

### AI Customer Assistant

The AI chatbot is available to clients on the Browse Services page. Click the chat bubble in the bottom-right corner to open it. It is powered by the Google Gemini API (`gemini-flash-lite-latest`) and answers questions about the platform, booking process, payment methods, and policies.

See `CHATBOT-DOC.md` for full documentation.

## GoF Design Patterns

All five patterns are implemented in `backend/src/patterns/` (Node.js) and mirrored in `backend/java/src/main/java/patterns/` (Java), wired in `backend/src/server.js` and `backend/java/src/main/java/Server.java` respectively.

| Pattern | Node.js File | Java File | Where It Fires |
|---------|-------------|-----------|----------------|
| State | `patterns/state/BookingStateMachine.js` | `patterns/BookingStateMachine.java` | Every `PATCH /api/bookings/:id/status` — validates the transition before applying it |
| Strategy | `patterns/strategy/PaymentStrategies.js` | `patterns/PaymentStrategyFactory.java` | When status moves to `Paid` — selects the right payment handler and returns a transaction ID |
| Observer | `patterns/observer/NotificationManager.js` | `patterns/NotificationManager.java` | After every successful status change — forwards to Email, SMS, and Push notifiers |
| Factory | `patterns/factory/UserFactory.js` | `patterns/UserFactory.java` | On `POST /api/bookings` — builds typed Client, Consultant, and Admin objects |
| Singleton | `server.js` (SystemPolicyManager) | `patterns/SystemPolicyManager.java` | Policy reads throughout the request lifecycle — single instance enforced |

## Phase 2 Additions

- Completed frontend for all client, consultant, and admin workflows
- Consultant registration workflow: self-register, then admin approves or rejects
- Availability slot management: consultants set their schedule; clients pick from available slots
- System policy management: admin controls cancellation window, pricing, and refund settings
- Client refund flow: "Cancel & Refund" button on paid bookings — backend auto-generates a refund transaction ID
- Three-container Docker deployment (db + backend + frontend/nginx)
- AI Customer Assistant chatbot (Google Gemini) embedded in the client interface
- Java backend implementation: identical REST API and all five GoF patterns re-implemented in Java using only the JDK standard library
- See `PHASE2.md` for a full breakdown and `CHATBOT-DOC.md` for chatbot documentation

## Phase 1 Scope Note

Phase 1 covers the booking lifecycle end-to-end with all four GoF patterns wired and testable.
Includes availability management, consultant registration approvals, system policy configuration,
payment processing, and refund handling. Observer notifications log delivery actions to console.

## Repository
GitHub: [https://github.com/PrnceAkeem/EECS3311_SBCP]
