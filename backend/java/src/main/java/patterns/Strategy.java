package patterns;

// =============================================================================
// Strategy.java — GoF Strategy Pattern (Payment Processing)
// =============================================================================
//
// WHAT IS THE STRATEGY PATTERN?
//   Defines a family of algorithms (payment methods), encapsulates each one,
//   and makes them interchangeable. The client selects the strategy at runtime.
//
// HOW IT WORKS HERE:
//   - server.js asks PaymentStrategyFactory.create(methodType) for a strategy.
//   - The selected strategy validates payment details and returns a transaction ID.
//   - server.js then includes that ID in PATCH /api/bookings/:id/status response.
//
// CLASSES IN THIS FILE:
//   PaymentStrategy          – abstract base; process() and validate() contract
//   CreditCardPayment        – strategy for credit card payments  (prefix "CC")
//   BankTransferPayment      – strategy for bank transfers        (prefix "BT")
//   PayPalPayment            – strategy for PayPal payments       (prefix "PP")
//   InteracETransferPayment  – strategy for Interac e-Transfers   (prefix "IT")
//   PaymentStrategyFactory   – static factory that returns the right strategy
//
// Mirrors strategy.js in the repository.
// =============================================================================

import java.time.Instant;
import java.util.Map;
import java.util.Random;

// =============================================================================
// PaymentResult — return value of process()
// =============================================================================
// Maps to the plain object returned by process() in strategy.js:
//   { success, transactionId, message }
// =============================================================================
public class PaymentResult {

    public final boolean success;
    public final String  transactionId;  // null when success = false
    public final String  message;

    public PaymentResult(boolean success, String transactionId, String message) {
        this.success       = success;
        this.transactionId = transactionId;
        this.message       = message;
    }

    @Override
    public String toString() {
        return "PaymentResult{success=" + success
             + ", transactionId=" + transactionId
             + ", message=" + message + "}";
    }
}

// =============================================================================
// PaymentDetails — wraps the details map passed to process() / validate()
// =============================================================================
// Mirrors the plain JS object: { methodId, methodType, ... }
// =============================================================================
public class PaymentDetails {

    public final String methodId;    // ID of the saved payment method
    public final String methodType;  // "Credit Card" | "Bank Transfer" | "PayPal" | "Interac e-Transfer"

    public PaymentDetails(String methodId, String methodType) {
        this.methodId   = methodId;
        this.methodType = methodType;
    }
}

// =============================================================================
// PaymentStrategy — Abstract base strategy
// =============================================================================
// Mirrors PaymentStrategy in strategy.js.
// =============================================================================
public abstract class PaymentStrategy {

    // Validates details and processes the payment.
    // @param amount  – the amount to charge (as a formatted string, e.g. "$299.99")
    // @param details – payment details object
    // @return        – PaymentResult with success flag, transactionId, message
    public abstract PaymentResult process(String amount, PaymentDetails details);

    // Validates payment details before processing.
    // Default implementation always returns true (override per strategy).
    public boolean validate(PaymentDetails details) {
        return true;
    }

    // Generates a transaction ID in the same format as strategy.js:
    //   PREFIX-<last 6 digits of epoch ms>-<6 random uppercase chars>
    // Mirrors buildTransactionId() in strategy.js.
    protected String buildTransactionId(String prefix) {
        String timePart   = String.valueOf(Instant.now().toEpochMilli()).substring(7); // last 6 digits
        String randomPart = Integer.toString(new Random().nextInt(0xFFFFFF), 36)
                                   .toUpperCase();
        return prefix + "-" + timePart + "-" + randomPart;
    }
}

// =============================================================================
// CreditCardPayment — Strategy for credit card payments
// =============================================================================
// validate: details.methodId present AND details.methodType === "Credit Card"
// transactionId prefix: "CC"
// Mirrors CreditCardPayment in strategy.js.
// =============================================================================
class CreditCardPayment extends PaymentStrategy {

    @Override
    public boolean validate(PaymentDetails details) {
        return details != null
            && details.methodId   != null && !details.methodId.isEmpty()
            && "Credit Card".equals(details.methodType);
    }

