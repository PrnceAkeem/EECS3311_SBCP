// Observer pattern:
// - server.js broadcastBookingEvent() calls notificationManager.sendNotification().
// - NotificationManager fans out updates to attached notifiers.
// - Console logs from notifiers are the Phase 1 proof of observer activity.
class Observer {
  update(_eventName, _payload) {
    throw new Error("update() must be implemented by a concrete observer.");
  }
}

class Subject {
  constructor() {
    this.observers = [];
  }

  attach(observer) {
    this.observers.push(observer);
  }

  detach(observer) {
    this.observers = this.observers.filter((item) => item !== observer);
  }

  notify(eventName, payload) {
    this.observers.forEach((observer) => {
      observer.update(eventName, payload);
    });
  }
}

class EmailNotifier extends Observer {
  update(eventName, payload) {
    // Console output is enough for Phase 1 proof.
    // eslint-disable-next-line no-console
    console.log(`[Observer][Email] ${eventName}`, payload);
  }
}

class SmsNotifier extends Observer {
  update(eventName, payload) {
    // eslint-disable-next-line no-console
    console.log(`[Observer][SMS] ${eventName}`, payload);
  }
}

class PushNotifier extends Observer {
  update(eventName, payload) {
    // eslint-disable-next-line no-console
    console.log(`[Observer][Push] ${eventName}`, payload);
  }
}

class NotificationManager extends Subject {
  constructor() {
    super();
    this.history = [];
  }

  sendNotification(eventName, payload) {
    this.history.push({
      eventName,
      payload,
      sentAt: new Date().toISOString()
    });
    this.notify(eventName, payload);
  }

  getHistory() {
    return this.history.slice();
  }
}

module.exports = {
  NotificationManager,
  EmailNotifier,
  SmsNotifier,
  PushNotifier
};
