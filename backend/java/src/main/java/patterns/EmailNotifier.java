package patterns;

/**
 * EmailNotifier.java — Concrete Observer: email notification channel
 *
 * Must be public (Server.java does: notificationManager.attach(new EmailNotifier())).
 * Must be in its own file because it is public.
 *
 * Extends the package-private Observer base class defined in NotificationManager.java.
 * This works because they share the same package — no import needed.
 *
 * Phase 1: logs to console. Phase 2: integrate JavaMail / SendGrid here.
 */
public class EmailNotifier extends Observer {

    @Override
    public void update(String eventName, Object payload) {
        System.out.println("[Observer][Email] " + eventName + " " + payload);
    }
}
