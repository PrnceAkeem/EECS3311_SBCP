// =============================================================================
// RejectedState.js — Consultant declined the booking. TERMINAL STATE.
// =============================================================================
//
// This is a terminal state — once a booking is Rejected by the consultant,
// it cannot be changed to anything else. The client would need to submit
// a brand new booking request.
//
// =============================================================================

const BookingState = require("./BookingState");

class RejectedState extends BookingState {
  getName() {
    return "Rejected";
  }

  // No transitions overridden — this state is final.
}

module.exports = RejectedState;
