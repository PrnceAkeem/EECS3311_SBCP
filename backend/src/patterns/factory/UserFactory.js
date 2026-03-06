// Factory Method pattern:
// - server.js asks UserFactory for role-specific user objects.
// - Booking creation flow uses this instead of direct object construction.
class User {
  constructor(id, name, email) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.createdAt = new Date().toISOString();
  }
}

//Client class
class Client extends User {
  constructor(id, name, email) {
    super(id, name, email);
    this.role = "client";
    this.bookings = [];
  }
}

//Consultant class
class Consultant extends User {
  constructor(id, name, email, expertise) {
    super(id, name, email);
    this.role = "consultant";
    this.expertise = expertise || "general";
    this.status = "active";
  }
}

class Admin extends User {
  constructor(id, name, email) {
    super(id, name, email);
    this.role = "admin";
    this.permissions = ["all"];
  }
}

class UserFactory {
  createUser(type, id, name, email, additionalInfo = {}) {
    const normalizedType = String(type || "").toLowerCase();
    if (normalizedType === "client") {
      return new Client(id, name, email);
    }
    if (normalizedType === "consultant") {
      return new Consultant(id, name, email, additionalInfo.expertise);
    }
    if (normalizedType === "admin") {
      return new Admin(id, name, email);
    }
    throw new Error(`Invalid user type: ${type}`);
  }
}

module.exports = UserFactory;
