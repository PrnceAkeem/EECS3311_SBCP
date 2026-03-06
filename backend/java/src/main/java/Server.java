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
// Server.java — Main entry point for the Java HTTP backend
// =============================================================================
//
// HOW JS TALKS TO JAVA (the full picture):
//
//   Browser JS (bookings-data.js, methods.js)
//         │
//         │  fetch("http://localhost:8080/api/...", { method, headers, body })
//         │  ← HTTP request over the loopback network interface →
//         ▼
//   HttpServer (this file, port 8080)
//         │
//         ├─ GET    /api/bookings              → GetBookingsHandler
//         │                                       → BookingStore.getAllBookingsJson()
//         │
//         ├─ POST   /api/bookings              → PostBookingHandler
//         │                                       → BookingStore.addBooking()
//         │                                       → NotificationManager.sendNotification()
//         │                                          (Observer pattern)
//         │
//         ├─ PATCH  /api/bookings/:id/status   → PatchBookingStatusHandler
//         │                                       → BookingStateMachine.transition()
//         │                                          (State pattern)
//         │                                       → PaymentStrategyFactory.create()
//         │                                          (Strategy pattern — only for "Paid")
//         │                                       → NotificationManager.sendNotification()
//         │                                          (Observer pattern)
//         │
//         ├─ GET    /api/bookings/stream        → SseHandler
//         │                                          (Server-Sent Events — live updates)
//         │
//         ├─ GET    /api/payment-methods        → GetPaymentMethodsHandler
//         │                                       → PaymentMethodStore.getAllMethodsJson()
//         │                                       → SQL: SELECT FROM payment_methods
//         │
//         ├─ POST   /api/payment-methods        → PostPaymentMethodHandler
//         │                                       → PaymentMethodStore.addMethod()
//         │                                       → SQL: INSERT INTO payment_methods
//         │
//         └─ DELETE /api/payment-methods/:id    → DeletePaymentMethodHandler
//                                                  → PaymentMethodStore.deleteMethod()
//                                                  → SQL: DELETE FROM payment_methods
//
// DESIGN PATTERNS DEMONSTRATED:
//   Singleton  → SystemPolicyManager.getInstance()
//   Factory    → UserFactory.createUser()  (demonstrated at startup)
//   Observer   → NotificationManager + Email/Sms/PushNotifier
//   State      → BookingStateMachine.transition()
//   Strategy   → PaymentStrategyFactory.create()
//
// BUILD & RUN:
//   cd backend/java
//   mvn package
//   export DATABASE_URL=postgres://synergy_user:synergy_pass@localhost:5432/synergy
//   java -jar target/synergy-booking-1.0.0.jar
//
// =============================================================================
public class Server {

    // The Java HTTP server listens on this port.
    // The frontend JS files send all requests to http://localhost:PORT.
    private static final int PORT = 8080;

