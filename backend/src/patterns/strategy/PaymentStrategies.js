// Strategy Pattern — Payment Processing
//
// How it fits in:
// - server.js calls PaymentStrategyFactory.create(methodType) when a booking
//   moves to "Paid" status.
// - The factory returns the right concrete strategy for the payment type.
// - The strategy validates method-specific details and returns a transaction ID.

// Validates if a string is in proper email format
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

// Checks if a credit/debit card expiry date is valid and in the future
function isFutureExpiry(expiryText) {
  // Match format MM/YY (e.g., 05/27)
  const match = String(expiryText || "").trim().match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
  if (!match) {
    return false; // Invalid format
  }

  // Extract month and convert year to full year (e.g., 27 → 2027)
  const expiryMonth = Number(match[1]);
  const expiryYear = 2000 + Number(match[2]);

  // Set expiry date to the last moment of that month
  const expiryDate = new Date(expiryYear, expiryMonth, 0, 23, 59, 59, 999);

  // Check if expiry date is in the future
  return expiryDate.getTime() >= Date.now();
}

// Base Strategy class (parent class for all payment methods)
class PaymentStrategy {
  // This method must be overridden by subclasses
  process(_amount, _details) {
    throw new Error("process() must be implemented by a concrete strategy.");
  }

  // Default validation (can be overridden by subclasses)
  validate(_details) {
    return true;
  }

  // Generates a unique transaction ID using a prefix + timestamp + random string
  buildTransactionId(prefix) {
    const timePart = Date.now().toString().slice(-6);
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${timePart}-${randomPart}`;
  }
}

// Concrete Strategy for Credit Card payments
class CreditCardPayment extends PaymentStrategy {
  // Validates credit card details
  validate(details) {
    const methodDetails = details?.details || {};
    const cardNumber = String(methodDetails.cardNumber || "").replace(/\D/g, ""); // remove non-digits
    const cvv = String(methodDetails.cvv || "").replace(/\D/g, "");

    return Boolean(
      details &&
      details.methodId &&
      details.methodType === "Credit Card" &&
      /^\d{16}$/.test(cardNumber) && // must be 16 digits
      isFutureExpiry(methodDetails.expiry) && // expiry must be valid and in future
      /^\d{3,4}$/.test(cvv) // CVV must be 3 or 4 digits
    );
  }

  // Processes credit card payment
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

// Concrete Strategy for Debit Card payments
class DebitCardPayment extends PaymentStrategy {
  // Validates debit card details (same logic as credit card)
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

  // Processes debit card payment
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

// Concrete Strategy for Bank Transfer payments
class BankTransferPayment extends PaymentStrategy {
  // Validates bank account and routing numbers
  validate(details) {
    const methodDetails = details?.details || {};
    const accountNumber = String(methodDetails.accountNumber || "").replace(/\D/g, "");
    const routingNumber = String(methodDetails.routingNumber || "").replace(/\D/g, "");

    return Boolean(
      details &&
      details.methodId &&
      details.methodType === "Bank Transfer" &&
      /^\d{6,17}$/.test(accountNumber) && // account number length
      /^\d{9}$/.test(routingNumber) // routing number must be 9 digits
    );
  }

  // Processes bank transfer
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

// Concrete Strategy for PayPal payments
class PayPalPayment extends PaymentStrategy {
  // Validates PayPal email
  validate(details) {
    const methodDetails = details?.details || {};
    return Boolean(
      details &&
      details.methodId &&
      details.methodType === "PayPal" &&
      isValidEmail(methodDetails.paypalEmail) // must be valid email
    );
  }

  // Processes PayPal payment
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

// Factory class that creates the correct payment strategy based on type
class PaymentStrategyFactory {
  static create(methodType) {
    // Returns appropriate strategy object depending on method type
    if (methodType === "Credit Card") return new CreditCardPayment();
    if (methodType === "Debit Card") return new DebitCardPayment();
    if (methodType === "Bank Transfer") return new BankTransferPayment();
    if (methodType === "PayPal") return new PayPalPayment();

    // Throws error if unsupported payment type is passed
    throw new Error(`Unsupported payment method type: ${methodType}`);
  }
}

// Export all strategies and factory for use in other files (e.g., server.js)
module.exports = {
  PaymentStrategyFactory,
  CreditCardPayment,
  DebitCardPayment,
  BankTransferPayment,
  PayPalPayment
};