package patterns;

import java.time.Instant;

/**
 * User.java — Abstract base class for all platform users (Factory pattern)
 *
 * Must be in its own file named User.java because it is declared public.
 * Java rule: only ONE public class per .java file, and the filename must
 * match the public class name exactly.
 *
 * Subclasses (Client, Consultant, Admin) are package-private and live in
 * UserFactory.java alongside the factory that creates them.
 */
public abstract class User {

    protected final String id;
    protected final String name;
    protected final String email;
    protected final String createdAt;  // ISO-8601 from Instant.now()

    public User(String id, String name, String email) {
        this.id        = id;
        this.name      = name;
        this.email     = email;
        this.createdAt = Instant.now().toString();
    }

    /** Every subclass declares its role string ("client" | "consultant" | "admin"). */
    public abstract String getRole();

    public String getId()        { return id; }
    public String getName()      { return name; }
    public String getEmail()     { return email; }
    public String getCreatedAt() { return createdAt; }
}
