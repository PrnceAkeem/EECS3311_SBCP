# AI Customer Assistant — Chatbot Documentation

## Overview

The Synergy platform includes an AI-powered Customer Assistant that clients can use to ask questions about the platform, booking process, available services, payment methods, and policies. It is accessible from the Browse Services page via a floating chat bubble in the bottom-right corner.

---

## LLM / API Details

| Property | Value |
|---|---|
| Provider | Google AI (Gemini) |
| Model | `gemini-flash-lite-latest` |
| API Version | `v1beta` |
| API Endpoint | `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent` |
| Max Output Tokens | 512 |
| Authentication | API key via `GEMINI_API_KEY` environment variable |

The Gemini API is called directly using the Node.js built-in `fetch` — no additional npm package is required.

---

## Chatbot Functionality

The assistant answers client questions about the Synergy platform only. It:

- Explains how to book a consulting session step by step
- Describes available consultants and their areas of expertise
- Lists accepted payment methods and their validation requirements
- Explains booking states (Requested → Confirmed → Pending Payment → Paid → Completed)
- Explains cancellation rules and the refund policy
- Guides users through platform features

The assistant does **not**:
- Perform any actions (create, cancel, or modify bookings)
- Access the database or any personal user data
- Handle payment card numbers or sensitive credentials

---

## Integration Architecture

```
Browser (client.html)
    │  POST /api/chat  { message: "..." }
    ▼
nginx (synergy-frontend container)
    │  proxy_pass http://backend:3000
    ▼
Express API (synergy-backend container)
    │  Builds system prompt from public JSON files
    │  POST https://generativelanguage.googleapis.com/...
    ▼
Google Gemini API
    │  { candidates[0].content.parts[0].text }
    ▼
Express API  →  { reply: "..." }
    ▼
Browser renders reply in chat window
```

### Backend Endpoint

`POST /api/chat`

**Request body:**
```json
{ "message": "How do I book a consultant?" }
```

**Success response:**
```json
{ "reply": "To book a consultant, browse the services on the client page..." }
```

**Error responses:**
| HTTP Status | Meaning |
|---|---|
| 400 | Message field missing or empty |
| 503 | `GEMINI_API_KEY` is not configured |
| 502 | Gemini API returned an error |

---

## System Context Provided to the AI

The backend constructs a system prompt at request time from public data files only. The prompt includes:

1. **Platform overview** — what Synergy is and what it does
2. **Booking process** — the 5-step workflow a client follows
3. **Booking states** — all valid states and their meaning
4. **Available consultants** — names and expertise (read from `backend/data/consultants.json`)
5. **Accepted payment methods** — credit card, debit card, PayPal, bank transfer
6. **Cancellation window** — hours before session (read from `backend/data/system-policies.json`)
7. **Refund policy** — the configured refund policy text

No database queries are made during chatbot requests. No user session data, personal information, or booking details are ever included in the prompt.

---

## Privacy and Safety Measures

- The AI is instructed via system prompt to **never ask for or reveal personal information, payment card details, or private booking data**
- The backend endpoint only forwards the user's typed message — no session tokens, user IDs, or booking records are sent to the AI
- All context passed to the AI is sourced exclusively from public JSON configuration files
- The AI is explicitly instructed not to perform actions on behalf of the user
- If the user asks something outside platform scope, the AI is instructed to politely redirect

---

## Example Questions the Chatbot Can Answer

| Question | What the AI Explains |
|---|---|
| "How do I book a consulting session?" | Step-by-step booking workflow |
| "What payment methods do you accept?" | Credit card, debit, PayPal, bank transfer with validation rules |
| "Can I cancel my booking?" | Cancellation policy, time window, and refund eligibility |
| "What types of consulting services are available?" | Available service categories |
| "Who are the consultants?" | Consultant names and areas of expertise |
| "What happens after I pay?" | Booking moves to Paid state; consultant marks it Completed after session |
| "How long does a refund take?" | Refund policy as configured by the admin |

---

## Frontend Widget

The chat widget is embedded directly in `frontend/client.html` as inline HTML, CSS, and JavaScript. It requires no external libraries.

Key behaviours:
- Floating 💬 button (bottom-right) toggles the chat window open/closed
- "Thinking…" indicator displays while waiting for the API response
- Messages are appended in a scrollable log with distinct user (blue) and bot (grey) bubbles
- Enter key submits a message; the Send button is disabled while a request is in flight
- Error states (network failure, 5xx) show a user-friendly fallback message
