# Phase 2 — UML Reference: New & Modified Classes / Modules

All entries below are new or modified in Phase 2. Items marked **[MODIFIED]** existed in Phase 1 but were changed. Everything else is new.

---

## Legend

| Symbol | Meaning |
|---|---|
| `+` | public |
| `-` | private / module-scoped |
| `async` | returns a Promise |
| `→` | return type |

---

## 1. Backend — `backend/src/server.js`

### 1.1 Chatbot Endpoint Handler `[NEW]`

Not a class — a route handler registered on the Express `app` instance.

**Route:** `POST /api/chat`

**Module-level constant added:**

| Name | Type | Value |
|---|---|---|
| `GEMINI_API_KEY` | `string` | `process.env.GEMINI_API_KEY \|\| ""` |

**Handler variables (local to request scope):**

| Name | Type | Description |
|---|---|---|
| `message` | `string` | User's chat message, extracted from `request.body` |
| `consultants` | `Array<{name, expertise}>` | Public consultant list from JSON file |
| `policies` | `{cancellationWindowHours, refundPolicy, ...}` | System policies from JSON file |
| `consultantList` | `string` | Formatted bullet list of consultants |
| `systemPrompt` | `string` | Full system context injected into Gemini request |
| `geminiUrl` | `string` | Gemini REST endpoint URL with API key |
| `geminiResponse` | `Response` | Raw HTTP response from Gemini API |
| `data` | `object` | Parsed JSON body from Gemini |
| `reply` | `string` | Extracted text from `data.candidates[0].content.parts[0].text` |

**Request body:** `{ message: string }`

**Response (success):** `{ reply: string }`

**Response (errors):**

| HTTP Status | Condition |
|---|---|
| `400` | `message` missing or empty |
| `503` | `GEMINI_API_KEY` not set |
| `502` | Gemini API returned non-OK or threw |

