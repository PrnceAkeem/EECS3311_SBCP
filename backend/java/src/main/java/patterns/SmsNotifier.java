package patterns;

/**
 * SmsNotifier.java — Concrete Observer: SMS notification channel
 *
 * Public because Server.java instantiates it directly.
 * Must be in its own file (Java: one public class per file).
 * Extends the package-private Observer defined in NotificationManager.java.
 *
 * Phase 1: logs to console. Phase 2: integrate Twilio / AWS SNS here.
 */
public class SmsNotifier extends Observer {

    @Override
    public void update(String eventName, Object payload) {
        System.out.println("[Observer][SMS] " + eventName + " " + payload);
    }
}
