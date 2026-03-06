import api.ApiHandler;
import patterns.*;
import store.BookingStore;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

// =============================================================================
// Server.java — Main entry point
// =============================================================================
//
// HOW JS TALKS TO JAVA (the full picture):
//
//   Browser JS (BookingStore.js)
//         │
//         │  fetch("http://localhost:8080/api/bookings", ...)
//         │
//         ▼
//   HttpServer (this file, port 8080)
//         │
//         ├─ GET    /api/bookings           → GetBookingsHandler
//         │                                     → BookingStore.getAllBookingsJson()
//         │
//         ├─ POST   /api/bookings           → PostBookingHandler
//         │                                     → BookingStore.addBooking()
//         │                                     → NotificationManager.sendNotification()
//         │                                     (Observer pattern)
//         │
//         ├─ PATCH  /api/bookings/:id/status → PatchBookingStatusHandler
//         │                                     → BookingStateMachine.transition()
//         │                                     (State pattern)
//         │                                     → PaymentStrategyFactory.create()
//         │                                     (Strategy pattern — only for "Paid")
//         │                                     → NotificationManager.sendNotification()
//         │                                     (Observer pattern)
//         │
//         └─ GET    /api/bookings/stream     → SseHandler
//                                               (Server-Sent Events — live updates)
//
// Singleton pattern:
//   SystemPolicyManager.getInstance() is called inside BookingStore.updateStatus()
//   to enforce the cancellation window before delegating to the State machine.
//
// Factory pattern:
//   UserFactory is called by the login/registration flow.
//   In Phase 1 it is demonstrated in the startup log below.
//
// =============================================================================
public class Server {

    private static final int PORT = 8080;

    public static void main(String[] args) throws IOException {

        // ── Bootstrap the Observer pattern ────────────────────────────────────
        // NotificationManager fans out events to Email, SMS, and Push notifiers.
        // Console output in Phase 1 is the proof of observer activity.
        NotificationManager notificationManager = new NotificationManager();
        notificationManager.attach(new EmailNotifier());
        notificationManager.attach(new SmsNotifier());
        notificationManager.attach(new PushNotifier());

        // ── Bootstrap the in-memory data store ────────────────────────────────
        BookingStore store = new BookingStore();

        // ── Demonstrate Factory pattern at startup ─────────────────────────────
        UserFactory factory = new UserFactory();
        User demoClient     = factory.createUser("client",     "C001", "Alice",   "client@synergy.ca",     null);
        User demoConsultant = factory.createUser("consultant", "T001", "Bob",     "consultant@synergy.ca", "Software Architecture");
        User demoAdmin      = factory.createUser("admin",      "A001", "Carol",   "admin@synergy.ca",      null);

        System.out.println("═══════════════════════════════════════════════════════");
        System.out.println("  EECS 3311 – Service Booking & Consulting Platform");
        System.out.println("  Backend starting on port " + PORT);
        System.out.println("═══════════════════════════════════════════════════════");
        System.out.printf("[Factory]   Created: %s (%s), %s (%s), %s (%s)%n",
            demoClient.getName(),     demoClient.getRole(),
            demoConsultant.getName(), demoConsultant.getRole(),
            demoAdmin.getName(),      demoAdmin.getRole());
        System.out.println("[Singleton] " + SystemPolicyManager.getInstance());
        System.out.println("[Observer]  EmailNotifier, SmsNotifier, PushNotifier registered.");
        System.out.println();

        // ── Build the HTTP server ──────────────────────────────────────────────
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        // Route: GET /api/bookings → returns all bookings as JSON array
        server.createContext("/api/bookings/stream",
            ApiHandler.sseStream(store, notificationManager));

        // Route dispatcher: GET → list all, POST → create new
        server.createContext("/api/bookings", exchange -> {
            String method = exchange.getRequestMethod();
            String path   = exchange.getRequestURI().getPath();

            // /api/bookings/:id/status — PATCH
            if (path.matches("/api/bookings/\\d+/status")) {
                ApiHandler.patchBookingStatus(store, notificationManager)
                          .handle(exchange);
                return;
            }

            // /api/bookings — GET or POST
            if ("GET".equals(method) || "OPTIONS".equals(method)) {
                ApiHandler.getBookings(store, notificationManager)
                          .handle(exchange);
            } else if ("POST".equals(method)) {
                ApiHandler.postBooking(store, notificationManager)
                          .handle(exchange);
            } else {
                byte[] body = "{\"error\":\"Method not allowed.\"}".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(405, body.length);
                try (OutputStream os = exchange.getResponseBody()) { os.write(body); }
            }
        });

        // Thread pool: one thread per request so SSE doesn't block API calls
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();

        System.out.println("[Server]    Listening on http://localhost:" + PORT);
        System.out.println("[Server]    Endpoints:");
        System.out.println("              GET    /api/bookings");
        System.out.println("              POST   /api/bookings");
        System.out.println("              PATCH  /api/bookings/:id/status");
        System.out.println("              GET    /api/bookings/stream  (SSE)");
        System.out.println();
        System.out.println("[Server]    Ready. Waiting for requests from the frontend...");
    }
}
