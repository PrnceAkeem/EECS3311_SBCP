// =============================================================================
// ConfirmedState.js — Consultant has accepted the booking
// =============================================================================
//
// The booking is confirmed. Next, the system moves it to "Pending Payment"
// so the client knows they need to pay before the session happens.
// It can also still be cancelled at this stage.
//
// Valid transitions:
//   - AWAIT PAYMENT → moves to PendingPaymentState
//   - CANCEL        → moves to CancelledState
//
// =============================================================================

const BookingState = require("./BookingState");

class ConfirmedState extends BookingState {
  getName() {
    return "Confirmed";
  }

  // Booking confirmed — now waiting for the client to pay
  awaitPayment() {
    return "Pending Payment";
  }

  // Still cancellable at this stage
  cancel() {
    return "Cancelled";
  }
}

module.exports = ConfirmedState;
