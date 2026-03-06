package api;

// =============================================================================
// ApiHandler.java — HTTP handlers for every endpoint called by the JS frontend
// =============================================================================
//
// WHAT THIS FILE DOES:
//   Defines one handler class per API endpoint and one public factory class
//   (ApiHandler) that instantiates them.  Server.java calls the factory methods
//   when registering routes with the HttpServer.
//
// ENDPOINT → HANDLER MAP:
//
//   Booking endpoints (data stored in-memory in BookingStore):
//     GET    /api/bookings              → GetBookingsHandler
//     POST   /api/bookings              → PostBookingHandler
//     PATCH  /api/bookings/:id/status   → PatchBookingStatusHandler
//     GET    /api/bookings/stream       → SseHandler
//
//   Payment-method endpoints (data persisted in PostgreSQL via PaymentMethodStore):
//     GET    /api/payment-methods       → GetPaymentMethodsHandler
//     POST   /api/payment-methods       → PostPaymentMethodHandler
//     DELETE /api/payment-methods/:id   → DeletePaymentMethodHandler
//
// HOW HTTP REQUESTS FLOW THROUGH THIS FILE:
//
//   Browser JS (BookingStore.js / methods.js)
//         │  fetch("http://localhost:8080/api/...", { method, body })
//         ▼
//   HttpServer (Server.java, port 8080)
//         │  routes to the right handler based on path + method
//         ▼
//   Handler.handle(HttpExchange exchange)
//         │  1. reads request body with readBody()
//         │  2. parses JSON fields with parseField()
//         │  3. calls BookingStore / PaymentMethodStore
//         │  4. writes JSON response with sendJson()
//         ▼
//   Browser receives JSON → JS parses it → UI updates
//
// WHY TWO BASE CLASSES?
//   BaseHandler is for booking handlers; it receives BookingStore and
//   NotificationManager from Server.java so the handlers don't instantiate
//   them (dependency injection keeps tests easy).
//   PmBaseHandler is for payment-method handlers; PaymentMethodStore is
//   stateless (all state lives in PostgreSQL), so each handler just calls
//   "new PaymentMethodStore()" directly — no need to pass it from Server.java.
//
// =============================================================================

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import patterns.BookingStateMachine;
import patterns.NotificationManager;
import patterns.PaymentStrategyFactory;
import patterns.PaymentDetails;
import patterns.PaymentResult;
import store.BookingStore;
import store.BookingStore.Booking;
import store.PaymentMethodStore;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// =============================================================================
// BaseHandler — shared helpers used by all BOOKING handlers
// =============================================================================
// Receives BookingStore and NotificationManager via constructor so each
// handler can call the store without instantiating it themselves.
// =============================================================================
abstract class BaseHandler implements HttpHandler {

    protected final BookingStore        store;
    protected final NotificationManager notificationManager;

    protected BaseHandler(BookingStore store, NotificationManager notificationManager) {
        this.store               = store;
        this.notificationManager = notificationManager;
    }

    // ── Response helpers ──────────────────────────────────────────────────────

