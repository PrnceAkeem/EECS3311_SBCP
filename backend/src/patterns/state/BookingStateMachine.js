// =============================================================================
// BookingStateMachine.js — GoF State Pattern: The Context
// =============================================================================
//
// In the State Pattern, the "Context" is the object that:
//   1. Holds a reference to the current state object
//   2. Delegates actions to that state object
//   3. Swaps in a new state object when a transition happens
//
// This class is what the rest of the app actually uses. You call:
//
//   BookingStateMachine.transition("Requested", "Confirmed")
//     → returns "Confirmed"  ✅ valid
//
//   BookingStateMachine.transition("Completed", "Cancelled")
//     → throws an error      ❌ invalid — Completed is terminal
//
// HOW IT WORKS:
//   - STATUS_TO_ACTION maps the TARGET status to the method name on the
//     state object. (e.g. "Confirmed" → call .confirm() on current state)
//   - getStateObject() creates the right state class for a given status string.
//   - transition() looks up the current state, calls the right action, and
//     returns the resulting next status string.
//
// =============================================================================

const RequestedState      = require("./RequestedState");
const ConfirmedState      = require("./ConfirmedState");
const PendingPaymentState = require("./PendingPaymentState");
const PaidState           = require("./PaidState");
const CompletedState      = require("./CompletedState");
const RejectedState       = require("./RejectedState");
const CancelledState      = require("./CancelledState");

// Maps each status string (from the database) to its state class.
// This is how we turn a plain string like "Requested" into a real state object.
const STATE_MAP = {
  "Requested":       RequestedState,
  "Confirmed":       ConfirmedState,
  "Pending Payment": PendingPaymentState,
  "Paid":            PaidState,
  "Completed":       CompletedState,
  "Rejected":        RejectedState,
  "Cancelled":       CancelledState
};

// Maps the TARGET status to the action method we need to call on the
// current state. This is the bridge between "what the client sends us"
// and "which method we call on the state object."
const STATUS_TO_ACTION = {
  "Confirmed":       "confirm",
  "Rejected":        "reject",
  "Cancelled":       "cancel",
  "Pending Payment": "awaitPayment",
  "Paid":            "pay",
  "Completed":       "complete"
};

class BookingStateMachine {
  // Creates a state object for the given status string.
  // e.g. getStateObject("Requested") → new RequestedState()
  static getStateObject(statusString) {
    const StateClass = STATE_MAP[statusString];
    if (!StateClass) {
      throw new Error(`Unknown booking status: "${statusString}"`);
    }
    return new StateClass();
  }

  // The main method used by the API.
  //
  // @param {string} currentStatus - The booking's current status from the DB
  // @param {string} nextStatus    - The status the caller wants to move to
  // @returns {string}             - The new status (same as nextStatus if valid)
  // @throws {Error}               - If the transition is not allowed
  //
  // Example:
  //   transition("Requested", "Confirmed")  → "Confirmed"   ✅
  //   transition("Paid", "Rejected")        → throws Error  ❌
  static transition(currentStatus, nextStatus) {
    // 1. Look up the action name for the target status
    const action = STATUS_TO_ACTION[nextStatus];
    if (!action) {
      throw new Error(`Unknown target status: "${nextStatus}"`);
    }

    // 2. Build the current state object
    const currentState = BookingStateMachine.getStateObject(currentStatus);

    // 3. Call the action on the current state.
    //    If the transition is invalid, the state's method throws an error.
    //    If it's valid, it returns the next status string.
    const resultStatus = currentState[action]();

    return resultStatus;
  }

  // Convenience method: returns true if the transition is valid, false if not.
  // Useful for UI validation without needing a try/catch.
  static canTransition(currentStatus, nextStatus) {
    try {
      BookingStateMachine.transition(currentStatus, nextStatus);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = BookingStateMachine;
