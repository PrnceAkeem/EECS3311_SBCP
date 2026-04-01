// Strategy Pattern — Payment Processing
//
// How it fits in:
// - server.js calls PaymentStrategyFactory.create(methodType) when a booking
//   moves to "Paid" status.
// - The factory returns the right concrete strategy for the payment type.
// - The strategy validates method-specific details and returns a transaction ID.

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isFutureExpiry(expiryText) {
  const match = String(expiryText || "").trim().match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
  if (!match) {
    return false;
  }

  const expiryMonth = Number(match[1]);
  const expiryYear = 2000 + Number(match[2]);
  const expiryDate = new Date(expiryYear, expiryMonth, 0, 23, 59, 59, 999);
  return expiryDate.getTime() >= Date.now();
}

class PaymentStrategy {
  process(_amount, _details) {
    throw new Error("process() must be implemented by a concrete strategy.");
  }

  validate(_details) {
    return true;
  }

  buildTransactionId(prefix) {
    const timePart = Date.now().toString().slice(-6);
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${timePart}-${randomPart}`;
  }
}

class CreditCardPayment extends PaymentStrategy {
  validate(details) {
    const methodDetails = details?.details || {};
    const cardNumber = String(methodDetails.cardNumber || "").replace(/\D/g, "");
    const cvv = String(methodDetails.cvv || "").replace(/\D/g, "");
    return Boolean(
      details &&
      details.methodId &&
      details.methodType === "Credit Card" &&
      /^\d{16}$/.test(cardNumber) &&
      isFutureExpiry(methodDetails.expiry) &&
      /^\d{3,4}$/.test(cvv)
    );
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

class DebitCardPayment extends PaymentStrategy {
  validate(details) {
    const methodDetails = details?.details || {};
    const cardNumber = String(methodDetails.cardNumber || "").replace(/\D/g, "");
    const cvv = String(methodDetails.cvv || "").replace(/\D/g, "");
    return Boolean(
      details &&
      details.methodId &&
      details.methodType === "Debit Card" &&
      /^\d{16}$/.test(cardNumber) &&
      isFutureExpiry(methodDetails.expiry) &&
      /^\d{3,4}$/.test(cvv)
    );
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

class BankTransferPayment extends PaymentStrategy {
  validate(details) {
    const methodDetails = details?.details || {};
    const accountNumber = String(methodDetails.accountNumber || "").replace(/\D/g, "");
    const routingNumber = String(methodDetails.routingNumber || "").replace(/\D/g, "");
    return Boolean(
      details &&
      details.methodId &&
      details.methodType === "Bank Transfer" &&
      /^\d{6,17}$/.test(accountNumber) &&
      /^\d{9}$/.test(routingNumber)
    );
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

class PayPalPayment extends PaymentStrategy {
  validate(details) {
    const methodDetails = details?.details || {};
    return Boolean(
      details &&
      details.methodId &&
      details.methodType === "PayPal" &&
      isValidEmail(methodDetails.paypalEmail)
    );
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

class PaymentStrategyFactory {
  static create(methodType) {
    if (methodType === "Credit Card") return new CreditCardPayment();
    if (methodType === "Debit Card") return new DebitCardPayment();
    if (methodType === "Bank Transfer") return new BankTransferPayment();
    if (methodType === "PayPal") return new PayPalPayment();
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
