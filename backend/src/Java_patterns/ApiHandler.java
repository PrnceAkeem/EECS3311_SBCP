package api;

// =============================================================================
// ApiHandler.java — HTTP handlers for every endpoint called by the JS frontend
// =============================================================================
//
// The JS frontend (BookingStore.js) makes exactly three API calls:
//
//   GET    /api/bookings              → GetBookingsHandler
//   POST   /api/bookings              → PostBookingHandler
//   PATCH  /api/bookings/:id/status   → PatchBookingStatusHandler
//
// And one SSE stream for live updates:
//   GET    /api/bookings/stream       → SseHandler
//
// Each handler:
//   1. Reads the HTTP request
//   2. Parses JSON body (using simple string parsing — no external library)
//   3. Calls the appropriate store/pattern method
//   4. Writes a JSON response with correct Content-Type and CORS headers
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

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// =============================================================================
// BaseHandler — shared helpers for all handlers
// =============================================================================
abstract class BaseHandler implements HttpHandler {

    protected final BookingStore       store;
    protected final NotificationManager notificationManager;

    protected BaseHandler(BookingStore store, NotificationManager notificationManager) {
        this.store               = store;
        this.notificationManager = notificationManager;
    }

    // ── Response helpers ──────────────────────────────────────────────────────

    protected void sendJson(HttpExchange exchange, int statusCode, String json)
            throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        addCorsHeaders(exchange);
        exchange.sendResponseHeaders(statusCode, body.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(body);
        }
    }

    protected void sendError(HttpExchange exchange, int statusCode, String message)
            throws IOException {
        String json = "{\"error\":\"" + escape(message) + "\"}";
        sendJson(exchange, statusCode, json);
    }

    protected void sendNoContent(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);
        exchange.sendResponseHeaders(204, -1);
        exchange.getResponseBody().close();
    }

    // ── CORS headers (needed when frontend is on a different port) ────────────
    private void addCorsHeaders(HttpExchange exchange) {
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().add("Access-Control-Allow-Methods",
                "GET, POST, PATCH, OPTIONS");
        exchange.getResponseHeaders().add("Access-Control-Allow-Headers",
                "Content-Type");
    }

    // ── Request body reader ───────────────────────────────────────────────────
    protected String readBody(HttpExchange exchange) throws IOException {
        try (InputStream is = exchange.getRequestBody()) {
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    // ── Minimal JSON field extractor (avoids external library dependency) ─────
    // Extracts the value of a top-level string field from a JSON object.
    // e.g. parseField("{\"status\":\"Confirmed\"}", "status") → "Confirmed"
    protected String parseField(String json, String field) {
        Pattern p = Pattern.compile("\"" + field + "\"\\s*:\\s*\"([^\"\\\\]*(\\\\.[^\"\\\\]*)*)\"");
        Matcher m = p.matcher(json);
        if (m.find()) return m.group(1);
        // Also handle numeric values
        Pattern pNum = Pattern.compile("\"" + field + "\"\\s*:\\s*(\\d+)");
        Matcher mNum = pNum.matcher(json);
        if (mNum.find()) return mNum.group(1);
        return null;
    }

    // ── Escape a string for safe embedding in a JSON value ────────────────────
    protected String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    // ── Handle OPTIONS preflight (CORS) ───────────────────────────────────────
    protected boolean handleOptions(HttpExchange exchange) throws IOException {
        if ("OPTIONS".equals(exchange.getRequestMethod())) {
            sendNoContent(exchange);
            return true;
        }
        return false;
    }
}

// =============================================================================
// GetBookingsHandler — GET /api/bookings
// =============================================================================
// Mirrors: BookingStore.getBookings() in BookingStore.js
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
// Mirrors: BookingStore.addBooking() in BookingStore.js
// Called by: confirmBookingButton click handler in services.js
//
// Expected request body (JSON):
//   { service, price, clientName, clientEmail,
//     consultantName, bookingDate, bookingTime }
//
// Response: the newly created booking object (JSON)
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
                clientName, clientEmail != null ? clientEmail : "",
                service, price != null ? price : "",
                consultantName,
                bookingDate != null ? bookingDate : "",
                bookingTime != null ? bookingTime : ""
            );

            // Observer: notify all registered notifiers
            notificationManager.sendNotification("BOOKING_REQUESTED",
                Map.of("bookingId", booking.id, "client", booking.clientName,
                       "service", booking.service));

            sendJson(exchange, 201, booking.toJson());

        } catch (Exception e) {
            sendError(exchange, 500, e.getMessage());
        }
    }
}

