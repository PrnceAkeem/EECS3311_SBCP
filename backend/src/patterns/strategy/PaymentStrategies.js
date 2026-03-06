// Strategy Pattern — Payment Processing
//
// How it fits in:
// - server.js calls PaymentStrategyFactory.create(methodType) when a booking
//   moves to "Paid" status.
// - The factory returns the right concrete strategy for the payment type.
// - The strategy's process() validates the details and returns a transaction ID.
// - server.js includes that transaction ID in the PATCH response so the frontend
//   can display it to the client.
//
// Supported types (must match frontend dropdowns + ALLOWED_METHOD_TYPES in server.js):
//   Credit Card, Debit Card, Bank Transfer, PayPal

// ---------------------------------------------------------------------------
// Base strategy — all concrete strategies extend this
// ---------------------------------------------------------------------------
class PaymentStrategy {
  process(_amount, _details) {
    throw new Error("process() must be implemented by a concrete strategy.");
  }

  validate(_details) {
    return true;
  }

  // Generates a unique simulated transaction ID with a type prefix.
  // e.g. CC-1234567890-ABC123
  buildTransactionId(prefix) {
    const timePart   = Date.now().toString().slice(-6);
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${timePart}-${randomPart}`;
  }
}

// ---------------------------------------------------------------------------
// Credit Card — requires a saved method with type "Credit Card"
// ---------------------------------------------------------------------------
class CreditCardPayment extends PaymentStrategy {
  validate(details) {
    return Boolean(details && details.methodId && details.methodType === "Credit Card");
  }

  process(amount, details) {
    if (!this.validate(details)) {
      return { success: false, message: "Invalid credit card payment data." };
    }
    return {
      success: true,
      transactionId: this.buildTransactionId("CC"),
      message: `Credit card payment accepted for $${amount}.`
    };
  }
}

// ---------------------------------------------------------------------------
// Debit Card — same validation shape as Credit Card, different prefix
// ---------------------------------------------------------------------------
class DebitCardPayment extends PaymentStrategy {
  validate(details) {
    return Boolean(details && details.methodId && details.methodType === "Debit Card");
  }

  process(amount, details) {
    if (!this.validate(details)) {
      return { success: false, message: "Invalid debit card payment data." };
    }
    return {
      success: true,
      transactionId: this.buildTransactionId("DC"),
      message: `Debit card payment accepted for $${amount}.`
    };
  }
}

// ---------------------------------------------------------------------------
// Bank Transfer — initiated as a transfer, slightly longer simulated delay
// ---------------------------------------------------------------------------
class BankTransferPayment extends PaymentStrategy {
  validate(details) {
    return Boolean(details && details.methodId && details.methodType === "Bank Transfer");
  }

  process(amount, details) {
    if (!this.validate(details)) {
      return { success: false, message: "Invalid bank transfer payment data." };
    }
    return {
      success: true,
      transactionId: this.buildTransactionId("BT"),
      message: `Bank transfer initiated for $${amount}.`
    };
  }
}

// ---------------------------------------------------------------------------
// PayPal — requires a saved PayPal method (email-based)
// ---------------------------------------------------------------------------
class PayPalPayment extends PaymentStrategy {
  validate(details) {
    return Boolean(details && details.methodId && details.methodType === "PayPal");
  }

  process(amount, details) {
    if (!this.validate(details)) {
      return { success: false, message: "Invalid PayPal payment data." };
    }
    return {
      success: true,
      transactionId: this.buildTransactionId("PP"),
      message: `PayPal payment accepted for $${amount}.`
    };
  }
}

// ---------------------------------------------------------------------------
// Factory — picks the right strategy based on payment method type string
// ---------------------------------------------------------------------------
class PaymentStrategyFactory {
  static create(methodType) {
    if (methodType === "Credit Card")   return new CreditCardPayment();
    if (methodType === "Debit Card")    return new DebitCardPayment();
    if (methodType === "Bank Transfer") return new BankTransferPayment();
    if (methodType === "PayPal")        return new PayPalPayment();
    throw new Error(`Unsupported payment method type: ${methodType}`);
  }
}

module.exports = {
  PaymentStrategyFactory,
  CreditCardPayment,
  DebitCardPayment,
  BankTransferPayment,
  PayPalPayment
};
