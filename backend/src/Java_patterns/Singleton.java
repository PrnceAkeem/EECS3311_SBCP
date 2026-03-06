package patterns;

// =============================================================================
// Singleton.java — GoF Singleton Pattern (System Policy Manager)
// =============================================================================
//
// WHAT IS THE SINGLETON PATTERN?
//   Ensures a class has only one instance and provides a global access point
//   to it. The private constructor and static getInstance() enforce this.
//
// HOW IT WORKS HERE:
//   - SystemPolicyManager holds platform-wide policies (cancellation window,
//     refund policy) that apply uniformly across all bookings.
//   - server.js uses getInstance() whenever it needs to read or write policies.
//   - Admin users call setCancellationWindowHours() and setRefundPolicy()
//     through the service layer (UC12: Define System Policies).
//   - BookingService and ConsultantService read policies via getInstance()
//     without needing the object passed in as a dependency.
//
// CLASSES IN THIS FILE:
//   SystemPolicyManager – the single Singleton class
//
// =============================================================================

// =============================================================================
// SystemPolicyManager — Platform-wide policy store (Singleton)
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

    // Returns the current cancellation window in hrs
    // Used by booking services to determine if cancellation is allowed.
    public int getCancellationWindowHours() {
        return cancellationWindowHours;
    }
    //Returns the current refund policy text
    public String getRefundPolicy() {
        return refundPolicy;
    }

    // ── Setters (called by Admin via UC12: Define System Policies) ────────────

     //Updates the cancellation window policy
    //Admins will be able to change how many hours a client has to cancel for free.

    public void setCancellationWindowHours(int hours) {
        if (hours < 0) {
            throw new IllegalArgumentException("Cancellation window cannot be negative.");
        }
        this.cancellationWindowHours = hours;
    }

     //Updates the platform refund policy text
    //Admins use this to define the refund rules displayed to users.
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
