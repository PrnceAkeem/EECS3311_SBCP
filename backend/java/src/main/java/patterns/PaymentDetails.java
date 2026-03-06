package patterns;

// =============================================================================
// PaymentDetails.java — Input data for PaymentStrategy.process() / validate()
// =============================================================================
//
// Mirrors the plain JS object passed to strategy.process() in strategy.js:
//   { methodId, methodType }
//
// Public because ApiHandler reads the PATCH request body, constructs a
// PaymentDetails object, and passes it to PaymentStrategyFactory.create().
//
// Must be in its own file (Java: one public class per file).
// =============================================================================
public class PaymentDetails {

    // ID of the saved payment method (e.g. "pm_1709692400000")
    public final String methodId;

    // "Credit Card" | "Bank Transfer" | "PayPal" | "Interac e-Transfer"
    public final String methodType;

    public PaymentDetails(String methodId, String methodType) {
        this.methodId   = methodId;
        this.methodType = methodType;
    }
}