    /** Writes a JSON body with the given HTTP status code. */
    protected void sendJson(HttpExchange exchange, int statusCode, String json)
            throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        addCorsHeaders(exchange);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(statusCode, body.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(body);
        }
    }

    /** Writes a JSON error object: { "error": "<message>" }. */
    protected void sendError(HttpExchange exchange, int statusCode, String message)
            throws IOException {
        sendJson(exchange, statusCode,
                 "{\"error\":\"" + escape(message) + "\"}");
    }

    /** Sends 204 No Content (used for DELETE success). */
    protected void sendNoContent(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);
        exchange.sendResponseHeaders(204, -1);
        exchange.getResponseBody().close();
    }

    // ── CORS headers ──────────────────────────────────────────────────────────
    // Required because the browser JS and the Java server run on different
    // origins (the HTML is served from the file system or a different port).
    private void addCorsHeaders(HttpExchange exchange) {
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin",  "*");
        exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
    }

    /** Reads the full request body as a UTF-8 string. */
    protected String readBody(HttpExchange exchange) throws IOException {
        try (InputStream is = exchange.getRequestBody()) {
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    // ── Minimal JSON field extractor ──────────────────────────────────────────
    // Avoids an external JSON library. Extracts the value of a top-level
    // string field from a JSON object using a regular expression.
    // e.g.  parseField("{\"status\":\"Confirmed\"}", "status") → "Confirmed"
    protected String parseField(String json, String field) {
        Pattern p = Pattern.compile(
            "\"" + field + "\"\\s*:\\s*\"([^\"\\\\]*(\\\\.[^\"\\\\]*)*)\"");
        Matcher m = p.matcher(json);
        if (m.find()) return m.group(1);

        // Also handle bare numeric values
        Pattern pNum = Pattern.compile("\"" + field + "\"\\s*:\\s*(\\d+)");
        Matcher mNum = pNum.matcher(json);
        if (mNum.find()) return mNum.group(1);

        return null;
    }

    /** Escapes a string for safe embedding inside a JSON string value. */
    protected String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    /**
     * Handles a CORS pre-flight OPTIONS request.
     * Returns true if this was an OPTIONS request (caller should return immediately).
     */
    protected boolean handleOptions(HttpExchange exchange) throws IOException {
        if ("OPTIONS".equals(exchange.getRequestMethod())) {
            sendNoContent(exchange);
            return true;
        }
        return false;
    }
}

// =============================================================================
// PmBaseHandler — shared helpers used by all PAYMENT-METHOD handlers
// =============================================================================
// Identical utilities to BaseHandler but without the booking-store fields.
// Payment-method handlers instantiate PaymentMethodStore directly since it
// is stateless (no in-memory state — all data lives in the database).
// =============================================================================
abstract class PmBaseHandler implements HttpHandler {

    /** Writes a JSON body with the given HTTP status code plus CORS headers. */
    protected void sendJson(HttpExchange exchange, int statusCode, String json)
            throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        addCorsHeaders(exchange);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(statusCode, body.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(body);
        }
    }

    /** Writes a JSON error object. */
    protected void sendError(HttpExchange exchange, int statusCode, String message)
            throws IOException {
        sendJson(exchange, statusCode,
                 "{\"error\":\"" + escape(message) + "\"}");
    }

    /** Sends 204 No Content. */
    protected void sendNoContent(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);
        exchange.sendResponseHeaders(204, -1);
        exchange.getResponseBody().close();
    }

    private void addCorsHeaders(HttpExchange exchange) {
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin",  "*");
        exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
    }

    protected String readBody(HttpExchange exchange) throws IOException {
        try (InputStream is = exchange.getRequestBody()) {
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    protected String parseField(String json, String field) {
        Pattern p = Pattern.compile(
            "\"" + field + "\"\\s*:\\s*\"([^\"\\\\]*(\\\\.[^\"\\\\]*)*)\"");
        Matcher m = p.matcher(json);
        if (m.find()) return m.group(1);
        return null;
    }

    protected String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    protected boolean handleOptions(HttpExchange exchange) throws IOException {
        if ("OPTIONS".equals(exchange.getRequestMethod())) {
            sendNoContent(exchange);
            return true;
        }
        return false;
    }
}

// =============================================================================
// ── BOOKING HANDLERS ─────────────────────────────────────────────────────────
// =============================================================================

// =============================================================================
// GetBookingsHandler — GET /api/bookings
// =============================================================================
// Returns the full in-memory booking list as a JSON array.
// Called by: renderBookings() in booking.js, admin.js, consultant.js
// =============================================================================
class GetBookingsHandler extends BaseHandler {

    public GetBookingsHandler(BookingStore store, NotificationManager nm) {
        super(store, nm);
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (handleOptions(exchange)) return;

        if (!"GET".equals(exchange.getRequestMethod())) {
            sendError(exchange, 405, "Method not allowed.");
            return;
        }
        sendJson(exchange, 200, store.getAllBookingsJson());
    }
}

// =============================================================================
// PostBookingHandler — POST /api/bookings
// =============================================================================
// Creates a new booking in the in-memory store and notifies observers.
//
// Expected request body (JSON):
//   { service, price, clientName, clientEmail,
//     consultantName, bookingDate, bookingTime }
//
// Response: the newly created booking object (JSON, status 201 Created)
// =============================================================================
class PostBookingHandler extends BaseHandler {

    public PostBookingHandler(BookingStore store, NotificationManager nm) {
        super(store, nm);
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (handleOptions(exchange)) return;

        if (!"POST".equals(exchange.getRequestMethod())) {
            sendError(exchange, 405, "Method not allowed.");
            return;
        }

        try {
            String body = readBody(exchange);

            // parseField uses regex to extract each top-level string from the JSON body
            String service        = parseField(body, "service");
            String price          = parseField(body, "price");
            String clientName     = parseField(body, "clientName");
            String clientEmail    = parseField(body, "clientEmail");
            String consultantName = parseField(body, "consultantName");
            String bookingDate    = parseField(body, "bookingDate");
            String bookingTime    = parseField(body, "bookingTime");

            if (service == null || clientName == null || consultantName == null) {
                sendError(exchange, 400, "Missing required fields.");
                return;
            }

            Booking booking = store.addBooking(
                clientName,    clientEmail     != null ? clientEmail     : "",
                service,       price           != null ? price           : "",
                consultantName,
                bookingDate    != null ? bookingDate : "",
                bookingTime    != null ? bookingTime : ""
            );

            // Observer Pattern: fan out the booking-created event
            notificationManager.sendNotification("BOOKING_REQUESTED",
                Map.of("bookingId", booking.id,
                       "client",    booking.clientName,
                       "service",   booking.service));

            sendJson(exchange, 201, booking.toJson());

        } catch (Exception e) {
            sendError(exchange, 500, e.getMessage());
        }
    }
}

// =============================================================================
// PatchBookingStatusHandler — PATCH /api/bookings/:id/status
// =============================================================================
// Updates a booking's status.  Applies the State Pattern (validates transition)
// and, when status = "Paid", the Strategy Pattern (processes payment).
//
// Expected request body (JSON):
//   { "status": "Confirmed", "actor": "consultant" }
//   { "status": "Paid", "methodType": "Credit Card", "methodId": "pm_001" }
//
// Response: the updated booking object (JSON)
// =============================================================================
class PatchBookingStatusHandler extends BaseHandler {

    // Matches: /api/bookings/42/status
    private static final Pattern URL_PATTERN =
        Pattern.compile("/api/bookings/(\\d+)/status");

    public PatchBookingStatusHandler(BookingStore store, NotificationManager nm) {
        super(store, nm);
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (handleOptions(exchange)) return;

        if (!"PATCH".equals(exchange.getRequestMethod())) {
            sendError(exchange, 405, "Method not allowed.");
            return;
        }

        try {
            // Extract booking ID from URL path
            String  path    = exchange.getRequestURI().getPath();
            Matcher matcher = URL_PATTERN.matcher(path);
            if (!matcher.matches()) {
                sendError(exchange, 400, "Invalid URL format.");
                return;
            }
            int bookingId = Integer.parseInt(matcher.group(1));

            // Parse request body
            String body       = readBody(exchange);
            String nextStatus = parseField(body, "status");
            String actor      = parseField(body, "actor");
            String methodType = parseField(body, "methodType");   // sent by booking.js when paying
            String methodId   = parseField(body, "methodId");     // the pm_<ts> id

            if (nextStatus == null) {
                sendError(exchange, 400, "Missing required field: status.");
                return;
            }

            // ── Strategy Pattern: process payment when transitioning to "Paid" ──
            // PaymentStrategyFactory picks the right strategy based on methodType.
            // The strategy validates the details and generates a transaction ID.
            String transactionId = null;
            if ("Paid".equals(nextStatus) && methodType != null) {
                PaymentDetails details = new PaymentDetails(
                    methodId != null ? methodId : "", methodType);
                PaymentResult result = PaymentStrategyFactory
                    .create(methodType)
                    .process(store.findById(bookingId).price, details);

                if (!result.success) {
                    sendError(exchange, 400, result.message);
                    return;
                }
                transactionId = result.transactionId;
            }

            // ── State Pattern: BookingStore.updateStatus delegates transition
            //    validation to BookingStateMachine which throws if illegal ──────
            Booking updated = store.updateStatus(bookingId, nextStatus, transactionId);

            // ── Observer Pattern: broadcast to all registered notifiers ────────
            String eventName = "BOOKING_" + nextStatus.toUpperCase().replace(" ", "_");
            notificationManager.sendNotification(eventName,
                Map.of("bookingId", bookingId,
                       "status",    nextStatus,
                       "actor",     actor != null ? actor : "system"));

            sendJson(exchange, 200, updated.toJson());

        } catch (IllegalArgumentException e) {
            sendError(exchange, 404, e.getMessage());
        } catch (IllegalStateException e) {
            // State Pattern blocked the transition
            sendError(exchange, 409, e.getMessage());
        } catch (Exception e) {
            sendError(exchange, 500, e.getMessage());
        }
    }
}

// =============================================================================
// SseHandler — GET /api/bookings/stream
// =============================================================================
// Keeps the HTTP connection open and pushes booking events to the browser
// in real time using Server-Sent Events (SSE).
//
// BookingStore.js uses EventSource to connect to this endpoint.
// Falls back to polling every 3 seconds if EventSource is not supported.
// =============================================================================
class SseHandler extends BaseHandler {

    public SseHandler(BookingStore store, NotificationManager nm) {
        super(store, nm);
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (handleOptions(exchange)) return;

        if (!"GET".equals(exchange.getRequestMethod())) {
            sendError(exchange, 405, "Method not allowed.");
            return;
        }

        // SSE requires these specific response headers
        exchange.getResponseHeaders().add("Content-Type",  "text/event-stream");
        exchange.getResponseHeaders().add("Cache-Control", "no-cache");
        exchange.getResponseHeaders().add("Connection",    "keep-alive");
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        exchange.sendResponseHeaders(200, 0);   // 0 = chunked / streaming body

        // Register a queue for this SSE client.
        // BookingStore.broadcastEvent() offers messages to all registered queues.
        BlockingQueue<String> queue = store.registerSseClient();

        try (OutputStream os = exchange.getResponseBody()) {
            // Initial heartbeat comment confirms the connection is live
            os.write(": connected\n\n".getBytes(StandardCharsets.UTF_8));
            os.flush();

            // Loop: block until a message arrives, then send it; or send a
            // heartbeat comment after 15 s so the connection does not time out
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    String event = queue.poll(15, TimeUnit.SECONDS);
                    if (event != null) {
                        os.write(event.getBytes(StandardCharsets.UTF_8));
                    } else {
                        os.write(": heartbeat\n\n".getBytes(StandardCharsets.UTF_8));
                    }
                    os.flush();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        } catch (IOException e) {
            // Client disconnected — not an error
        } finally {
            store.removeSseClient(queue);
        }
    }
}

// =============================================================================
// ── PAYMENT-METHOD HANDLERS ───────────────────────────────────────────────────
// =============================================================================

// =============================================================================
// GetPaymentMethodsHandler — GET /api/payment-methods
// =============================================================================
// Queries the payment_methods table via PaymentMethodStore and returns the
// result as a JSON array.
//
// Called by: methods.js loadMethods(), booking.js payment modal fetch
//
// Response shape (array of objects):
//   [{ "id":"pm_...", "type":"Credit Card", "label":"...", "createdAt":"..." },
//    ...]
// =============================================================================
class GetPaymentMethodsHandler extends PmBaseHandler {

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (handleOptions(exchange)) return;

        if (!"GET".equals(exchange.getRequestMethod())) {
            sendError(exchange, 405, "Method not allowed.");
            return;
        }

        try {
            // PaymentMethodStore runs a SELECT and serialises every row to JSON
            String json = new PaymentMethodStore().getAllMethodsJson();
            sendJson(exchange, 200, json);

        } catch (SQLException e) {
            // Surface database errors as 503 Service Unavailable
            sendError(exchange, 503, "Database error: " + e.getMessage());
        }
    }
}

