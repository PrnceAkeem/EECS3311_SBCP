package patterns;

// =============================================================================
// SystemPolicyManager.java — GoF Singleton Pattern
// =============================================================================
//
// WHAT IS THE SINGLETON PATTERN?
//   Ensures a class has only one instance and provides a global access point
//   to it. The private constructor and static getInstance() enforce this.
//
// HOW IT WORKS HERE:
//   - SystemPolicyManager holds platform-wide policies (cancellation window,
//     refund policy) that apply uniformly across all bookings.
//   - Server.java uses getInstance() at startup to demonstrate the pattern.
//   - Admin users call setCancellationWindowHours() and setRefundPolicy()
//     through the service layer (UC12: Define System Policies).
//
// Public because Server.java calls SystemPolicyManager.getInstance().
// Must be in its own file (Java: one public class per file).
// =============================================================================
public class SystemPolicyManager {

    // ── Singleton boilerplate ─────────────────────────────────────────────────

    // The one and only instance. Null until first call to getInstance().
    private static SystemPolicyManager instance;

    // Private constructor prevents any external instantiation.
    private SystemPolicyManager() {
        // Default policies active at platform launch.
        this.cancellationWindowHours = 24;
        this.refundPolicy            = "Full refund if cancelled within 24 hours of booking.";
    }

    // Global access point. Lazy-initialises on first call.
    // Thread-safety note: add synchronized or use a holder class for multi-threaded Phase 2.
    public static SystemPolicyManager getInstance() {
        if (instance == null) {
            instance = new SystemPolicyManager();
        }
        return instance;
    }

    // ── Policy fields ─────────────────────────────────────────────────────────

    // How many hours after booking creation a client may cancel for free.
    private int    cancellationWindowHours;

    // Human-readable description of the refund policy shown to users.
    private String refundPolicy;

    // ── Getters ───────────────────────────────────────────────────────────────

    public int getCancellationWindowHours() {
        return cancellationWindowHours;
    }

    public String getRefundPolicy() {
        return refundPolicy;
    }

    // ── Setters (called by Admin via UC12: Define System Policies) ────────────

    public void setCancellationWindowHours(int hours) {
        if (hours < 0) {
            throw new IllegalArgumentException("Cancellation window cannot be negative.");
        }
        this.cancellationWindowHours = hours;
    }

    public void setRefundPolicy(String policy) {
        if (policy == null || policy.isBlank()) {
            throw new IllegalArgumentException("Refund policy cannot be empty.");
        }
        this.refundPolicy = policy;
    }

    @Override
    public String toString() {
        return "SystemPolicyManager { cancellationWindowHours=" + cancellationWindowHours
             + ", refundPolicy='" + refundPolicy + "' }";
    }
}