// =============================================================================
// PatchBookingStatusHandler — PATCH /api/bookings/:id/status
// =============================================================================
// Mirrors: BookingStore.updateBookingStatus() in BookingStore.js
// Called by: admin.js save button, consultant.js save button,
//            booking.js Pay and Cancel buttons
//
// Expected request body (JSON):
//   { status: "Confirmed", actor: "consultant" }
//   { status: "Paid", methodType: "Credit Card", methodId: "pm_001" }
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
            // Extract booking ID from the URL path
            String path = exchange.getRequestURI().getPath();
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
            String methodType = parseField(body, "methodType");
            String methodId   = parseField(body, "methodId");

            if (nextStatus == null) {
                sendError(exchange, 400, "Missing required field: status.");
                return;
            }

            // ── Strategy Pattern: run payment processing if status = "Paid" ──
            String transactionId = null;
            if ("Paid".equals(nextStatus) && methodType != null) {
                PaymentDetails details = new PaymentDetails(
                    methodId != null ? methodId : "",
                    methodType
                );
                // PaymentStrategyFactory picks the right strategy
                PaymentResult result = PaymentStrategyFactory
                    .create(methodType)
                    .process(store.findById(bookingId).price, details);

                if (!result.success) {
                    sendError(exchange, 400, result.message);
                    return;
                }
                transactionId = result.transactionId;
            }

            // ── State Pattern: validate and apply the transition ──────────────
            // BookingStateMachine.transition() throws if the transition is illegal
            Booking updated = store.updateStatus(bookingId, nextStatus, transactionId);

            // ── Observer Pattern: fan out notification to all notifiers ───────
            String eventName = "BOOKING_" + nextStatus.toUpperCase().replace(" ", "_");
            notificationManager.sendNotification(eventName,
                Map.of("bookingId", bookingId,
                       "status",    nextStatus,
                       "actor",     actor != null ? actor : "system"));

            sendJson(exchange, 200, updated.toJson());

        } catch (IllegalArgumentException e) {
            // Booking not found, unknown status, bad method type
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
// Server-Sent Events: keeps the connection open and pushes booking events
// to the browser in real time. BookingStore.js uses EventSource to connect.
//
// Mirrors the SSE broadcast in server.js (broadcastBookingEvent).
// Falls back to polling every 3 seconds if the client doesn't support SSE
// (that fallback is handled in BookingStore.js, not here).
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

        // SSE response headers
        exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
        exchange.getResponseHeaders().add("Cache-Control", "no-cache");
        exchange.getResponseHeaders().add("Connection", "keep-alive");
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        exchange.sendResponseHeaders(200, 0);   // 0 = chunked / streaming

        // Register this client to receive broadcast messages
        BlockingQueue<String> queue = store.registerSseClient();

        try (OutputStream os = exchange.getResponseBody()) {
            // Send initial heartbeat comment so the browser knows it's connected
            os.write(": connected\n\n".getBytes(StandardCharsets.UTF_8));
            os.flush();

            // Block and stream events until client disconnects
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    // Poll with timeout so we can detect disconnection
                    String event = queue.poll(15, TimeUnit.SECONDS);
                    if (event != null) {
                        os.write(event.getBytes(StandardCharsets.UTF_8));
                        os.flush();
                    } else {
                        // Heartbeat comment to keep the connection alive
                        os.write(": heartbeat\n\n".getBytes(StandardCharsets.UTF_8));
                        os.flush();
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        } catch (IOException e) {
            // Client disconnected — normal, not an error
        } finally {
            store.removeSseClient(queue);
        }
    }
}

// =============================================================================
// ApiHandlerFactory — Creates and returns the correct handler for a path
// =============================================================================
// Used by Server.java when registering routes.
// =============================================================================
public class ApiHandler {

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
}
