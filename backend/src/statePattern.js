// State Pattern Implementation for Booking Status

class BookingState {
    constructor(booking) {
        this.booking = booking;
    }
    
    request() {
        throw new Error('Method not implemented');
    }
    
    confirm() {
        throw new Error('Method not implemented');
    }
    
    cancel() {
        throw new Error('Method not implemented');
    }
    
    complete() {
        throw new Error('Method not implemented');
    }
    
    reject() {
        throw new Error('Method not implemented');
    }
    
    getStatus() {
        throw new Error('Method not implemented');
    }
}

class RequestedState extends BookingState {
    constructor(booking) {
        super(booking);
    }
    
    confirm() {
        this.booking.setState(new ConfirmedState(this.booking));
        return this.booking;
    }
    
    reject() {
        this.booking.setState(new RejectedState(this.booking));
        return this.booking;
    }
    
    cancel() {
        this.booking.setState(new CancelledState(this.booking));
        return this.booking;
    }
    
    getStatus() {
        return 'Requested';
    }
}

class ConfirmedState extends BookingState {
    constructor(booking) {
        super(booking);
    }

    pendingPayment() {  
        this.booking.setState(new PendingPaymentState(this.booking));
        return this.booking;
    }

    
    cancel() {
        this.booking.setState(new CancelledState(this.booking));
        return this.booking;
    }
    
    complete() {
        // Can't complete before payment
        throw new Error('Payment required before completion');
    }
    
    getStatus() {
        return 'Confirmed';
    }
}

class PaidState extends BookingState {
    constructor(booking) {
        super(booking);
    }
    
    complete() {
        this.booking.setState(new CompletedState(this.booking));
        return this.booking;
    }
    
    cancel() {
        // Refund logic would go here
        this.booking.setState(new CancelledState(this.booking));
        return this.booking;
    }
    
    getStatus() {
        return 'Paid';
    }
}

class CompletedState extends BookingState {
    constructor(booking) {
        super(booking);
    }
    
    getStatus() {
        return 'Completed';
    }
}

class CancelledState extends BookingState {
    constructor(booking) {
        super(booking);
    }
    
    getStatus() {
        return 'Cancelled';
    }
}

class RejectedState extends BookingState {
    constructor(booking) {
        super(booking);
    }
    
    getStatus() {
        return 'Rejected';
    }
}

class PendingPaymentState extends BookingState {
    constructor(booking) {
        super(booking);
    }
    
    pay() {
        this.booking.setState(new PaidState(this.booking));
        return this.booking;
    }
    
    cancel() {
        // Refund logic would go here if needed
        this.booking.setState(new CancelledState(this.booking));
        return this.booking;
    }
    
    getStatus() {
        return 'Pending Payment';
    }
}

// Update exports
module.exports = {
    RequestedState,
    ConfirmedState,
    PendingPaymentState,  // Add this
    PaidState,
    CompletedState,
    CancelledState,
    RejectedState
};

