package patterns;

// =============================================================================
// BookingStateMachine.java — GoF State Pattern
// =============================================================================
//
// WHAT IS THE STATE PATTERN?
//   Lets a Booking change its behaviour depending on its current state.
//   Instead of one big if/else chain, each state is its own class that knows
//   exactly what transitions it permits.
//
// BOOKING LIFECYCLE:
//
//   Requested ──► Confirmed ──► Pending Payment ──► Paid ──► Completed
//       │              │               │              │
//       └──► Rejected  └──► Cancelled  └──► Cancelled └──► Cancelled
//
// THIS FILE CONTAINS:
//   BookingStateMachine  (public)   – the Context; only public class → filename match
//   BookingState         (pkg-priv) – abstract base; all actions throw by default
//   RequestedState       (pkg-priv) – starting state of every new booking
//   ConfirmedState       (pkg-priv) – consultant accepted; waiting for payment
//   PendingPaymentState  (pkg-priv) – confirmed; waiting for client to pay
//   PaidState            (pkg-priv) – payment received; waiting for session
//   CompletedState       (pkg-priv) – terminal: session happened
//   RejectedState        (pkg-priv) – terminal: consultant declined
//   CancelledState       (pkg-priv) – terminal: cancelled at any stage
//
// Java rule: only ONE public class per file → the public class name matches
// the filename "BookingStateMachine.java".
// All state classes are package-private so they live here alongside the Context.
//
// Mirrors BookingStateMachine.js in the repository.
// =============================================================================

import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;

// =============================================================================
// BookingStateMachine — the Context (public; filename matches)
// =============================================================================
// Usage:
//   BookingStateMachine.transition("Requested", "Confirmed")  → "Confirmed"  ✅
//   BookingStateMachine.transition("Completed", "Cancelled")  → throws       ❌
//   BookingStateMachine.canTransition("Requested", "Paid")    → false        ✅
// =============================================================================
public class BookingStateMachine {

    // Maps each status string to its concrete state class constructor.
    private static final Map<String, Supplier<BookingState>> STATE_MAP = new HashMap<>();

    // Maps the TARGET status string to the action method name.
    private static final Map<String, String> STATUS_TO_ACTION = new HashMap<>();

    static {
        STATE_MAP.put("Requested",       RequestedState::new);
        STATE_MAP.put("Confirmed",       ConfirmedState::new);
        STATE_MAP.put("Pending Payment", PendingPaymentState::new);
        STATE_MAP.put("Paid",            PaidState::new);
        STATE_MAP.put("Completed",       CompletedState::new);
        STATE_MAP.put("Rejected",        RejectedState::new);
        STATE_MAP.put("Cancelled",       CancelledState::new);

        STATUS_TO_ACTION.put("Confirmed",       "confirm");
        STATUS_TO_ACTION.put("Rejected",        "reject");
        STATUS_TO_ACTION.put("Cancelled",       "cancel");
        STATUS_TO_ACTION.put("Pending Payment", "awaitPayment");
        STATUS_TO_ACTION.put("Paid",            "pay");
        STATUS_TO_ACTION.put("Completed",       "complete");
    }

    // Creates a state object for the given status string.
    // e.g. getStateObject("Requested") → new RequestedState()
    public static BookingState getStateObject(String statusString) {
        Supplier<BookingState> supplier = STATE_MAP.get(statusString);
        if (supplier == null) {
            throw new IllegalArgumentException("Unknown booking status: \"" + statusString + "\"");
        }
        return supplier.get();
    }

    // The main method used by ApiHandler.
    //
    // @param currentStatus – the booking's current status from in-memory store
    // @param nextStatus    – the status the caller wants to move to
    // @return              – the new status string (same as nextStatus if valid)
    // @throws IllegalStateException     if the transition is not allowed
    // @throws IllegalArgumentException  if either status string is unknown
    //
    // Example:
    //   transition("Requested", "Confirmed")  → "Confirmed"   ✅
    //   transition("Paid",      "Rejected")   → throws        ❌
    public static String transition(String currentStatus, String nextStatus) {
        // 1. Look up the action name for the target status
        String action = STATUS_TO_ACTION.get(nextStatus);
        if (action == null) {
            throw new IllegalArgumentException("Unknown target status: \"" + nextStatus + "\"");
        }

        // 2. Build the current state object (throws if currentStatus is unknown)
        BookingState currentState = getStateObject(currentStatus);

        // 3. Dispatch the action — throws IllegalStateException if invalid
        switch (action) {
            case "confirm":      return currentState.confirm();
            case "reject":       return currentState.reject();
            case "cancel":       return currentState.cancel();
            case "awaitPayment": return currentState.awaitPayment();
            case "pay":          return currentState.pay();
            case "complete":     return currentState.complete();
            default:
                throw new IllegalArgumentException("Unknown action: \"" + action + "\"");
        }
    }

