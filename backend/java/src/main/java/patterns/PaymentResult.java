package patterns;

// =============================================================================
// PaymentResult.java — Return value of PaymentStrategy.process()
// =============================================================================
//
// Maps to the plain object returned by process() in strategy.js:
//   { success, transactionId, message }
//
// Public because ApiHandler reads result.success, result.transactionId,
// and result.message when building the JSON response for PATCH /api/bookings/:id/status.
//
// Must be in its own file (Java: one public class per file).
// =============================================================================
public class PaymentResult {

    public final boolean success;
    public final String  transactionId;  // null when success = false
    public final String  message;

    public PaymentResult(boolean success, String transactionId, String message) {
        this.success       = success;
        this.transactionId = transactionId;
        this.message       = message;
    }

    @Override
    public String toString() {
        return "PaymentResult{success=" + success
             + ", transactionId=" + transactionId
             + ", message=" + message + "}";
    }
}