    @Override
    public PaymentResult process(String amount, PaymentDetails details) {
        if (!validate(details)) {
            return new PaymentResult(false, null, "Invalid credit card payment data.");
        }
        return new PaymentResult(
            true,
            buildTransactionId("CC"),
            "Credit card payment accepted for " + amount + "."
        );
    }
}

// =============================================================================
// BankTransferPayment — Strategy for bank transfers
// =============================================================================
// validate: details.methodId present AND details.methodType === "Bank Transfer"
// transactionId prefix: "BT"
// Mirrors BankTransferPayment in strategy.js.
// =============================================================================
class BankTransferPayment extends PaymentStrategy {

    @Override
    public boolean validate(PaymentDetails details) {
        return details != null
            && details.methodId   != null && !details.methodId.isEmpty()
            && "Bank Transfer".equals(details.methodType);
    }

    @Override
    public PaymentResult process(String amount, PaymentDetails details) {
        if (!validate(details)) {
            return new PaymentResult(false, null, "Invalid bank transfer payment data.");
        }
        return new PaymentResult(
            true,
            buildTransactionId("BT"),
            "Bank transfer initiated for " + amount + "."
        );
    }
}

// =============================================================================
// PayPalPayment — Strategy for PayPal payments
// =============================================================================
// validate: details.methodId present AND details.methodType === "PayPal"
// transactionId prefix: "PP"
// Mirrors PayPalPayment in strategy.js.
// =============================================================================
class PayPalPayment extends PaymentStrategy {

    @Override
    public boolean validate(PaymentDetails details) {
        return details != null
            && details.methodId   != null && !details.methodId.isEmpty()
            && "PayPal".equals(details.methodType);
    }

    @Override
    public PaymentResult process(String amount, PaymentDetails details) {
        if (!validate(details)) {
            return new PaymentResult(false, null, "Invalid PayPal payment data.");
        }
        return new PaymentResult(
            true,
            buildTransactionId("PP"),
            "PayPal payment accepted for " + amount + "."
        );
    }
}

// =============================================================================
// InteracETransferPayment — Strategy for Interac e-Transfer payments
// =============================================================================
// validate: details.methodId present AND details.methodType === "Interac e-Transfer"
// transactionId prefix: "IT"
// Mirrors InteracETransferPayment in strategy.js.
// =============================================================================
class InteracETransferPayment extends PaymentStrategy {

    @Override
    public boolean validate(PaymentDetails details) {
        return details != null
            && details.methodId   != null && !details.methodId.isEmpty()
            && "Interac e-Transfer".equals(details.methodType);
    }

    @Override
    public PaymentResult process(String amount, PaymentDetails details) {
        if (!validate(details)) {
            return new PaymentResult(false, null, "Invalid Interac e-Transfer payment data.");
        }
        return new PaymentResult(
            true,
            buildTransactionId("IT"),
            "Interac e-Transfer submitted for " + amount + "."
        );
    }
}

// =============================================================================
// PaymentStrategyFactory — Returns the correct strategy for a payment method type
// =============================================================================
// server.js calls: PaymentStrategyFactory.create(methodType)
// Mirrors PaymentStrategyFactory in strategy.js.
// =============================================================================
public class PaymentStrategyFactory {

    // @param methodType – "Credit Card" | "Bank Transfer" | "PayPal" | "Interac e-Transfer"
    // @return           – the matching PaymentStrategy instance
    // @throws           – IllegalArgumentException if methodType is unsupported
    public static PaymentStrategy create(String methodType) {
        if ("Credit Card".equals(methodType)) {
            return new CreditCardPayment();
        }
        if ("Bank Transfer".equals(methodType)) {
            return new BankTransferPayment();
        }
        if ("PayPal".equals(methodType)) {
            return new PayPalPayment();
        }
        if ("Interac e-Transfer".equals(methodType)) {
            return new InteracETransferPayment();
        }
        throw new IllegalArgumentException("Unsupported payment method type: " + methodType);
    }
}
