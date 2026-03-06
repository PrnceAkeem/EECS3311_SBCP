package patterns;

// =============================================================================
// PaymentStrategy.java — Abstract base for the GoF Strategy Pattern
// =============================================================================
//
// WHAT IS THE STRATEGY PATTERN?
//   Defines a family of algorithms (payment methods), encapsulates each one,
//   and makes them interchangeable. The client selects the strategy at runtime.
//
// HOW IT WORKS HERE:
//   - ApiHandler calls PaymentStrategyFactory.create(methodType) to get
//     the right strategy for the payment type selected by the client.
//   - The strategy validates payment details and returns a PaymentResult
//     containing the transaction ID included in the PATCH response.
//
// Public because ApiHandler holds a reference to PaymentStrategy and calls
// strategy.process() on it.
//
// Must be in its own file (Java: one public class per file).
// Mirrors PaymentStrategy in strategy.js.
// =============================================================================

import java.time.Instant;
import java.util.Random;

public abstract class PaymentStrategy {

    // Validates details and processes the payment.
    // @param amount  – the amount to charge (e.g. "$299.99")
    // @param details – payment details object (methodId + methodType)
    // @return        – PaymentResult with success flag, transactionId, message
    public abstract PaymentResult process(String amount, PaymentDetails details);

    // Validates payment details before processing.
    // Default implementation always returns true; override per strategy.
    public boolean validate(PaymentDetails details) {
        return true;
    }

    // Generates a transaction ID in the same format as strategy.js:
    //   PREFIX-<last 6 digits of epoch ms>-<6 random uppercase chars>
    // e.g. "CC-692400-3F9K2A"
    // Mirrors buildTransactionId() in strategy.js.
    protected String buildTransactionId(String prefix) {
        String timePart   = String.valueOf(Instant.now().toEpochMilli()).substring(7); // last 6 digits
        String randomPart = Integer.toString(new Random().nextInt(0xFFFFFF), 36)
                                   .toUpperCase();
        return prefix + "-" + timePart + "-" + randomPart;
    }
}
