package patterns;

import java.util.ArrayList;
import java.util.List;

// =============================================================================
// UserFactory.java — GoF Simple Factory Pattern (user creation)
// =============================================================================
//
// FILE LAYOUT (Java rule: one public class per file)
//   public class UserFactory         ← the factory; filename must be UserFactory.java
//   class Client extends User        ← package-private; no separate file needed
//   class Consultant extends User    ← package-private
//   class Admin extends User         ← package-private
//
// The three concrete user classes are package-private because nothing outside
// the patterns package needs to reference them by name — callers only use the
// abstract User type returned by createUser().
// =============================================================================

// ── Concrete user: Client ─────────────────────────────────────────────────────
class Client extends User {

    private final String       role     = "client";
    private final List<Object> bookings = new ArrayList<>();

    public Client(String id, String name, String email) { super(id, name, email); }

    @Override public String       getRole()     { return role; }
    public       List<Object>     getBookings() { return bookings; }
}

// ── Concrete user: Consultant ─────────────────────────────────────────────────
class Consultant extends User {

    private final String role      = "consultant";
    private final String expertise;
    private       String status    = "active";

    public Consultant(String id, String name, String email, String expertise) {
        super(id, name, email);
        this.expertise = (expertise != null && !expertise.isEmpty()) ? expertise : "general";
    }

    @Override public String getRole()      { return role; }
    public       String     getExpertise() { return expertise; }
    public       String     getStatus()    { return status; }
    public       void       setStatus(String s) { this.status = s; }
}

// ── Concrete user: Admin ──────────────────────────────────────────────────────
class Admin extends User {

    private final String       role        = "admin";
    private final List<String> permissions = List.of("all");

    public Admin(String id, String name, String email) { super(id, name, email); }

    @Override public String       getRole()        { return role; }
    public       List<String>     getPermissions() { return permissions; }
}

// ── Factory ───────────────────────────────────────────────────────────────────
/**
 * UserFactory — creates role-specific User subclasses from a type string.
 *
 * Called from Server.java at startup to demonstrate the Factory pattern:
 *   User client = factory.createUser("client", "C001", "Alice", "alice@...", null);
 */
public class UserFactory {

    /**
     * @param type      "client" | "consultant" | "admin" (case-insensitive)
     * @param id        unique identifier for the user
     * @param name      display name
     * @param email     login email
     * @param expertise only used when type = "consultant"; pass null otherwise
     */
    public User createUser(String type, String id, String name,
                           String email, String expertise) {
        String t = (type != null) ? type.toLowerCase() : "";
        if (t.equals("client"))     return new Client(id, name, email);
        if (t.equals("consultant")) return new Consultant(id, name, email, expertise);
        if (t.equals("admin"))      return new Admin(id, name, email);
        throw new IllegalArgumentException("Unknown user type: " + type);
    }
}
