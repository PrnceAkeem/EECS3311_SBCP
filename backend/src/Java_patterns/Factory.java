package patterns;

// =============================================================================
// Factory.java — Simple Factory Pattern (User Creation)
// =============================================================================
//
// WHAT IS THIS PATTERN?
//   UserFactory centralises user object construction. server.js asks the
//   factory for a role-specific user object; the booking creation flow uses
//   this instead of constructing objects directly.
//
// NOTE ON PATTERN TYPE:
//   This is a Simple Factory (one class, switch/if on type string), which
//   matches the implementation in factory.js exactly. A true GoF Factory
//   Method would require abstract creator subclasses — that refactor can be
//   done in a later phase if required for grading.
//
// CLASSES IN THIS FILE:
//   User        – abstract base with id, name, email, createdAt
//   Client      – role = "client"; has bookings list
//   Consultant  – role = "consultant"; has expertise and status
//   Admin       – role = "admin"; has permissions list
//   UserFactory – creates the right subclass based on a type string
//
// Mirrors factory.js in the repository.
// =============================================================================

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

// =============================================================================
// User — Abstract base class for all platform users
// =============================================================================
// Mirrors the User class in factory.js.
// =============================================================================
public abstract class User {

    protected final String  id;
    protected final String  name;
    protected final String  email;
    protected final String  createdAt;   // ISO-8601 string, matches new Date().toISOString()

    public User(String id, String name, String email) {
        this.id        = id;
        this.name      = name;
        this.email     = email;
        this.createdAt = Instant.now().toString();
    }

    // Every subclass must declare its role string.
    public abstract String getRole();

    public String getId()        { return id; }
    public String getName()      { return name; }
    public String getEmail()     { return email; }
    public String getCreatedAt() { return createdAt; }
}

// =============================================================================
// Client — Concrete user: a service client
// =============================================================================
// role = "client", has a mutable bookings list.
// Mirrors the Client class in factory.js.
// =============================================================================
class Client extends User {

    private final String       role     = "client";
    private final List<Object> bookings = new ArrayList<>();

    public Client(String id, String name, String email) {
        super(id, name, email);
    }

    @Override
    public String getRole() { return role; }

    public List<Object> getBookings() { return bookings; }
}

// =============================================================================
// Consultant — Concrete user: a service consultant
// =============================================================================
// role = "consultant"; expertise defaults to "general" if not provided.
// status defaults to "active" (not isApproved boolean — matches factory.js).
// Mirrors the Consultant class in factory.js.
// =============================================================================
class Consultant extends User {

    private final String role      = "consultant";
    private final String expertise;
    private       String status    = "active";

    public Consultant(String id, String name, String email, String expertise) {
        super(id, name, email);
        this.expertise = (expertise != null && !expertise.isEmpty())
                         ? expertise : "general";
    }

    @Override
    public String getRole() { return role; }

    public String getExpertise() { return expertise; }
    public String getStatus()    { return status; }
    public void   setStatus(String status) { this.status = status; }
}

// =============================================================================
// Admin — Concrete user: a platform administrator
// =============================================================================
// role = "admin"; permissions = ["all"].
// Mirrors the Admin class in factory.js.
// =============================================================================
class Admin extends User {

    private final String       role        = "admin";
    private final List<String> permissions = List.of("all");

    public Admin(String id, String name, String email) {
        super(id, name, email);
    }

    @Override
    public String getRole() { return role; }

    public List<String> getPermissions() { return permissions; }
}

// =============================================================================
// UserFactory — Creates the right User subclass from a type string
// =============================================================================
// server.js calls: factory.createUser(type, id, name, email, additionalInfo)
// Mirrors UserFactory in factory.js exactly — same type strings, same logic.
// =============================================================================
public class UserFactory {

    // @param type           "client" | "consultant" | "admin"  (case-insensitive)
    // @param id             unique user identifier
    // @param name           display name
    // @param email          login email
    // @param expertise      only used when type = "consultant"; pass null otherwise
    // @return               the appropriate User subclass instance
    // @throws               IllegalArgumentException if type is unrecognised
    public User createUser(String type, String id, String name,
                           String email, String expertise) {
        String normalizedType = (type != null) ? type.toLowerCase() : "";

        if (normalizedType.equals("client")) {
            return new Client(id, name, email);
        }
        if (normalizedType.equals("consultant")) {
            return new Consultant(id, name, email, expertise);
        }
        if (normalizedType.equals("admin")) {
            return new Admin(id, name, email);
        }
        throw new IllegalArgumentException("Invalid user type: " + type);
    }
}