    // Convenience method: returns true if the transition is valid, false if not.
    // Useful for validation without needing a try/catch at the call site.
    // Mirrors canTransition() in BookingStateMachine.js.
    public static boolean canTransition(String currentStatus, String nextStatus) {
        try {
            transition(currentStatus, nextStatus);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}

// =============================================================================
// BookingState — Abstract base state (package-private)
// =============================================================================
// Every concrete state MUST override getName().
// Only overrides the action methods valid for that state; all others
// inherit the error-throwing default below.
// =============================================================================
abstract class BookingState {

    // Returns the name of this state (e.g. "Requested"). Must be overridden.
    public abstract String getName();

    // Called when a consultant accepts the booking.
    public String confirm() {
        throw new IllegalStateException(
            "Invalid transition: cannot confirm a booking that is \"" + getName() + "\".");
    }

    // Called when a consultant rejects the booking.
    public String reject() {
        throw new IllegalStateException(
            "Invalid transition: cannot reject a booking that is \"" + getName() + "\".");
    }

    // Called when a client or consultant cancels the booking.
    public String cancel() {
        throw new IllegalStateException(
            "Invalid transition: cannot cancel a booking that is \"" + getName() + "\".");
    }

    // Called after confirmation — booking is awaiting payment from the client.
    public String awaitPayment() {
        throw new IllegalStateException(
            "Invalid transition: cannot move \"" + getName() + "\" to Pending Payment.");
    }

    // Called when the client successfully processes payment.
    public String pay() {
        throw new IllegalStateException(
            "Invalid transition: cannot pay for a booking that is \"" + getName() + "\".");
    }

    // Called when the consultant marks the session as done.
    public String complete() {
        throw new IllegalStateException(
            "Invalid transition: cannot complete a booking that is \"" + getName() + "\".");
    }
}

// =============================================================================
// RequestedState — Starting state of every new booking
// =============================================================================
// Valid transitions: confirm → Confirmed, reject → Rejected, cancel → Cancelled
// =============================================================================
class RequestedState extends BookingState {

    @Override public String getName() { return "Requested"; }

    @Override public String confirm() { return "Confirmed"; }
    @Override public String reject()  { return "Rejected";  }
    @Override public String cancel()  { return "Cancelled"; }
    // awaitPayment, pay, complete → inherit error from BookingState
}

// =============================================================================
// ConfirmedState — Consultant has accepted the booking
// =============================================================================
// Valid transitions: awaitPayment → Pending Payment, cancel → Cancelled
// =============================================================================
class ConfirmedState extends BookingState {

    @Override public String getName() { return "Confirmed"; }

    @Override public String awaitPayment() { return "Pending Payment"; }
    @Override public String cancel()       { return "Cancelled";       }
}

// =============================================================================
// PendingPaymentState — Booking confirmed; waiting for the client to pay
// =============================================================================
// Valid transitions: pay → Paid, cancel → Cancelled
// =============================================================================
class PendingPaymentState extends BookingState {

    @Override public String getName() { return "Pending Payment"; }

    @Override public String pay()    { return "Paid";      }
    @Override public String cancel() { return "Cancelled"; }
}

// =============================================================================
// PaidState — Payment has been received
// =============================================================================
// Valid transitions: complete → Completed, cancel → Cancelled (rare; refund in Phase 2)
// =============================================================================
class PaidState extends BookingState {

    @Override public String getName() { return "Paid"; }

    @Override public String complete() { return "Completed"; }
    @Override public String cancel()   { return "Cancelled"; }
}

// =============================================================================
// CompletedState — Session has taken place. TERMINAL STATE.
// =============================================================================
class CompletedState extends BookingState {

    @Override public String getName() { return "Completed"; }
    // No transitions overridden — all actions throw from BookingState.
}

// =============================================================================
// RejectedState — Consultant declined the booking. TERMINAL STATE.
// =============================================================================
class RejectedState extends BookingState {

    @Override public String getName() { return "Rejected"; }
    // No transitions overridden — all actions throw from BookingState.
}

// =============================================================================
// CancelledState — Booking was cancelled at any stage. TERMINAL STATE.
// =============================================================================
class CancelledState extends BookingState {

    @Override public String getName() { return "Cancelled"; }
    // No transitions overridden — all actions throw from BookingState.
}