// =============================================================================
// PostPaymentMethodHandler — POST /api/payment-methods
// =============================================================================
// Inserts a new row into the payment_methods table.
//
// Called by: methods.js save-method click handler
//
// Expected request body (JSON):
//   { "type": "Credit Card", "label": "Alice - ending in 4242" }
//
// Response: the created record (JSON, status 201 Created)
//   { "id":"pm_...", "type":"Credit Card", "label":"...", "createdAt":"..." }
// =============================================================================
class PostPaymentMethodHandler extends PmBaseHandler {

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (handleOptions(exchange)) return;

        if (!"POST".equals(exchange.getRequestMethod())) {
            sendError(exchange, 405, "Method not allowed.");
            return;
        }

        try {
            String body  = readBody(exchange);
            String type  = parseField(body, "type");
            String label = parseField(body, "label");

            if (type == null || type.isBlank()) {
                sendError(exchange, 400, "Missing required field: type.");
                return;
            }
            if (label == null || label.isBlank()) {
                sendError(exchange, 400, "Missing required field: label.");
                return;
            }

            // Generate the primary key the same way methods.js used to:
            // "pm_" + current epoch milliseconds → unique enough for a demo
            String id = "pm_" + System.currentTimeMillis();

            PaymentMethodStore.PaymentMethod created =
                new PaymentMethodStore().addMethod(id, type, label);

            sendJson(exchange, 201, created.toJson());

        } catch (SQLException e) {
            sendError(exchange, 503, "Database error: " + e.getMessage());
        } catch (Exception e) {
            sendError(exchange, 500, e.getMessage());
        }
    }
}

