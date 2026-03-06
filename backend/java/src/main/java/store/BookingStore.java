package store;

// =============================================================================
// BookingStore.java — In-memory booking data store
// =============================================================================
//
// This is the Java equivalent of the in-memory booking list in server.js.
// server.js keeps bookings in a plain array; this class wraps that same
// concept with thread-safe access and sequential IDs.
//
// BookingStore is NOT a Singleton by pattern, but is instantiated once in
// Server.java and passed to the handlers — matching how server.js works.
//
// =============================================================================

import java.time.Instant;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

public class BookingStore {

    // ── Booking record ────────────────────────────────────────────────────────
    // Mirrors the plain JS booking object used across the frontend:
    //   { id, clientName, clientEmail, service, price, consultantName,
    //     bookingDate, bookingTime, status, transactionId, actor }
    public static class Booking {
        public final int    id;
        public       String clientName;
        public       String clientEmail;
        public       String service;
        public       String price;
        public       String consultantName;
        public       String bookingDate;
        public       String bookingTime;
        public       String status;
        public       String transactionId;  // set after payment
        public       String createdAt;

        public Booking(int id, String clientName, String clientEmail,
                       String service, String price, String consultantName,
                       String bookingDate, String bookingTime) {
            this.id             = id;
            this.clientName     = clientName;
            this.clientEmail    = clientEmail;
            this.service        = service;
            this.price          = price;
            this.consultantName = consultantName;
            this.bookingDate    = bookingDate;
            this.bookingTime    = bookingTime;
            this.status         = "Requested";   // always starts here
            this.transactionId  = null;
            this.createdAt      = Instant.now().toString();
        }

        // Serialises the booking to a JSON string matching the shape the
        // frontend JS expects. No external JSON library needed.
        public String toJson() {
            return "{"
                + "\"id\":"             + id                          + ","
                + "\"clientName\":"     + quoted(clientName)          + ","
                + "\"clientEmail\":"    + quoted(clientEmail)         + ","
                + "\"service\":"        + quoted(service)             + ","
                + "\"price\":"          + quoted(price)               + ","
                + "\"consultantName\":" + quoted(consultantName)      + ","
                + "\"bookingDate\":"    + quoted(bookingDate)         + ","
                + "\"bookingTime\":"    + quoted(bookingTime)         + ","
                + "\"status\":"         + quoted(status)              + ","
                + "\"transactionId\":"  + (transactionId != null
                                          ? quoted(transactionId)
                                          : "null")                   + ","
                + "\"createdAt\":"      + quoted(createdAt)
                + "}";
        }

        private static String quoted(String value) {
            if (value == null) return "\"\"";
            // Escape backslash and double-quote for safe JSON embedding
            return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
        }
    }

    // ── Storage ───────────────────────────────────────────────────────────────
    // CopyOnWriteArrayList is safe for concurrent reads (SSE + PATCH at once)
    private final List<Booking>    bookings  = new CopyOnWriteArrayList<>();
    private final AtomicInteger    idCounter = new AtomicInteger(1);

    // List of SSE listener queues — one per connected client
    private final List<java.util.concurrent.BlockingQueue<String>> sseClients
            = new CopyOnWriteArrayList<>();

    // ── Public API (mirrors BookingStore.js methods) ──────────────────────────

    /** Returns all bookings as a JSON array string. */
    public String getAllBookingsJson() {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < bookings.size(); i++) {
            if (i > 0) sb.append(",");
            sb.append(bookings.get(i).toJson());
        }
        sb.append("]");
        return sb.toString();
    }

    /** Creates a new booking and returns it. Mirrors POST /api/bookings. */
    public Booking addBooking(String clientName, String clientEmail,
                              String service, String price,
                              String consultantName,
                              String bookingDate, String bookingTime) {
        int id = idCounter.getAndIncrement();
        Booking b = new Booking(id, clientName, clientEmail, service, price,
                                consultantName, bookingDate, bookingTime);
        bookings.add(b);
        broadcastEvent("booking_created", b.toJson());
        return b;
    }

    /**
     * Updates a booking's status. Mirrors PATCH /api/bookings/:id/status.
     * Delegates transition validation to BookingStateMachine.
     * Sets transactionId if payment details are present.
     *
     * @throws IllegalArgumentException if booking not found
     * @throws IllegalStateException    if transition is invalid (from State pattern)
     */
    public Booking updateStatus(int bookingId, String nextStatus,
                                String transactionId) {
        Booking booking = findById(bookingId);

        // Delegate to State Pattern — throws if transition is illegal
        patterns.BookingStateMachine.transition(booking.status, nextStatus);

        booking.status = nextStatus;
        if (transactionId != null && !transactionId.isEmpty()) {
            booking.transactionId = transactionId;
        }

        broadcastEvent("booking_updated", booking.toJson());
        return booking;
    }

    /** Finds a booking by numeric ID. */
    public Booking findById(int bookingId) {
        for (Booking b : bookings) {
            if (b.id == bookingId) return b;
        }
        throw new IllegalArgumentException("Booking not found: " + bookingId);
    }

    // ── SSE broadcast (mirrors server.js broadcastBookingEvent) ───────────────

    /** Registers a new SSE client queue. Returns the queue to poll from. */
    public java.util.concurrent.BlockingQueue<String> registerSseClient() {
        java.util.concurrent.BlockingQueue<String> queue =
            new java.util.concurrent.LinkedBlockingQueue<>();
        sseClients.add(queue);
        return queue;
    }

    /** Removes an SSE client queue when the connection closes. */
    public void removeSseClient(java.util.concurrent.BlockingQueue<String> queue) {
        sseClients.remove(queue);
    }

    /** Sends a Server-Sent Event to all connected SSE clients. */
    private void broadcastEvent(String eventType, String dataJson) {
        // SSE format: "event: <type>\ndata: <json>\n\n"
        String message = "event: booking\ndata: " + dataJson + "\n\n";
        for (java.util.concurrent.BlockingQueue<String> q : sseClients) {
            q.offer(message);   // non-blocking; drop if client is slow
        }
    }
}