**External dependency:** Google Gemini REST API
- Model: `gemini-flash-lite-latest`
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent`
- Auth: query param `?key=GEMINI_API_KEY`
- Request shape: `{ system_instruction, contents, generationConfig: { maxOutputTokens: 512 } }`

---

## 2. Frontend — `frontend/js/bookings-data.js`

### Class: `BookingStore` `[NEW — Phase 2 completion]`

Exposed as `window.BookingStore`. Singleton module (IIFE pattern). Acts as the API gateway between all frontend pages and the backend REST/SSE endpoints.

**Fields (module-scoped constants):**

| Name | Type | Description |
|---|---|---|
| `VALID_STATUSES` | `Set<string>` | All 7 legal booking status strings |
| `VALID_TRANSITIONS` | `{ [status: string]: string[] }` | Mirror of backend State Machine transition rules |

**Methods:**

| Visibility | Signature | Returns | Description |
|---|---|---|---|
| `-` | `canTransition(currentStatus: string, nextStatus: string)` | `boolean` | Checks if a status transition is allowed using `VALID_TRANSITIONS` |
| `-` | `async apiRequest(path: string, options?: RequestInit)` | `Promise<any \| null>` | Wrapper around `fetch`; throws `Error` on non-OK response; returns `null` on HTTP 204 |
| `-` | `sanitizeStatus(status: string)` | `string` | Returns `status` if valid, otherwise `"Requested"` |
| `+` | `async getBookings()` | `Promise<Booking[]>` | `GET /api/bookings` |
| `+` | `async addBooking(bookingData: object)` | `Promise<Booking>` | `POST /api/bookings` |
| `+` | `async updateBookingStatus(bookingId: number, nextStatus: string, actor: string, metadata?: object)` | `Promise<Booking>` | `PATCH /api/bookings/:id/status`; forwards optional payment metadata |
| `+` | `subscribe(listener: function)` | `function` (unsubscribe) | Opens SSE stream (`EventSource`) or falls back to polling every 3 s; returns unsubscribe function |

**Public interface exposed on `window.BookingStore`:**
`getBookings`, `addBooking`, `updateBookingStatus`, `subscribe`, `canTransition`

---

## 3. Frontend — `frontend/js/booking.js` (Client Bookings Page)

### Class: `BookingsPageController` `[MODIFIED — refund flow added]`

Module scoped inside `DOMContentLoaded`. Manages the My Bookings table, payment modal, cancel/refund flow.

**Fields (module-scoped):**

| Name | Type | Description |
|---|---|---|
| `bookingsTableBody` | `HTMLElement` | `<tbody>` of bookings table |
| `totalBookingsCount` | `HTMLElement` | Metric card DOM node |
| `upcomingBookingsCount` | `HTMLElement` | Metric card DOM node |
| `completedBookingsCount` | `HTMLElement` | Metric card DOM node |
| `UPCOMING_STATUSES` | `Set<string>` | `{Requested, Confirmed, Pending Payment, Paid}` |
| `COMPLETED_STATUSES` | `Set<string>` | `{Completed}` |
| `isRendering` | `boolean` | Concurrency guard for `renderBookings()` |
| `currentModalId` | `number` | Stale-response guard for payment modal fetches |
| `unsubscribe` | `function \| null` | SSE unsubscribe handle |

**Methods:**

| Visibility | Signature | Returns | Description |
|---|---|---|---|
| `-` | `escapeHtml(value: any)` | `string` | XSS-safe HTML encoding |
| `-` | `getStatusClass(status: string)` | `string` | Maps booking status to CSS class name |
| `-` | `formatBookingId(rawId: any)` | `string` | Formats as `BK-001` |
| `-` | `formatDateTime(bookingDate: string, bookingTime: string)` | `string` | Combines date and time into display string |
| `-` | `createActionsCell(booking: Booking)` | `string` (HTML) | **[MODIFIED]** Renders Cancel or "Cancel & Refund" button (now includes `Paid` status); renders Pay Now button for `Pending Payment` |
| `-` | `createBookingRow(booking: Booking)` | `HTMLTableRowElement` | Builds a full `<tr>` for one booking |
| `-` | `updateMetricCards(bookings: Booking[])` | `void` | Updates Total / Upcoming / Completed counters |
| `-` | `async renderBookings()` | `Promise<void>` | Fetches all bookings and re-renders table; guarded by `isRendering` flag |
| `-` | `openPaymentModal(bookingId: number)` | `void` | Creates and appends the payment modal overlay; fetches saved payment methods |
| `-` | `renderMethodList(bookingId: number, methods: PaymentMethod[])` | `void` | Populates payment modal with radio list of saved methods; wires Confirm button |
| `-` | `processPayment(bookingId: number, method: PaymentMethod)` | `void` | Shows spinner, waits 2 s, calls `BookingStore.updateBookingStatus(..., "Paid", ...)`, shows success/error |
| `-` | `closePaymentModal()` | `void` | Removes payment modal from DOM |

**Cancel / Refund flow (click handler on `bookingsTableBody`) `[MODIFIED]`:**

| Variable | Type | Description |
|---|---|---|
| `allBookings` | `Booking[]` | Fetched from `BookingStore.getBookings()` to check current status |
| `target` | `Booking \| undefined` | The specific booking being cancelled |
| `isPaid` | `boolean` | `true` when `target.status === "Paid"` |
| `confirmMsg` | `string` | Context-aware confirmation message shown to user |

Behaviour: if `isPaid`, confirmation dialog warns of auto-refund; after successful cancellation alerts user to check Payment History.

---

## 4. Frontend — `frontend/js/client.js` (Browse Services Page)

### Class: `ClientPageController` `[NEW — Phase 2 completion]`

Module scoped inside `DOMContentLoaded`. Manages the service booking modal, consultant dropdown, and availability slot grid.

**Fields (module-scoped):**

| Name | Type | Description |
|---|---|---|
| `serviceNameElement` | `HTMLElement` | Displays selected service name in modal |
| `servicePriceElement` | `HTMLElement` | Displays selected service price in modal |
| `bookingForm` | `HTMLFormElement` | The booking `<form>` |
| `bookingModal` | `HTMLElement` | Modal overlay |
| `closeBookingModalButton` | `HTMLElement` | Modal X button |
| `cancelBookingButton` | `HTMLElement` | Modal cancel button |
| `confirmBookingButton` | `HTMLElement` | Modal confirm button |
| `clientNameInput` | `HTMLInputElement` | Client name field |
| `clientEmailInput` | `HTMLInputElement` | Client email field |
| `consultantNameSelect` | `HTMLSelectElement` | Consultant dropdown |
| `bookingDateInput` | `HTMLInputElement` | Date picker |
| `bookingTimeInput` | `HTMLInputElement` (hidden) | Stores selected time slot value |
| `serviceButtons` | `NodeList` | All `.service-book-btn` buttons |
| `timeSlotButtons` | `NodeList` | All `.time-slot-btn` buttons |
| `slotAvailabilityHint` | `HTMLElement` | Hint paragraph below slot grid |

**Methods:**

| Visibility | Signature | Returns | Description |
|---|---|---|---|
| `-` | `normalizeTime(value: string)` | `string` | Parses and normalises `"09:00 AM"` format; returns `""` on invalid |
| `-` | `setHint(message: string)` | `void` | Updates `slotAvailabilityHint` text |
| `-` | `clearTimeSelection()` | `void` | Clears hidden time input and removes `.active` from all slot buttons |
| `-` | `disableAllSlots()` | `void` | Calls `clearTimeSelection()` and disables all slot buttons |
| `-` | `applyAvailability(availableTimes: Set<string>)` | `void` | Enables/disables slot buttons based on `availableTimes`; updates hint |
| `-` | `async loadConsultants()` | `Promise<void>` | `GET /api/consultants`; populates `consultantNameSelect` |
| `-` | `async refreshAvailability()` | `Promise<void>` | `GET /api/availability?consultantName=&bookingDate=`; calls `applyAvailability()` |
| `-` | `openBookingModal()` | `void` | Shows modal; calls `disableAllSlots()` |
| `-` | `resetBookingForm()` | `void` | Resets form fields and slot state |
| `-` | `closeBookingModal()` | `void` | Hides modal; restores body scroll |
| `-` | `validateBookingForm()` | `boolean` | Validates all required fields; shows `alert()` on failure |

---

## 5. Frontend — `frontend/js/history.js` (Payment History Page)

### Class: `PaymentHistoryController` `[NEW — Phase 2 completion]`

Module scoped inside `DOMContentLoaded`. Renders payment and refund history from booking data.

**Fields (module-scoped):**

| Name | Type | Description |
|---|---|---|
| `tableBody` | `HTMLElement` | `<tbody>` of payment history table |
| `isRendering` | `boolean` | Concurrency guard |
| `unsubscribe` | `function \| null` | SSE unsubscribe handle |

**Methods:**

| Visibility | Signature | Returns | Description |
|---|---|---|---|
| `-` | `escapeHtml(value: any)` | `string` | XSS-safe HTML encoding |
| `-` | `formatBookingId(rawId: any)` | `string` | Formats as `BK-001` |
| `-` | `derivePaymentStatus(booking: Booking)` | `string` | Returns `paymentStatus` field, or derives from `refundTransactionId` / `status` |
| `-` | `paymentStatusClass(paymentStatus: string)` | `string` | Maps payment status to CSS class name |
| `-` | `isPaymentHistoryRow(booking: Booking)` | `boolean` | Returns `true` if booking has any payment-related data |
| `-` | `getUpdatedTimestamp(booking: Booking)` | `string \| undefined` | Returns most recent timestamp: `refundProcessedAt` → `paymentProcessedAt` → `updatedAt` → `createdAt` |
| `-` | `async loadHistory()` | `Promise<void>` | Fetches all bookings, filters to payment rows, sorts descending by timestamp, renders table |

---

## 6. Frontend — `frontend/js/methods.js` (Payment Methods Page)

### Class: `PaymentMethodsController` `[NEW — Phase 2 completion]`

Module scoped inside `DOMContentLoaded`. Full CRUD for saved payment methods with per-type field validation.

**Fields (module-scoped):**

| Name | Type | Description |
|---|---|---|
| `tableBody` | `HTMLElement` | `<tbody>` of methods table |
| `modal` | `HTMLElement` | Add method modal overlay |
| `typeSelect` | `HTMLSelectElement` | Payment type selector |
| `cardFields / btFields / ppFields` | `HTMLElement` | Conditionally shown field groups |
| `cardName/cardNumber/cardExpiry/cardCvv` | `HTMLInputElement` | Credit/debit card inputs |
| `btBank/btAccount/btRouting` | `HTMLInputElement` | Bank transfer inputs |
| `ppEmail` | `HTMLInputElement` | PayPal email input |
| `errorMsg` | `HTMLElement` | Inline error message element |
| `methodsCache` | `PaymentMethod[]` | Local cache of loaded methods (used by `editMethod`) |

**Methods:**

| Visibility | Signature | Returns | Description |
|---|---|---|---|
| `-` | `escapeHtml(value: any)` | `string` | XSS-safe HTML encoding |
| `-` | `formatDate(isoString: string)` | `string` | Formats ISO date to `en-CA` locale |
| `-` | `isValidEmail(value: string)` | `boolean` | Regex email format check |
| `-` | `isFutureExpiry(expiryText: string)` | `boolean` | Validates `MM/YY` format and checks date is in the future |
| `-` | `showError(message: string)` | `void` | Displays inline error in modal |
| `-` | `clearError()` | `void` | Hides inline error |
| `-` | `resetFields()` | `void` | Resets all form inputs and hides conditional field groups |
| `-` | `openModal()` | `void` | Calls `resetFields()` and `clearError()`, shows modal |
| `-` | `closeModal()` | `void` | Hides modal |
| `-` | `async loadMethods()` | `Promise<void>` | `GET /api/payment-methods`; updates `methodsCache`; calls `renderTable()` |
| `-` | `renderTable(methods: PaymentMethod[])` | `void` | Renders the methods table with Edit and Remove buttons |
| `-` | `async removeMethod(methodId: string, buttonEl: HTMLElement)` | `Promise<void>` | `DELETE /api/payment-methods/:id`; reloads table |
| `-` | `async editMethod(methodId: string)` | `Promise<void>` | Prompts for new label; `PATCH /api/payment-methods/:id`; reloads table |
| `-` | `buildMethodPayload()` | `{ payload?: object, error?: string }` | Validates type-specific fields; returns payload or error string |

---

## 7. Frontend — `frontend/js/consultant.js` (Consultant Dashboard)

### Class: `ConsultantDashboardController` `[NEW — Phase 2 completion]`

Module scoped inside `DOMContentLoaded`. Manages booking status updates and availability slot management.

**Fields (module-scoped):**

| Name | Type | Description |
|---|---|---|
| `tableBody` | `HTMLElement` | Bookings table `<tbody>` |
| `toastEl` | `HTMLElement` | Toast notification element |
| `availabilityConsultantName` | `HTMLSelectElement` | Consultant selector for availability panel |
| `availabilityDate` | `HTMLInputElement` | Date picker for availability |
| `availabilityTime` | `HTMLInputElement` | Time input for availability |
| `addAvailabilityBtn` | `HTMLElement` | Add slot button |
| `availabilityTableBody` | `HTMLElement` | Availability slots table `<tbody>` |
| `STATUS_OPTIONS` | `string[]` | All 7 booking statuses |
| `unsubscribe` | `function \| null` | SSE unsubscribe handle |
| `isRendering` | `boolean` | Concurrency guard |
| `toastTimer` | `number \| null` | Timeout handle for toast auto-dismiss |

**Methods:**

| Visibility | Signature | Returns | Description |
|---|---|---|---|
| `-` | `showToast(message: string)` | `void` | Shows toast for 3 s then hides |
| `-` | `escapeHtml(value: any)` | `string` | XSS-safe HTML encoding |
| `-` | `normalizeTime(value: string)` | `string` | Normalises `"HH:MM AM/PM"` format |
| `-` | `formatRef(prefix: string, rawId: any)` | `string` | Formats `"BK-001"` or `"CUS-001"` style refs |
| `-` | `async loadConsultants()` | `Promise<void>` | `GET /api/consultants`; populates consultant selector |
| `-` | `getStatusClass(status: string)` | `string` | Maps status to CSS class |
| `-` | `createStatusOptions(selectedStatus: string)` | `string` (HTML) | Renders `<option>` elements; disables invalid transitions via `BookingStore.canTransition()` |
| `-` | `createBookingRow(booking: Booking)` | `HTMLTableRowElement` | Builds booking row with status dropdown and Save button |
| `-` | `async renderBookings()` | `Promise<void>` | Fetches and renders all bookings; guarded by `isRendering` |
| `-` | `async loadAvailability()` | `Promise<void>` | `GET /api/availability?consultantName=`; renders slots table |
| `-` | `async addAvailability()` | `Promise<void>` | `POST /api/availability`; reloads availability table |
| `-` | `async removeAvailability(slotId: number, buttonEl: HTMLElement)` | `Promise<void>` | `DELETE /api/availability/:id`; reloads availability table |

---

## 8. Frontend — `frontend/js/admin.js` (Admin Dashboard)

### Class: `AdminDashboardController` `[NEW — Phase 2 completion]`

Module scoped inside `DOMContentLoaded`. Manages all bookings, consultant directory, registration approvals, and system policies.

**Fields (module-scoped):**

| Name | Type | Description |
|---|---|---|
| `tableBody` | `HTMLElement` | Bookings table `<tbody>` |
| `toastEl` | `HTMLElement` | Toast notification element |
| `consultantNameInput / consultantEmailInput / consultantExpertiseInput` | `HTMLInputElement` | Add consultant form inputs |
| `addConsultantBtn` | `HTMLElement` | Add consultant button |
| `consultantDirectoryBody` | `HTMLElement` | Consultant directory table `<tbody>` |
| `registrationTableBody` | `HTMLElement` | Registrations table `<tbody>` |
| `policyCancellationWindow` | `HTMLInputElement` | Cancellation window hours field |
| `policyPricingMultiplier` | `HTMLInputElement` | Pricing multiplier field |
| `policyNotificationsEnabled` | `HTMLSelectElement` | Notifications toggle |
| `policyRefundPolicy` | `HTMLInputElement` | Refund policy text field |
| `savePoliciesBtn` | `HTMLElement` | Save policies button |
| `STATUS_OPTIONS` | `string[]` | All 7 booking statuses |
| `unsubscribe` | `function \| null` | SSE unsubscribe handle |
| `isRendering` | `boolean` | Concurrency guard |
| `toastTimer` | `number \| null` | Timeout handle for toast auto-dismiss |

**Methods:**

| Visibility | Signature | Returns | Description |
|---|---|---|---|
| `-` | `showToast(message: string)` | `void` | Shows toast for 3 s then hides |
| `-` | `escapeHtml(value: any)` | `string` | XSS-safe HTML encoding |
| `-` | `formatRef(prefix: string, rawId: any)` | `string` | Formats `"BK-001"` / `"CUS-001"` style refs |
| `-` | `getStatusClass(status: string)` | `string` | Maps status to CSS class |
| `-` | `createStatusOptions(selectedStatus: string)` | `string` (HTML) | Renders `<option>` elements; disables invalid transitions via `BookingStore.canTransition()` |
| `-` | `createBookingRow(booking: Booking)` | `HTMLTableRowElement` | Builds booking row with status dropdown and Save button |
| `-` | `async renderBookings()` | `Promise<void>` | Fetches and renders all bookings; guarded by `isRendering` |
| `-` | `async loadConsultants()` | `Promise<void>` | `GET /api/consultants`; renders consultant directory table |
| `-` | `async addConsultant()` | `Promise<void>` | `POST /api/consultants`; reloads directory |
| `-` | `async loadRegistrations()` | `Promise<void>` | `GET /api/consultants/registrations`; renders registrations table with Approve/Reject buttons |
| `-` | `async reviewRegistration(registrationId: string, status: string, buttonEl: HTMLElement)` | `Promise<void>` | `PATCH /api/consultants/registrations/:id`; reloads registrations and directory |
| `-` | `async loadPolicies()` | `Promise<void>` | `GET /api/policies`; populates policy form fields |
| `-` | `async savePolicies()` | `Promise<void>` | `PUT /api/policies`; sends updated policy object |

---

## 9. Frontend — Chat Widget in `frontend/client.html` (inline)

### Class: `ChatWidget` `[NEW]`

Inline JavaScript in `client.html`. No external dependencies. Communicates with `POST /api/chat`.

**DOM elements controlled:**

| ID | Type | Description |
|---|---|---|
| `chat-bubble` | `div` | Floating toggle button (💬) |
| `chat-window` | `div` | Chat panel (hidden by default) |
| `chat-messages` | `div` | Scrollable message log |
| `chat-input` | `input[text]` | User text input |
| `chat-send` | `button` | Send button |
| `chat-close` | `button` | Close panel button |

**Methods (global scope):**

| Visibility | Signature | Returns | Description |
|---|---|---|---|
| `+` | `toggleChat()` | `void` | Toggles `chat-window` hidden attribute; focuses input on open |
| `+` | `async sendChat()` | `Promise<void>` | Reads input, appends user bubble, shows "Thinking…", `POST /api/chat`, replaces thinking bubble with reply or error message |

**Local variables inside `sendChat()`:**

| Name | Type | Description |
|---|---|---|
| `input` | `HTMLInputElement` | Reference to `#chat-input` |
| `messages` | `HTMLElement` | Reference to `#chat-messages` |
| `sendBtn` | `HTMLElement` | Reference to `#chat-send` |
| `text` | `string` | Trimmed user message |
| `userMsg` | `HTMLDivElement` | User message bubble element |
| `typingMsg` | `HTMLDivElement` | "Thinking…" / bot reply bubble element |
| `res` | `Response` | Fetch response from `/api/chat` |
| `data` | `{ reply?: string, error?: string }` | Parsed JSON response |

