// Observer Pattern for Notifications

class Observer {
    update(event, data) {
        throw new Error('Method not implemented');
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
        this.observers = this.observers.filter(obs => obs !== observer);
    }
    
    notify(event, data) {
        this.observers.forEach(observer => observer.update(event, data));
    }
}

class EmailNotifier extends Observer {
    update(event, data) {
        console.log(`📧 Email sent for event: ${event}`, data);
        // In real app, this would send actual emails
    }
}

class SMSNotifier extends Observer {
    update(event, data) {
        console.log(`📱 SMS sent for event: ${event}`, data);
    }
}

class PushNotifier extends Observer {
    update(event, data) {
        console.log(`🔔 Push notification sent for event: ${event}`, data);
    }
}

class NotificationManager extends Subject {
    constructor() {
        super();
        this.notificationHistory = [];
    }
    
    sendNotification(event, data) {
        this.notificationHistory.push({
            event,
            data,
            timestamp: new Date()
        });
        this.notify(event, data);
    }
    
    getNotificationHistory() {
        return this.notificationHistory;
    }
}

module.exports = {
    EmailNotifier,
    SMSNotifier,
    PushNotifier,
    NotificationManager
};