// =============================================================================
// DeletePaymentMethodHandler — DELETE /api/payment-methods/:id
// =============================================================================
// Removes a single row from the payment_methods table by its primary key.
//
// Called by: methods.js Remove button click handler
//
// URL pattern: /api/payment-methods/pm_1709692400000
//
// Response: 204 No Content (success) or 404 Not Found (unknown id)
// =============================================================================
class DeletePaymentMethodHandler extends PmBaseHandler {

    // Matches: /api/payment-methods/pm_1709692400000  (or any non-empty suffix)
    private static final Pattern URL_PATTERN =
        Pattern.compile("/api/payment-methods/(.+)");

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (handleOptions(exchange)) return;

        if (!"DELETE".equals(exchange.getRequestMethod())) {
            sendError(exchange, 405, "Method not allowed.");
            return;
        }

        try {
            // Extract the id segment from the URL path
            String  path    = exchange.getRequestURI().getPath();
            Matcher matcher = URL_PATTERN.matcher(path);
            if (!matcher.matches()) {
                sendError(exchange, 400, "Missing payment method id in URL.");
                return;
            }
            String id = matcher.group(1);   // "pm_1709692400000"

            boolean deleted = new PaymentMethodStore().deleteMethod(id);

            if (deleted) {
                // 204 No Content: the resource no longer exists, nothing to return
                sendNoContent(exchange);
            } else {
                sendError(exchange, 404, "Payment method not found: " + id);
            }

        } catch (SQLException e) {
            sendError(exchange, 503, "Database error: " + e.getMessage());
        } catch (Exception e) {
            sendError(exchange, 500, e.getMessage());
        }
    }
}

