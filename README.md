
# 📌 Service Booking & Consulting Platform
Group #8, EECS 3311 – Software Design
York University – Lassonde School of Engineering
Winter 2026

# 📖 Project Overview
This project implements a Service Booking & Consulting Platform that connects:
👤 Clients
👨‍💼 Consultants
🛠  Admins

The system allows clients to browse consulting services, request bookings, process payments (simulated), and manage booking history. Consultants manage availability and confirm bookings. Admins configure system-wide policies.

The primary focus of this project is:

Object-Oriented Design
UML Modeling
Clean Backend Architecture
Proper Application of GoF Design Patterns
Version Control Collaboration via GitHub

# 🎯 Phase 1 Objectives

Implement core backend business logic
Apply 3–5 GoF design patterns
Maintain consistency between UML diagrams and implementation
Provide minimal frontend or terminal interface for demonstration

# 🚀 Phase 2 Objectives

Complete full frontend workflows
Deploy system using Docker (minimum 3 containers)
Integrate an AI-based customer assistant
Ensure secure and privacy-compliant AI integration

# 🧩 System Actors
1️⃣ Client
Browse services
Request booking
Cancel booking
Process payment
Manage payment methods
View booking & payment history

2️⃣ Consultant
Manage availability
Accept / Reject booking requests
Complete bookings

3️⃣ Admin
Approve consultant registrations
Configure policies (cancellation, pricing, notifications)

# 🐳 Run With Docker

This project now runs with 2 containers:
- `synergy-app` (Node + Express API + static frontend)
- `synergy-db` (PostgreSQL database)

### Start

```bash
docker compose up --build
```

Then open:
- App: `http://localhost:3000`
- Health: `http://localhost:3000/health`

### Stop

```bash
docker compose down
```

To remove DB volume data too:

```bash
docker compose down -v
```

# 🔄 Shared Real-Time Booking Flow

- Client booking requests are stored in PostgreSQL, not browser storage.
- Admin and Consultant dashboards read from the same shared DB.
- Status updates (`Requested`, `Completed`, `Cancelled`) are pushed to connected pages using Server-Sent Events.
- Multi-user testing works by opening different browsers/devices against `http://localhost:3000`.
