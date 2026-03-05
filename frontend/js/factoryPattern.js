// Factory Pattern for Creating Different Types of Users


// Base User class
// This represents a general user in the system and contains common properties
// shared by all user types.
class User {
    constructor(id, name, email) {
        this.id = id;
        this.name = name;
        this.email = email;
        this.createdAt = new Date();
    }
}

// Client class that extends the base User class
// Clients can book services and store payment methods
class Client extends User {
    constructor(id, name, email) {
        super(id, name, email);
        this.role = 'client';
        this.paymentMethods = [];
        this.bookings = [];
    }
}


// Consultant class that extends the base User class
// Consultants provide services and manage their availability
class Consultant extends User {
    constructor(id, name, email, expertise) {
        super(id, name, email);
        this.role = 'consultant';
        this.expertise = expertise;
        this.status = 'pending';
        this.availability = [];
        this.services = [];
        this.rating = 0;
        this.totalBookings = 0;
    }
}

// Admin class that extends the base User class
// Admin users have full permissions to manage the system
class Admin extends User {
    constructor(id, name, email) {
        super(id, name, email);
        this.role = 'admin';
        this.permissions = ['all'];
    }
}

// UserFactory class responsible for creating user objects

class UserFactory {
    createUser(type, id, name, email, additionalInfo = {}) {
        switch(type.toLowerCase()) {
            case 'client':
                return new Client(id, name, email);
            case 'consultant':
                return new Consultant(id, name, email, additionalInfo.expertise);
            case 'admin':
                return new Admin(id, name, email);
            default:
                throw new Error(`Invalid user type: ${type}`);
        }
    }
}

module.exports = UserFactory;