// =============================================================================
// PendingPaymentState.js — Booking is confirmed, waiting for payment
// =============================================================================
//
// The consultant said yes. Now the client needs to pay before the session
// can be locked in. This is where the payment strategy (another GoF pattern)
// will be invoked in Phase 2.
//
// Valid transitions:
//   - PAY    → moves to PaidState     (client successfully pays)
//   - CANCEL → moves to CancelledState (client backs out before paying)
//
// =============================================================================

const BookingState = require("./BookingState");

class PendingPaymentState extends BookingState {
  getName() {
    return "Pending Payment";
  }

  // Client processes payment successfully → move to Paid
  pay() {
    return "Paid";
  }

  // Client cancels before paying (no charge)
  cancel() {
    return "Cancelled";
  }
}

module.exports = PendingPaymentState;
