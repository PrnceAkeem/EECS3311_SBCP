package db;

// =============================================================================
// Database.java — JDBC connection factory
// =============================================================================
//
// WHAT IS JDBC?
//   Java Database Connectivity (JDBC) is the standard Java API for talking to
//   relational databases.  Instead of writing raw network code, you call
//   DriverManager.getConnection(url, user, password) and Java hands back a
//   Connection object that understands SQL.
//
// HOW THIS CLASS WORKS:
//   1. At class-load time (the static { } block) it reads the DATABASE_URL
//      environment variable that Docker Compose injects.
//   2. The URL arrives in Postgres URI format:
//        postgres://user:password@host:port/database
//      JDBC needs it in JDBC URL format:
//        jdbc:postgresql://host:port/database
//      The static block parses the URI and splits out the credentials.
//   3. getConnection() calls DriverManager.getConnection() with those values
//      and returns a live Connection.  Every caller wraps it in a
//      try-with-resources block so the connection is always closed.
//
// WHY NO CONNECTION POOL?
//   For Phase 1 (a demo with a handful of users) one connection per request
//   is fine.  For Phase 2 swap DriverManager for HikariCP's HikariDataSource
//   and replace getConnection() with dataSource.getConnection().
//
// USED BY:
//   store.PaymentMethodStore  — every read/write to the payment_methods table
//
// =============================================================================

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

public class Database {

    // ── Connection parameters derived from DATABASE_URL ───────────────────────
    // These are computed once when the class is first loaded, so the environment
    // variable is only read once and the parsing cost is paid only at startup.

    private static final String JDBC_URL;
    private static final String JDBC_USER;
    private static final String JDBC_PASSWORD;

    static {
        // DATABASE_URL is set by docker-compose.yml:
        //   DATABASE_URL=postgres://synergy_user:synergy_pass@db:5432/synergy
        // For local dev without Docker you can set it to:
        //   postgres://synergy_user:synergy_pass@localhost:5432/synergy
        String raw = System.getenv("DATABASE_URL");

        if (raw != null && raw.startsWith("postgres://")) {
            // Strip the "postgres://" scheme prefix
            // Result: "synergy_user:synergy_pass@db:5432/synergy"
            String withoutScheme = raw.substring("postgres://".length());

            // Split on the last '@' to separate credentials from host
            int atIdx = withoutScheme.lastIndexOf('@');

            // "synergy_user:synergy_pass"
            String credentials = withoutScheme.substring(0, atIdx);

            // "db:5432/synergy"
            String hostAndDb   = withoutScheme.substring(atIdx + 1);

            // Split "user:password" into two parts
            String[] parts = credentials.split(":", 2);
            JDBC_USER     = parts[0];
            JDBC_PASSWORD = parts.length > 1 ? parts[1] : "";

            // Build the JDBC URL by prepending the JDBC scheme
            JDBC_URL = "jdbc:postgresql://" + hostAndDb;

        } else {
            // Fallback for running the server locally (no DATABASE_URL set).
            // Credentials match those in docker-compose.yml so you can start
            // only the DB container and run the Java server on the host machine.
            JDBC_URL      = "jdbc:postgresql://localhost:5432/synergy";
            JDBC_USER     = "synergy_user";
            JDBC_PASSWORD = "synergy_pass";
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Opens and returns a new JDBC Connection to the synergy PostgreSQL database.
     *
     * Callers MUST close this connection when finished.  Use try-with-resources:
     *
     *   try (Connection conn = Database.getConnection()) {
     *       // use conn ...
     *   }   // conn.close() is called automatically here
     *
     * @throws SQLException if the driver cannot connect (DB not running, bad
     *                      credentials, network error, etc.)
     */
    public static Connection getConnection() throws SQLException {
        // DriverManager reads the "jdbc:postgresql://" prefix, loads the
        // org.postgresql.Driver class (bundled in our fat jar by maven-shade),
        // and opens a TCP connection to the database server.
        return DriverManager.getConnection(JDBC_URL, JDBC_USER, JDBC_PASSWORD);
    }
}
