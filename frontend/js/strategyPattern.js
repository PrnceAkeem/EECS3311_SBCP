// Strategy Pattern for Payment Methods

class PaymentStrategy {
    process(amount, details) {
        throw new Error('Method not implemented');
    }
    
    validate(details) {
        throw new Error('Method not implemented');
    }
}

class CreditCardPayment extends PaymentStrategy {
    process(amount, details) {
        if (!this.validate(details)) {
            return { success: false, message: 'Invalid credit card details' };
        }
        
        // Simulate payment processing
        return {
            success: true,
            transactionId: 'CC-' + Math.random().toString(36).substr(2, 9),
            message: 'Credit card payment processed successfully'
        };
    }
    
    validate(details) {
        const { cardNumber, expiryDate, cvv } = details;
        
        const isValidCardNumber = cardNumber && /^\d{16}$/.test(cardNumber.replace(/\s/g, ''));
        const isValidExpiry = expiryDate && /^(0[1-9]|1[0-2])\/\d{2}$/.test(expiryDate);
        const isValidCVV = cvv && /^\d{3,4}$/.test(cvv);
        
        return isValidCardNumber && isValidExpiry && isValidCVV;
    }
}

class DebitCardPayment extends PaymentStrategy {
    process(amount, details) {
        if (!this.validate(details)) {
            return { success: false, message: 'Invalid debit card details' };
        }
        
        return {
            success: true,
            transactionId: 'DC-' + Math.random().toString(36).substr(2, 9),
            message: 'Debit card payment processed successfully'
        };
    }
    
    validate(details) {
        const { cardNumber, expiryDate, cvv } = details;
        
        const isValidCardNumber = cardNumber && /^\d{16}$/.test(cardNumber.replace(/\s/g, ''));
        const isValidExpiry = expiryDate && /^(0[1-9]|1[0-2])\/\d{2}$/.test(expiryDate);
        const isValidCVV = cvv && /^\d{3,4}$/.test(cvv);
        
        return isValidCardNumber && isValidExpiry && isValidCVV;
    }
}

class PayPalPayment extends PaymentStrategy {
    process(amount, details) {
        if (!this.validate(details)) {
            return { success: false, message: 'Invalid PayPal email' };
        }
        
        return {
            success: true,
            transactionId: 'PP-' + Math.random().toString(36).substr(2, 9),
            message: 'PayPal payment processed successfully'
        };
    }
    
    validate(details) {
        const { email } = details;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return email && emailRegex.test(email);
    }
}

class BankTransferPayment extends PaymentStrategy {
    process(amount, details) {
        if (!this.validate(details)) {
            return { success: false, message: 'Invalid bank account details' };
        }
        
        return {
            success: true,
            transactionId: 'BT-' + Math.random().toString(36).substr(2, 9),
            message: 'Bank transfer initiated successfully'
        };
    }
    
    validate(details) {
        const { accountNumber, routingNumber } = details;
        
        const isValidAccount = accountNumber && /^\d{10,12}$/.test(accountNumber);
        const isValidRouting = routingNumber && /^\d{9}$/.test(routingNumber);
        
        return isValidAccount && isValidRouting;
    }
}

module.exports = {
    CreditCardPayment,
    DebitCardPayment,
    PayPalPayment,
    BankTransferPayment
};