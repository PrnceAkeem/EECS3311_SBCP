// Strategy pattern:
// - server.js asks PaymentStrategyFactory for a strategy using method type.
// - the selected strategy validates payment details and returns a transaction id.
// - server.js then includes that id in PATCH /api/bookings/:id/status response.
class PaymentStrategy {
  process(_amount, _details) {
    throw new Error("process() must be implemented by a concrete strategy.");
  }

  validate(_details) {
    return true;
  }

  buildTransactionId(prefix) {
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    const timePart = Date.now().toString().slice(-6);
    return `${prefix}-${timePart}-${randomPart}`;
  }
}

class CreditCardPayment extends PaymentStrategy {
  process(amount, details) {
    if (!this.validate(details)) {
      return { success: false, message: "Invalid credit card payment data." };
    }

    return {
      success: true,
      transactionId: this.buildTransactionId("CC"),
      message: `Credit card payment accepted for ${amount}.`
    };
  }

  validate(details) {
    return Boolean(details && details.methodId && details.methodType === "Credit Card");
  }
}

class BankTransferPayment extends PaymentStrategy {
  process(amount, details) {
    if (!this.validate(details)) {
      return { success: false, message: "Invalid bank transfer payment data." };
    }

    return {
      success: true,
      transactionId: this.buildTransactionId("BT"),
      message: `Bank transfer initiated for ${amount}.`
    };
  }

  validate(details) {
    return Boolean(details && details.methodId && details.methodType === "Bank Transfer");
  }
}

class PayPalPayment extends PaymentStrategy {
  process(amount, details) {
    if (!this.validate(details)) {
      return { success: false, message: "Invalid PayPal payment data." };
    }

    return {
      success: true,
      transactionId: this.buildTransactionId("PP"),
      message: `PayPal payment accepted for ${amount}.`
    };
  }

  validate(details) {
    return Boolean(details && details.methodId && details.methodType === "PayPal");
  }
}

class InteracETransferPayment extends PaymentStrategy {
  process(amount, details) {
    if (!this.validate(details)) {
      return { success: false, message: "Invalid Interac e-Transfer payment data." };
    }

    return {
      success: true,
      transactionId: this.buildTransactionId("IT"),
      message: `Interac e-Transfer submitted for ${amount}.`
    };
  }

  validate(details) {
    return Boolean(details && details.methodId && details.methodType === "Interac e-Transfer");
  }
}

class PaymentStrategyFactory {
  static create(methodType) {
    if (methodType === "Credit Card") {
      return new CreditCardPayment();
    }
    if (methodType === "Bank Transfer") {
      return new BankTransferPayment();
    }
    if (methodType === "PayPal") {
      return new PayPalPayment();
    }
    if (methodType === "Interac e-Transfer") {
      return new InteracETransferPayment();
    }
    throw new Error(`Unsupported payment method type: ${methodType}`);
  }
}

module.exports = {
  PaymentStrategyFactory,
  CreditCardPayment,
  BankTransferPayment,
  PayPalPayment,
  InteracETransferPayment
};
