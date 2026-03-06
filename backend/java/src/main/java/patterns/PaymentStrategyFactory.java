package patterns;

// =============================================================================
// PaymentStrategyFactory.java — Factory for GoF Strategy Pattern
// =============================================================================
//
// This file contains:
//   PaymentStrategyFactory (public)  – static factory; returns the right strategy
//   CreditCardPayment      (pkg-priv) – strategy for credit card payments
//   BankTransferPayment    (pkg-priv) – strategy for bank transfers
//   PayPalPayment          (pkg-priv) – strategy for PayPal payments
//   InteracETransferPayment(pkg-priv) – strategy for Interac e-Transfers
//
// The four concrete strategy classes are package-private because only
// PaymentStrategyFactory needs to instantiate them; ApiHandler talks to the
// abstract PaymentStrategy interface exclusively.
//
// Java rule: only ONE public class per file → the public class name matches
// the filename "PaymentStrategyFactory.java".
//
// Mirrors PaymentStrategyFactory (and the concrete strategies) in strategy.js.
// =============================================================================

// =============================================================================
// PaymentStrategyFactory — Returns the correct strategy for a payment type
// =============================================================================
// ApiHandler calls: PaymentStrategyFactory.create(methodType)
// =============================================================================
public class PaymentStrategyFactory {

    // @param methodType – "Credit Card" | "Bank Transfer" | "PayPal" | "Interac e-Transfer"
    // @return           – the matching PaymentStrategy instance
    // @throws           – IllegalArgumentException if methodType is unsupported
    public static PaymentStrategy create(String methodType) {
        if ("Credit Card".equals(methodType))         return new CreditCardPayment();
        if ("Bank Transfer".equals(methodType))       return new BankTransferPayment();
        if ("PayPal".equals(methodType))              return new PayPalPayment();
        if ("Interac e-Transfer".equals(methodType))  return new InteracETransferPayment();
        throw new IllegalArgumentException("Unsupported payment method type: " + methodType);
    }
}

// =============================================================================
// CreditCardPayment — Strategy for credit card payments
// =============================================================================
// validate: methodId present AND methodType equals "Credit Card"
// transactionId prefix: "CC"
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
// validate: methodId present AND methodType equals "Bank Transfer"
// transactionId prefix: "BT"
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
// validate: methodId present AND methodType equals "PayPal"
// transactionId prefix: "PP"
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
// validate: methodId present AND methodType equals "Interac e-Transfer"
// transactionId prefix: "IT"
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
