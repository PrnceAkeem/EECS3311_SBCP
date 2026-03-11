// =============================================================================
// BookingState.js — GoF State Pattern: Base State Class
// =============================================================================
//
// WHAT IS THE STATE PATTERN?
//   The State Pattern lets an object (here: a Booking) change its behaviour
//   depending on its current state. Instead of one big if/else chain like:
//
//     if (status === "Requested") { ... }
//     else if (status === "Confirmed") { ... }
//
//   ...each state is its own class that knows exactly what it can and cannot do.
//
// HOW IT WORKS HERE:
//   - BookingState is the BASE class. It defines every possible action a booking
//     can receive (confirm, reject, cancel, pay, complete).
//   - By default, every action throws an error — "you can't do that from here."
//   - Each CONCRETE state (e.g. RequestedState, ConfirmedState) extends this
//     class and only overrides the actions it actually allows.
//
// BOOKING LIFECYCLE:
//
//   Requested ──► Confirmed ──► Pending Payment ──► Paid ──► Completed
//       │              │               │              │
//       └──► Rejected  └──► Cancelled  └──► Cancelled └──► Cancelled
//
// =============================================================================

class BookingState {
  // Returns the name of this state as a string (e.g. "Requested").
  // Every subclass MUST override this — it is used to save to the database.
  getName() {
    throw new Error("getName() must be implemented by each state subclass.");
  }

  // --- Actions ---
  // Each method below represents something that can happen to a booking.
  // The default behaviour for ALL of them is: throw an error.
  // Subclasses override only the ones that are valid for their state.

  // Called when a consultant accepts the booking.
  confirm() {
    throw new Error(
      `Invalid transition: cannot confirm a booking that is "${this.getName()}".`
    );
  }

  // Called when a consultant rejects the booking.
  reject() {
    throw new Error(
      `Invalid transition: cannot reject a booking that is "${this.getName()}".`
    );
  }

  // Called when a client or consultant cancels the booking.
  cancel() {
    throw new Error(
      `Invalid transition: cannot cancel a booking that is "${this.getName()}".`
    );
  }

  // Called after confirmation — booking is awaiting payment from the client.
  awaitPayment() {
    throw new Error(
      `Invalid transition: cannot move "${this.getName()}" to Pending Payment.`
    );
  }

  // Called when the client successfully processes payment.
  pay() {
    throw new Error(
      `Invalid transition: cannot pay for a booking that is "${this.getName()}".`
    );
  }

  // Called when the consultant marks the session as done.
  complete() {
    throw new Error(
      `Invalid transition: cannot complete a booking that is "${this.getName()}".`
    );
  }
}

module.exports = BookingState;
