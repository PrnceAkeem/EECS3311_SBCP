package patterns;

// =============================================================================
// State.java — GoF State Pattern
// =============================================================================
//
// WHAT IS THE STATE PATTERN?
//   Lets a Booking change its behaviour depending on its current state.
//   Instead of one big if/else chain, each state is its own class that
//   knows exactly what it can and cannot do.
//
// BOOKING LIFECYCLE:
//
//   Requested ──► Confirmed ──► Pending Payment ──► Paid ──► Completed
//       │              │               │              │
//       └──► Rejected  └──► Cancelled  └──► Cancelled └──► Cancelled
//
// CLASSES IN THIS FILE:
//   BookingState          – abstract base class (all actions throw by default)
//   BookingStateMachine   – the Context; delegates to current state object
//   RequestedState        – starting state of every new booking
//   ConfirmedState        – consultant accepted; awaiting payment
//   PendingPaymentState   – confirmed, waiting for client to pay
//   PaidState             – payment received; awaiting session completion
//   CompletedState        – terminal: session happened successfully
//   RejectedState         – terminal: consultant declined
//   CancelledState        – terminal: cancelled at any stage
//
// =============================================================================

import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;

// =============================================================================
// BookingState — Base State Class
// =============================================================================
// Every subclass MUST override getName().
// Only overrides the action methods that are valid for that state.
// All others inherit the error-throwing default below.
// Mirrors BookingState.js in the repository.
// =============================================================================
abstract class BookingState {

    // Returns the name of this state as a string (e.g. "Requested").
    // Used to persist status to the database. Must be overridden.
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
// BookingStateMachine — the Context
// =============================================================================
// The main class the rest of the app uses. Mirrors BookingStateMachine.js.
//
// Usage:
//   BookingStateMachine.transition("Requested", "Confirmed")  → "Confirmed"  ✅
//   BookingStateMachine.transition("Completed", "Cancelled")  → throws       ❌
// =============================================================================
public class BookingStateMachine {

    // Maps each status string to its concrete state class constructor.
    private static final Map<String, Supplier<BookingState>> STATE_MAP = new HashMap<>();

    // Maps the TARGET status to the action method name.
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

    // The main method used by the API.
    //
    // @param currentStatus – the booking's current status from the DB
    // @param nextStatus    – the status the caller wants to move to
    // @return              – the new status string (same as nextStatus if valid)
    // @throws              – IllegalStateException if the transition is not allowed
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

        // 2. Build the current state object
        BookingState currentState = getStateObject(currentStatus);

        // 3. Dispatch the action — throws if invalid, returns next status if valid
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
// RequestedState — The starting state of every new booking
// =============================================================================
// Valid transitions:
//   confirm() → "Confirmed"
//   reject()  → "Rejected"
//   cancel()  → "Cancelled"
// Mirrors RequestedState.js
// =============================================================================
class RequestedState extends BookingState {

    @Override
    public String getName() { return "Requested"; }

    // Consultant accepts the booking → move to Confirmed
    @Override
    public String confirm() { return "Confirmed"; }

    // Consultant declines the booking → move to Rejected
    @Override
    public String reject() { return "Rejected"; }

    // Client or consultant calls it off before confirmation → move to Cancelled
    @Override
    public String cancel() { return "Cancelled"; }

    // awaitPayment, pay, complete not overridden → inherit error from BookingState
}

// =============================================================================
// ConfirmedState — Consultant has accepted the booking
// =============================================================================
// Valid transitions:
//   awaitPayment() → "Pending Payment"
//   cancel()       → "Cancelled"
// Mirrors ConfirmedState.js
// =============================================================================
class ConfirmedState extends BookingState {

    @Override
    public String getName() { return "Confirmed"; }

    // Booking confirmed — now waiting for the client to pay
    @Override
    public String awaitPayment() { return "Pending Payment"; }

    // Still cancellable at this stage
    @Override
    public String cancel() { return "Cancelled"; }
}

// =============================================================================
// PendingPaymentState — Booking is confirmed, waiting for payment
// =============================================================================
// Valid transitions:
//   pay()    → "Paid"
//   cancel() → "Cancelled"
// Mirrors PendingPaymentState.js
// =============================================================================
class PendingPaymentState extends BookingState {

    @Override
    public String getName() { return "Pending Payment"; }

    // Client processes payment successfully → move to Paid
    @Override
    public String pay() { return "Paid"; }

    // Client cancels before paying (no charge)
    @Override
    public String cancel() { return "Cancelled"; }
}

// =============================================================================
// PaidState — Payment has been received
// =============================================================================
// Valid transitions:
//   complete() → "Completed"
//   cancel()   → "Cancelled" (rare — would trigger refund logic in Phase 2)
// Mirrors PaidState.js
// =============================================================================
class PaidState extends BookingState {

    @Override
    public String getName() { return "Paid"; }

    // Consultant marks the session as done after it takes place
    @Override
    public String complete() { return "Completed"; }

    // Edge case: cancellation after payment (refund flow — Phase 2)
    @Override
    public String cancel() { return "Cancelled"; }
}

// =============================================================================
// CompletedState — The session has taken place. TERMINAL STATE.
// =============================================================================
// No transitions overridden — all actions throw from the base class.
// Mirrors CompletedState.js
// =============================================================================
class CompletedState extends BookingState {

    @Override
    public String getName() { return "Completed"; }

    // No transitions overridden — this state is final.
}

// =============================================================================
// RejectedState — Consultant declined the booking. TERMINAL STATE.
// =============================================================================
// No transitions overridden — all actions throw from the base class.
// Mirrors RejectedState.js
// =============================================================================
class RejectedState extends BookingState {

    @Override
    public String getName() { return "Rejected"; }

    // No transitions overridden — this state is final.
}

// =============================================================================
// CancelledState — Booking was cancelled. TERMINAL STATE.
// =============================================================================
// Reachable from Requested, Confirmed, Pending Payment, or Paid.
// No transitions overridden — all actions throw from the base class.
// Mirrors CancelledState.js
// =============================================================================
class CancelledState extends BookingState {

    @Override
    public String getName() { return "Cancelled"; }

    // No transitions overridden — this state is final.
}
