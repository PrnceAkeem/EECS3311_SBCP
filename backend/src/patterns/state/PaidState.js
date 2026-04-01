// =============================================================================
// PaidState.js — Payment has been received
// =============================================================================
//
// The client has paid. The session is fully locked in and just needs to happen.
// After the session takes place, the consultant marks it as Completed.
// Cancellation at this stage would normally trigger a refund (handled in Phase 2).
//
// Valid transitions:
//   - COMPLETE → moves to CompletedState  (session happened successfully)
//   - CANCEL   → moves to CancelledState  (rare — would trigger refund logic)
//
// =============================================================================

const BookingState = require("./BookingState");

class PaidState extends BookingState {
  getName() {
    return "Paid";
  }

  // Consultant marks the session as done after it takes place
  complete() {
    return "Completed";
  }

  // Edge case: cancellation after payment (refund flow — Phase 2)
  cancel() {
    return "Cancelled";
  }
}

module.exports = PaidState;
