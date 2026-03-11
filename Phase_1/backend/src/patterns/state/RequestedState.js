// =============================================================================
// RequestedState.js — The starting state of every new booking
// =============================================================================
//
// A booking enters this state the moment a client submits it.
// From here, the consultant can:
//   - CONFIRM it  → moves to ConfirmedState
//   - REJECT it   → moves to RejectedState  (terminal — no going back)
//   - CANCEL it   → moves to CancelledState (terminal — no going back)
//
// =============================================================================

const BookingState = require("./BookingState");

class RequestedState extends BookingState {
  getName() {
    return "Requested";
  }

  // Consultant accepts the booking → move to Confirmed
  confirm() {
    return "Confirmed";
  }

  // Consultant declines the booking → move to Rejected
  reject() {
    return "Rejected";
  }

  // Client or consultant calls it off before it is confirmed → move to Cancelled
  cancel() {
    return "Cancelled";
  }

  // All other actions (awaitPayment, pay, complete) are NOT overridden,
  // so they inherit the error-throwing behaviour from BookingState.
}

module.exports = RequestedState;
