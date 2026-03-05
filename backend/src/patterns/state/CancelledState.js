// =============================================================================
// CancelledState.js — Booking was cancelled. TERMINAL STATE.
// =============================================================================
//
// This is a terminal state — once a booking is Cancelled, it is done.
// It can be reached from multiple points in the lifecycle:
//   - Requested  → Cancelled (before consultant responds)
//   - Confirmed  → Cancelled
//   - Pending Payment → Cancelled (client backs out before paying)
//   - Paid       → Cancelled (rare — would require a refund)
//
// =============================================================================

const BookingState = require("./BookingState");

class CancelledState extends BookingState {
  getName() {
    return "Cancelled";
  }

  // No transitions overridden — this state is final.
}

module.exports = CancelledState;
