package patterns;

// =============================================================================
// Observer.java — GoF Observer Pattern
// =============================================================================
//
// WHAT IS THE OBSERVER PATTERN?
//   Defines a one-to-many dependency so that when one object (the Subject /
//   Publisher) changes state, all registered observers are notified and
//   updated automatically.
//
// HOW IT WORKS HERE:
//   - server.js calls notificationManager.sendNotification() on every
//     booking event (create, status change, etc.).
//   - NotificationManager fans the event out to every attached notifier.
//   - Console output from each notifier is Phase 1 proof of observer activity.
//
// CLASSES IN THIS FILE:
//   Observer            – abstract base; concrete observers must implement update()
//   Subject             – maintains the observer list; attach / detach / notify
//   NotificationManager – concrete Subject; adds history tracking
//   EmailNotifier       – logs email events to console
//   SmsNotifier         – logs SMS events to console
//   PushNotifier        – logs push notification events to console
//
// Mirrors observer.js in the repository.
// =============================================================================

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

// =============================================================================
// Observer — Abstract base subscriber
// =============================================================================
// All concrete observers must implement update().
// Mirrors the Observer class in observer.js.
// =============================================================================
abstract class Observer {

    // Called by the Subject when an event fires.
    // @param eventName – name of the event (e.g. "BOOKING_CONFIRMED")
    // @param payload   – event-specific data object
    public abstract void update(String eventName, Object payload);
}

// =============================================================================
// Subject — Abstract publisher; manages the observer list
// =============================================================================
// Mirrors the Subject class in observer.js.
// =============================================================================
abstract class Subject {

    protected final List<Observer> observers = new ArrayList<>();

    // Registers an observer. Mirrors attach() in observer.js.
    public void attach(Observer observer) {
        observers.add(observer);
    }

    // Removes an observer. Mirrors detach() in observer.js.
    public void detach(Observer observer) {
        observers.remove(observer);
    }

    // Broadcasts the event to all registered observers.
    // Mirrors notify() in observer.js.
    public void notify(String eventName, Object payload) {
        for (Observer observer : observers) {
            observer.update(eventName, payload);
        }
    }
}

// =============================================================================
// NotificationManager — Concrete Subject with history tracking
// =============================================================================
// server.js calls notificationManager.sendNotification() on every event.
// Mirrors NotificationManager in observer.js.
// =============================================================================
public class NotificationManager extends Subject {

    // Immutable record of a past notification.
    public static class HistoryRecord {
        public final String    eventName;
        public final Object    payload;
        public final Instant   sentAt;

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

    // Stores every event that has been sent. Mirrors this.history in observer.js.
    private final List<HistoryRecord> history = new ArrayList<>();

    // Records the event then broadcasts it to all observers.
    // Mirrors sendNotification() in observer.js.
    public void sendNotification(String eventName, Object payload) {
        history.add(new HistoryRecord(eventName, payload));
        notify(eventName, payload);
    }

    // Returns a copy of the notification history.
    // Mirrors getHistory() in observer.js.
    public List<HistoryRecord> getHistory() {
        return Collections.unmodifiableList(history);
    }
}

// =============================================================================
// EmailNotifier — Concrete Observer: email channel
// =============================================================================
// Console output is enough for Phase 1 proof.
// Phase 2+: integrate JavaMail / SendGrid here.
// Mirrors EmailNotifier in observer.js.
// =============================================================================
public class EmailNotifier extends Observer {

    @Override
    public void update(String eventName, Object payload) {
        System.out.println("[Observer][Email] " + eventName + " " + payload);
    }
}

// =============================================================================
// SmsNotifier — Concrete Observer: SMS channel
// =============================================================================
// Console output is enough for Phase 1 proof.
// Phase 2+: integrate Twilio / AWS SNS here.
// Mirrors SmsNotifier in observer.js.
// =============================================================================
public class SmsNotifier extends Observer {

    @Override
    public void update(String eventName, Object payload) {
        System.out.println("[Observer][SMS] " + eventName + " " + payload);
    }
}

// =============================================================================
// PushNotifier — Concrete Observer: push notification channel
// =============================================================================
// Console output is enough for Phase 1 proof.
// Phase 2+: integrate Firebase Cloud Messaging here.
// Mirrors PushNotifier in observer.js.
// =============================================================================
public class PushNotifier extends Observer {

    @Override
    public void update(String eventName, Object payload) {
        System.out.println("[Observer][Push] " + eventName + " " + payload);
    }
}
