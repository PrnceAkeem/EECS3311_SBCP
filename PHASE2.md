# Phase 2 — Frontend Completion, Deployment & AI Integration

## Overview

Phase 2 extends the Phase 1 backend with a fully functional frontend, a three-container Docker deployment, and an AI-powered Customer Assistant chatbot using the Google Gemini API.

---

## 1. Frontend Completion

All client, consultant, and admin workflows are implemented as static HTML/CSS/JS pages served by a dedicated nginx container.

### Client Features
| Feature | File |
|---|---|
| Browse consulting services | `frontend/client.html` |
| Request a booking (with consultant + time slot selection) | `frontend/client.html` + `frontend/js/client.js` |
| Cancel a booking | `frontend/booking.html` + `frontend/js/booking.js` |
| Cancel a paid booking with automatic refund | `frontend/js/booking.js` |
| View booking history and statuses | `frontend/booking.html` |
| Process payment (credit card, debit, PayPal, bank transfer) | `frontend/booking.html` + `frontend/js/booking.js` |
| Manage saved payment methods | `frontend/methods.html` + `frontend/js/methods.js` |
| View full payment and refund history | `frontend/history.html` + `frontend/js/history.js` |
| Access AI Customer Assistant chatbot | `frontend/client.html` (floating chat widget) |

### Consultant Features
| Feature | File |
|---|---|
| Manage availability (add/remove time slots) | `frontend/consultant.html` + `frontend/js/consultant.js` |
| Accept or reject booking requests | `frontend/consultant.html` |
| View booking schedule | `frontend/consultant.html` |

### Admin Features
| Feature | File |
|---|---|
| Approve or reject consultant registrations | `frontend/admin.html` + `frontend/js/admin.js` |
| View system status and all bookings | `frontend/admin.html` |
| Manage system policies (cancellation window, refund policy, pricing) | `frontend/admin.html` |

### Refund Flow (Client)
When a client cancels a booking that is already in the **Paid** state:
- The button label changes to **"Cancel & Refund"**
- A confirmation dialog informs the client a refund will be issued
- The backend automatically generates a refund transaction ID (`RF-XXXXXX`) and sets `payment_status = 'Refunded'`
- The client is directed to Payment History to view the refund transaction

---

## 2. Docker-Based Deployment (3 Containers)

The system runs with a single command:

```bash
docker compose up --build
```

Access the app at: **http://localhost:3000**

### Container Architecture

| Container | Image | Role | Exposed Port |
|---|---|---|---|
| `synergy-db` | `postgres:16-alpine` | PostgreSQL database | Internal only |
| `synergy-backend` | `node:20-alpine` (custom) | Express REST API + AI chatbot endpoint | Internal only |
| `synergy-frontend` | `nginx:alpine` (custom) | Serves static files, proxies `/api/` to backend | `3000` → host |

### How They Connect
- The **frontend** nginx container is the only publicly exposed service (port 3000)
- All `/api/...` requests from the browser are proxied by nginx to `http://backend:3000` over the internal Docker network
- Server-Sent Events (`/api/bookings/stream`) are supported via nginx `proxy_buffering off`
- The **backend** connects to **db** using the internal hostname `db:5432`
- Database data is persisted via a named Docker volume (`postgres_data`)
- Backend JSON data files (payment methods, consultants, policies) are persisted via a bind mount (`./backend/data`)

### Configuration Files
| File | Purpose |
|---|---|
| `backend/Dockerfile` | Builds the Node.js backend image |
| `frontend/Dockerfile` | Builds the nginx frontend image |
| `frontend/nginx.conf` | nginx site config with API proxy rules |
| `docker-compose.yml` | Orchestrates all three containers |
| `.env` | Local environment variables (not committed) |
| `.env.example` | Template showing required variables |

### Environment Variables
Copy `.env.example` to `.env` before running:
```bash
cp .env.example .env
```

Required variable:
```
GEMINI_API_KEY=your_gemini_api_key_here
```

---

## 3. AI-Based Customer Assistant

A floating chat widget is embedded in the client interface (`client.html`) and backed by a dedicated backend endpoint (`POST /api/chat`) that calls the Google Gemini API.

See **CHATBOT-DOC.md** for full documentation.

---

## Demo Credentials

| Role | Email | Password |
|---|---|---|
| Client | client@synergy.ca | pass12345 |
| Consultant | consultant@synergy.ca | pass12345 |
| Admin | admin@synergy.ca | pass12345 |
