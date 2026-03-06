package store;

// =============================================================================
// PaymentMethodStore.java — JDBC-backed store for the payment_methods table
// =============================================================================
//
// WHAT IS THIS CLASS?
//   The data-access layer for saved payment methods.  Instead of keeping
//   methods in a file or in-memory array, every read and write goes through
//   JDBC to the PostgreSQL payment_methods table.
//
// HOW THE DATA FLOWS (per operation):
//
//   GET /api/payment-methods
//     JS fetch() → Java GetPaymentMethodsHandler → getAllMethodsJson()
//     → SQL: SELECT id, type, label, created_at FROM payment_methods
//     → builds JSON array → Java sends 200 response → JS parses JSON
//
//   POST /api/payment-methods  { type, label }
//     JS fetch() → Java PostPaymentMethodHandler → addMethod(id, type, label)
//     → SQL: INSERT INTO payment_methods ... RETURNING *
//     → returns new row as JSON → JS refreshes the table
//
//   DELETE /api/payment-methods/:id
//     JS fetch() → Java DeletePaymentMethodHandler → deleteMethod(id)
//     → SQL: DELETE FROM payment_methods WHERE id = ?
//     → returns 204 No Content → JS removes the row from the table
//
// WHY PreparedStatement?
//   PreparedStatement uses parameterised SQL (placeholders "?") instead of
//   string concatenation.  This prevents SQL injection attacks — a malicious
//   label like '; DROP TABLE payment_methods; --' is treated as data, not code.
//
// WHY try-with-resources?
//   Connection, PreparedStatement, and ResultSet all implement AutoCloseable.
//   try-with-resources guarantees they are closed even if an exception is
//   thrown, preventing connection leaks.
//
// CALLED BY:
//   api.ApiHandler.GetPaymentMethodsHandler
//   api.ApiHandler.PostPaymentMethodHandler
//   api.ApiHandler.DeletePaymentMethodHandler
//
// =============================================================================

import db.Database;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

public class PaymentMethodStore {

    // ── Inner record ──────────────────────────────────────────────────────────

    /**
     * Immutable snapshot of a single payment_methods row.
     *
     * The toJson() method serialises it to the exact JSON shape the JS
     * frontend reads:
     *   { "id": "pm_...", "type": "Credit Card", "label": "...", "createdAt": "..." }
     *
     * Note: the SQL column is created_at but the JS field is createdAt
     * (camelCase vs snake_case).  The mapping happens inside toJson().
     */
    public static class PaymentMethod {

        public final String id;
        public final String type;
        public final String label;
        public final String createdAt;   // ISO-8601 string, e.g. "2026-03-05T14:30:00Z"

        public PaymentMethod(String id, String type, String label, String createdAt) {
            this.id        = id;
            this.type      = type;
            this.label     = label;
            this.createdAt = createdAt;
        }

        /**
         * Returns a JSON object string.  No external library is used;
         * all values are escaped manually via quoted().
         *
         * Example output:
         *   {"id":"pm_1709692400000","type":"Credit Card",
         *    "label":"Alice - ending in 4242","createdAt":"2026-03-05T14:30:00Z"}
         */
        public String toJson() {
            return "{"
                + "\"id\":"        + quoted(id)        + ","
                + "\"type\":"      + quoted(type)      + ","
                + "\"label\":"     + quoted(label)     + ","
                + "\"createdAt\":" + quoted(createdAt)
                + "}";
        }

        /** Wraps a string in JSON double-quotes, escaping \ and " inside it. */
        private static String quoted(String v) {
            if (v == null) return "\"\"";
            return "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
        }
    }

    // ── Public CRUD methods ───────────────────────────────────────────────────

    /**
     * Fetches every row from payment_methods, newest-first, and returns the
     * result as a JSON array string.
     *
     * Called by GetPaymentMethodsHandler to satisfy GET /api/payment-methods.
     *
     * Example return value:
     *   [{"id":"pm_2","type":"Bank Transfer","label":"TD (Chequing)","createdAt":"..."},
     *    {"id":"pm_1","type":"Credit Card","label":"Alice - ending in 4242","createdAt":"..."}]
     *
     * @throws SQLException if the database is unreachable or the table is missing
     */
    public String getAllMethodsJson() throws SQLException {
        // ORDER BY created_at DESC → most recently added method appears first
        String sql = "SELECT id, type, label, created_at "
                   + "FROM payment_methods "
                   + "ORDER BY created_at DESC";

        List<PaymentMethod> list = new ArrayList<>();

        // try-with-resources: Connection and PreparedStatement are closed automatically
        try (Connection         conn = Database.getConnection();
             PreparedStatement  stmt = conn.prepareStatement(sql);
             ResultSet          rs   = stmt.executeQuery()) {

            // Iterate every returned row and build a PaymentMethod object for each
            while (rs.next()) {
                list.add(new PaymentMethod(
                    rs.getString("id"),
                    rs.getString("type"),
                    rs.getString("label"),
                    // getTimestamp returns java.sql.Timestamp; toInstant() gives
                    // java.time.Instant; toString() formats it as ISO-8601
                    rs.getTimestamp("created_at").toInstant().toString()
                ));
            }
        }

        // Build the JSON array by hand — no external library required
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) sb.append(",");
            sb.append(list.get(i).toJson());
        }
        sb.append("]");
        return sb.toString();
    }

    /**
     * Inserts a new payment method row and returns the stored record
     * (including the server-generated created_at timestamp).
     *
     * Called by PostPaymentMethodHandler to satisfy POST /api/payment-methods.
     *
     * @param id    "pm_<epoch-ms>" generated by the handler before calling this
     * @param type  "Credit Card" | "Bank Transfer" | "PayPal" | "Interac e-Transfer"
     * @param label human-readable description built by the frontend form
     * @throws SQLException if the insert fails (e.g. duplicate id, DB down)
     */
    public PaymentMethod addMethod(String id, String type, String label)
            throws SQLException {

        // RETURNING lets us read the server-assigned created_at in one round-trip
        // instead of doing a separate SELECT after the INSERT.
        String sql = "INSERT INTO payment_methods (id, type, label) "
                   + "VALUES (?, ?, ?) "
                   + "RETURNING id, type, label, created_at";

        try (Connection        conn = Database.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            // Bind values to the ? placeholders — JDBC handles escaping
            stmt.setString(1, id);
            stmt.setString(2, type);
            stmt.setString(3, label);

            // executeQuery() returns the RETURNING result set (one row)
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return new PaymentMethod(
                        rs.getString("id"),
                        rs.getString("type"),
                        rs.getString("label"),
                        rs.getTimestamp("created_at").toInstant().toString()
                    );
                }
            }
        }
        throw new SQLException("INSERT INTO payment_methods returned no row.");
    }

    /**
     * Deletes the payment method with the given id.
     *
     * Called by DeletePaymentMethodHandler to satisfy DELETE /api/payment-methods/:id.
     *
     * @param  id  the "pm_<epoch-ms>" primary key to delete
     * @return true  if a row was deleted (id existed)
     *         false if no row matched (id did not exist — treated as success by
     *               the handler, which returns 204 either way)
     * @throws SQLException if the database is unreachable
     */
    public boolean deleteMethod(String id) throws SQLException {
        String sql = "DELETE FROM payment_methods WHERE id = ?";

        try (Connection        conn = Database.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setString(1, id);
            // executeUpdate() returns the number of rows affected
            return stmt.executeUpdate() > 0;
        }
    }
}
