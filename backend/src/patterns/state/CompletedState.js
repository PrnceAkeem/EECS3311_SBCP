// =============================================================================
// CompletedState.js — The session has taken place. TERMINAL STATE.
// =============================================================================
//
// This is a terminal state — once a booking is Completed, it cannot be
// changed to anything else. There is no going back.
//
// No methods are overridden here, so every action throws the error defined
// in the BookingState base class: "Invalid transition: cannot X a booking
// that is Completed."
//
// =============================================================================

const BookingState = require("./BookingState");

class CompletedState extends BookingState {
  getName() {
    return "Completed";
  }

  // No transitions overridden — this state is final.
  // All actions will throw "Invalid transition" errors from the base class.
}

module.exports = CompletedState;