// =============================================================================
// ApiHandler — public factory that creates handlers for Server.java
// =============================================================================
// Server.java calls these static methods when setting up HttpServer contexts.
// Using a factory keeps the handler constructors package-private and prevents
// Server.java from depending on the concrete handler class names.
// =============================================================================
public class ApiHandler {

    // ── Booking handler factories ─────────────────────────────────────────────

    public static HttpHandler getBookings(BookingStore store, NotificationManager nm) {
        return new GetBookingsHandler(store, nm);
    }

    public static HttpHandler postBooking(BookingStore store, NotificationManager nm) {
        return new PostBookingHandler(store, nm);
    }

    public static HttpHandler patchBookingStatus(BookingStore store, NotificationManager nm) {
        return new PatchBookingStatusHandler(store, nm);
    }

    public static HttpHandler sseStream(BookingStore store, NotificationManager nm) {
        return new SseHandler(store, nm);
    }

    // ── Payment-method handler factories ─────────────────────────────────────
    // No store/nm parameters needed — PaymentMethodStore is instantiated inside
    // each handler because it carries no in-memory state.

    /** Returns a handler for GET /api/payment-methods */
    public static HttpHandler getPaymentMethods() {
        return new GetPaymentMethodsHandler();
    }

    /** Returns a handler for POST /api/payment-methods */
    public static HttpHandler postPaymentMethod() {
        return new PostPaymentMethodHandler();
    }

    /** Returns a handler for DELETE /api/payment-methods/:id */
    public static HttpHandler deletePaymentMethod() {
        return new DeletePaymentMethodHandler();
    }
}