---

## 10. Infrastructure — Docker / nginx `[NEW]`

These are not classes but are documented here for completeness as deployable components.

### `NginxFrontendProxy`

**File:** `frontend/Dockerfile` + `frontend/nginx.conf`

| Property | Value |
|---|---|
| Base image | `nginx:alpine` |
| Exposed port | `80` (mapped to host `3000`) |
| Static root | `/usr/share/nginx/html` |
| API proxy target | `http://backend:3000` for all `/api/` paths |
| SSE support | `proxy_buffering off`, `proxy_read_timeout 3600s` |

### `BackendService`

**File:** `backend/Dockerfile`

| Property | Value |
|---|---|
| Base image | `node:20-alpine` |
| Exposed port | `3000` (internal only) |
| Entry point | `node backend/src/server.js` |

### `DatabaseService`

**File:** `docker-compose.yml`

| Property | Value |
|---|---|
| Image | `postgres:16-alpine` |
| Internal port | `5432` |
| Init script | `backend/db/init.sql` |
| Volume | `postgres_data` (named, persistent) |

---

## 11. Data Shapes (for UML attribute reference)

### `Booking` (read from `GET /api/bookings`)

| Field | Type | Description |
|---|---|---|
| `id` | `number` | Auto-increment primary key |
| `service` | `string` | Service name |
| `price` | `string` | Price string e.g. `"$150"` |
| `clientName` | `string` | Client's name |
| `clientEmail` | `string` | Client's email |
| `consultantName` | `string` | Assigned consultant |
| `bookingDate` | `string` | ISO date `YYYY-MM-DD` |
| `bookingTime` | `string` | Time string e.g. `"09:00 AM"` |
| `status` | `string` | One of 7 booking states |
| `paymentStatus` | `string \| null` | `"Success"`, `"Refunded"`, etc. |
| `paymentTransactionId` | `string \| null` | e.g. `"TXN-000001"` |
| `paymentProcessedAt` | `string \| null` | ISO timestamp |
| `refundTransactionId` | `string \| null` | e.g. `"RF-000001"` |
| `refundProcessedAt` | `string \| null` | ISO timestamp |
| `createdAt` | `string` | ISO timestamp |
| `updatedAt` | `string` | ISO timestamp |

### `PaymentMethod`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | UUID |
| `type` | `string` | `"Credit Card"`, `"Debit Card"`, `"PayPal"`, `"Bank Transfer"` |
| `label` | `string` | Human-readable label |
| `createdAt` | `string` | ISO timestamp |

### `ChatRequest` / `ChatResponse`

| Shape | Field | Type |
|---|---|---|
| Request | `message` | `string` |
| Response | `reply` | `string` |
| Error response | `error` | `string` |
