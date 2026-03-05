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
        return 'REQUESTED';
    }
}

class ConfirmedState extends BookingState {
    constructor(booking) {
        super(booking);
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
        return 'CONFIRMED';
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
        return 'PAID';
    }
}

class CompletedState extends BookingState {
    constructor(booking) {
        super(booking);
    }
    
    getStatus() {
        return 'COMPLETED';
    }
}

class CancelledState extends BookingState {
    constructor(booking) {
        super(booking);
    }
    
    getStatus() {
        return 'CANCELLED';
    }
}

class RejectedState extends BookingState {
    constructor(booking) {
        super(booking);
    }
    
    getStatus() {
        return 'REJECTED';
    }
}

module.exports = {
    RequestedState,
    ConfirmedState,
    PaidState,
    CompletedState,
    CancelledState,
    RejectedState
};