// sse.js — Server-Sent Events stream + Observer pattern notifications.
// Holds the set of connected SSE clients and broadcasts booking events to them.

const { NotificationManager, EmailNotifier, SmsNotifier, PushNotifier } =
  require("./patterns/observer/NotificationManager");
const { readSystemPolicies } = require("./dataStore");

// Set of active SSE response objects (one per connected browser tab).
const streamClients = new Set();

// Observer pattern — three concrete notifiers attached to one manager.
const notificationManager = new NotificationManager();
notificationManager.attach(new EmailNotifier());
notificationManager.attach(new SmsNotifier());
notificationManager.attach(new PushNotifier());

/**
 * Fires after every booking create / status change.
 * - Sends to Observer notifiers (Email, SMS, Push) if notifications are enabled.
 * - Pushes an SSE event to every connected browser tab.
 */
function broadcastBookingEvent(type, booking, metadata = null) {
  const policies = readSystemPolicies();

  if (policies.notificationsEnabled) {
    notificationManager.sendNotification(`booking.${type}`, {
      bookingId: booking?.id    || null,
      status:    booking?.status || null,
      updatedBy: booking?.updatedBy || null,
      ...(metadata ? { metadata } : {})
    });
  }

  if (!streamClients.size) return;

  const payload    = JSON.stringify(metadata ? { type, booking, metadata } : { type, booking });
  const eventChunk = `event: booking\ndata: ${payload}\n\n`;
  streamClients.forEach((res) => res.write(eventChunk));
}

module.exports = { streamClients, broadcastBookingEvent };