    public static void main(String[] args) throws IOException {

        // ── Bootstrap the Observer pattern ────────────────────────────────────
        // NotificationManager is the Subject; it fans booking events out to
        // three concrete Observer instances (email, SMS, push).
        // In Phase 1 they just print to the console — real channels in Phase 2.
        NotificationManager notificationManager = new NotificationManager();
        notificationManager.attach(new EmailNotifier());
        notificationManager.attach(new SmsNotifier());
        notificationManager.attach(new PushNotifier());

        // ── Bootstrap the in-memory booking store ─────────────────────────────
        // BookingStore holds all booking objects for the lifetime of this process.
        // (Payment methods are stored in PostgreSQL via PaymentMethodStore.)
        BookingStore store = new BookingStore();

        // ── Demonstrate the Factory pattern at startup ─────────────────────────
        // UserFactory.createUser() picks the right User subclass (Client /
        // Consultant / Admin) based on the type string.
        UserFactory factory = new UserFactory();
        User demoClient     = factory.createUser("client",     "C001", "Alice", "client@synergy.ca",     null);
        User demoConsultant = factory.createUser("consultant", "T001", "Bob",   "consultant@synergy.ca", "Software Architecture");
        User demoAdmin      = factory.createUser("admin",      "A001", "Carol", "admin@synergy.ca",      null);

        System.out.println("═══════════════════════════════════════════════════════");
        System.out.println("  EECS 3311 – Service Booking & Consulting Platform");
        System.out.println("  Java backend starting on port " + PORT);
        System.out.println("═══════════════════════════════════════════════════════");
        System.out.printf("[Factory]   Created: %s (%s), %s (%s), %s (%s)%n",
            demoClient.getName(),     demoClient.getRole(),
            demoConsultant.getName(), demoConsultant.getRole(),
            demoAdmin.getName(),      demoAdmin.getRole());
        System.out.println("[Singleton] " + SystemPolicyManager.getInstance());
        System.out.println("[Observer]  EmailNotifier, SmsNotifier, PushNotifier registered.");
        System.out.println("[DB]        Payment methods are persisted in PostgreSQL via JDBC.");
        System.out.println();

        // ── Build the HTTP server ──────────────────────────────────────────────
        // HttpServer is part of the JDK (com.sun.net.httpserver) — no extra
        // library needed for the HTTP layer.
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        // ── Booking routes ─────────────────────────────────────────────────────
        // createContext() registers a handler for a URL prefix.
        // The SSE endpoint must be registered FIRST because HttpServer uses prefix
        // matching and /api/bookings/stream is more specific than /api/bookings.

        server.createContext("/api/bookings/stream",
            ApiHandler.sseStream(store, notificationManager));

        // /api/bookings handles GET (list all), POST (create), and
        // /api/bookings/:id/status handles PATCH (update status).
        // All routing is done inside the lambda based on method + path.
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

        // ── Payment-method routes ──────────────────────────────────────────────
        // These endpoints persist data in PostgreSQL via PaymentMethodStore + JDBC.
        //
        // GET    /api/payment-methods        → list all saved methods
        // POST   /api/payment-methods        → add a new method
        // DELETE /api/payment-methods/:id    → remove a method by id
        //
        // All three are served from one createContext("/api/payment-methods", ...).
        // The lambda dispatches based on HTTP method and whether the path
        // contains an additional segment (the id for DELETE).
        server.createContext("/api/payment-methods", exchange -> {
            String method = exchange.getRequestMethod();
            String path   = exchange.getRequestURI().getPath();

            // Handle CORS pre-flight for all payment-method endpoints
            if ("OPTIONS".equals(method)) {
                exchange.getResponseHeaders().add("Access-Control-Allow-Origin",  "*");
                exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
                exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
                exchange.sendResponseHeaders(204, -1);
                exchange.getResponseBody().close();
                return;
            }

            // /api/payment-methods/pm_<id> — DELETE
            // The path has an extra segment after /api/payment-methods/
            if (path.matches("/api/payment-methods/.+") && "DELETE".equals(method)) {
                ApiHandler.deletePaymentMethod().handle(exchange);
                return;
            }

            // /api/payment-methods — GET or POST
            if ("GET".equals(method)) {
                ApiHandler.getPaymentMethods().handle(exchange);
            } else if ("POST".equals(method)) {
                ApiHandler.postPaymentMethod().handle(exchange);
            } else {
                byte[] body = "{\"error\":\"Method not allowed.\"}".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
                exchange.sendResponseHeaders(405, body.length);
                try (OutputStream os = exchange.getResponseBody()) { os.write(body); }
            }
        });

        // Use a cached thread pool: one thread per request so that long-running
        // SSE connections do not block other API requests.
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();

        System.out.println("[Server]    Listening on http://localhost:" + PORT);
        System.out.println("[Server]    Endpoints:");
        System.out.println("              GET    /api/bookings");
        System.out.println("              POST   /api/bookings");
        System.out.println("              PATCH  /api/bookings/:id/status");
        System.out.println("              GET    /api/bookings/stream  (SSE)");
        System.out.println("              GET    /api/payment-methods          ← PostgreSQL");
        System.out.println("              POST   /api/payment-methods          ← PostgreSQL");
        System.out.println("              DELETE /api/payment-methods/:id      ← PostgreSQL");
        System.out.println();
        System.out.println("[Server]    Ready. Waiting for requests from the frontend...");
    }
}
