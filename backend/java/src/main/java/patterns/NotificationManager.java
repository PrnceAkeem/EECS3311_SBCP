package patterns;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

// =============================================================================
// NotificationManager.java — GoF Observer Pattern (Subject + concrete Subject)
// =============================================================================
//
// FILE LAYOUT (Java rule: one public class per file)
//   abstract class Observer          ← package-private abstract base subscriber
//   abstract class Subject           ← package-private publisher
//   public class NotificationManager ← concrete Subject; filename must match
//
// The concrete observers (EmailNotifier, SmsNotifier, PushNotifier) are public
// because Server.java (different package) instantiates them; each lives in its
// own .java file.
//
// WHY package-private for Observer and Subject?
//   Nothing outside the patterns package needs to name these types directly.
//   NotificationManager (public) exposes attach()/detach()/sendNotification()
//   as the only interface the rest of the app needs.
// =============================================================================

// ── Abstract base subscriber ──────────────────────────────────────────────────
abstract class Observer {
    /** Called by the Subject when a booking event fires. */
    public abstract void update(String eventName, Object payload);
}

// ── Abstract publisher ────────────────────────────────────────────────────────
abstract class Subject {

    protected final List<Observer> observers = new ArrayList<>();

    public void attach(Observer o) { observers.add(o); }
    public void detach(Observer o) { observers.remove(o); }

    /** Broadcasts the event to every registered observer. */
    public void notify(String eventName, Object payload) {
        for (Observer o : observers) o.update(eventName, payload);
    }
}

// ── Concrete Subject ──────────────────────────────────────────────────────────
/**
 * NotificationManager — fans booking events out to all attached notifiers
 * and keeps an immutable history of every event sent.
 *
 * Used in Server.java:
 *   NotificationManager nm = new NotificationManager();
 *   nm.attach(new EmailNotifier());
 *   nm.sendNotification("BOOKING_REQUESTED", payload);
 */
public class NotificationManager extends Subject {

    /** Immutable record of one notification. */
    public static class HistoryRecord {
        public final String  eventName;
        public final Object  payload;
        public final Instant sentAt;

        public HistoryRecord(String eventName, Object payload) {
            this.eventName = eventName;
            this.payload   = payload;
            this.sentAt    = Instant.now();
        }

        @Override
        public String toString() {
            return "[" + sentAt + "] " + eventName + " | " + payload;
        }
    }

    private final List<HistoryRecord> history = new ArrayList<>();

    /**
     * Records the event in history then broadcasts it to all observers.
     * Called by PostBookingHandler and PatchBookingStatusHandler in ApiHandler.java.
     */
    public void sendNotification(String eventName, Object payload) {
        history.add(new HistoryRecord(eventName, payload));
        notify(eventName, payload);
    }

    public List<HistoryRecord> getHistory() {
        return Collections.unmodifiableList(history);
    }
}
