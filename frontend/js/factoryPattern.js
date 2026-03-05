// Factory Pattern for Creating Different Types of Users

class User {
    constructor(id, name, email) {
        this.id = id;
        this.name = name;
        this.email = email;
        this.createdAt = new Date();
    }
}

class Client extends User {
    constructor(id, name, email) {
        super(id, name, email);
        this.role = 'client';
        this.paymentMethods = [];
        this.bookings = [];
    }
}

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

class Admin extends User {
    constructor(id, name, email) {
        super(id, name, email);
        this.role = 'admin';
        this.permissions = ['all'];
    }
}

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