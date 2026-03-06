(function () {
  // Interaction map:
  // - client.js/admin.js/consultant.js/booking.js call into BookingStore.
  // - BookingStore talks to the Java backend REST + SSE endpoints (port 8080).
  // - Java backend validates transitions using the State Pattern.
  // - Java backend applies Strategy/Observer/Factory behaviors as needed.

  // Base URL for the Java backend. All API requests are sent here.
  const API_BASE = "http://localhost:8080";

  const VALID_STATUSES = new Set([
    "Requested",
    "Confirmed",
    "Pending Payment",
    "Rejected",
    "Cancelled",
    "Paid",
    "Completed"
  ]);

  // ==========================================================================
  // Valid Transitions — mirrors the backend State Pattern
  // This tells us which status changes are allowed from each current status.
  // Same rules as BookingStateMachine.js on the server.
  // ==========================================================================
  const VALID_TRANSITIONS = {
    "Requested":       ["Confirmed", "Rejected", "Cancelled"],
    "Confirmed":       ["Pending Payment", "Cancelled"],
    "Pending Payment": ["Paid", "Cancelled"],
    "Paid":            ["Completed", "Cancelled"],
    "Completed":       [],
    "Rejected":        [],
    "Cancelled":       []
  };

  // Returns true if moving from currentStatus → nextStatus is allowed.
  function canTransition(currentStatus, nextStatus) {
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed) {
      return false;
    }
    return allowed.includes(nextStatus);
  }

  async function apiRequest(path, options) {
    const response = await fetch(API_BASE + path, {
      headers: {
        "Content-Type": "application/json"
      },
      ...options
    });

    if (!response.ok) {
      let message = "Request failed.";
      try {
        const errorPayload = await response.json();
        if (errorPayload && errorPayload.error) {
          message = errorPayload.error;
        }
      } catch (_error) {
        message = `Request failed with status ${response.status}.`;
      }
      throw new Error(message);
    }

    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  function sanitizeStatus(status) {
    if (VALID_STATUSES.has(status)) {
      return status;
    }
    return "Requested";
  }

  // ==========================================================================
  // Booking API — reads and writes the in-memory BookingStore on the Java server
  // ==========================================================================

  async function getBookings() {
    // HTTP GET → Java GetBookingsHandler → BookingStore.getAllBookingsJson()
    // Returns a JSON array of booking objects; JS parses it with response.json()
    return apiRequest("/api/bookings");
  }

  async function addBooking(bookingData) {
    // HTTP POST with JSON body → Java PostBookingHandler → BookingStore.addBooking()
    // Also triggers the Observer pattern (email/SMS/push notifications logged to console)
    return apiRequest("/api/bookings", {
      method: "POST",
      body: JSON.stringify(bookingData || {})
    });
  }

  // ==========================================================================
  // Payment-method API — reads and writes the payment_methods PostgreSQL table
  // ==========================================================================

  /**
   * Fetches all saved payment methods from the Java backend.
   *
   * HTTP flow:
   *   fetch(API_BASE + "/api/payment-methods")    ← GET request
   *   → Java GetPaymentMethodsHandler             ← routes the request
   *   → PaymentMethodStore.getAllMethodsJson()     ← runs SELECT query via JDBC
   *   → PostgreSQL payment_methods table          ← returns rows
   *   → Java serialises rows to JSON array        ← sends 200 response
   *   → JS response.json() parses the array       ← used by the payment modal
   *
   * Consumed by: booking.js (payment modal) and methods.js (table render)
   */
  async function getPaymentMethods() {
    return apiRequest("/api/payment-methods");
  }

  // metadata is optional and currently used by booking.js when client pays.
  // It forwards payment method info so backend Strategy can process payment.
  async function updateBookingStatus(bookingId, nextStatus, actor, metadata) {
    const payload = {
      status: sanitizeStatus(nextStatus),
      actor: actor || "system"
    };

    if (metadata && typeof metadata === "object") {
      // Java backend (ApiHandler.java) reads "methodId" and "methodType"
      if (metadata.paymentMethodId) {
        payload.methodId = metadata.paymentMethodId;
      }
      if (metadata.paymentMethodType) {
        payload.methodType = metadata.paymentMethodType;
      }
    }

    return apiRequest(`/api/bookings/${bookingId}/status`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return function unsubscribeNoop() {};
    }

    if (!("EventSource" in window)) {
      const pollTimer = setInterval(() => {
        listener({ type: "poll" });
      }, 3000);

      return function unsubscribePolling() {
        clearInterval(pollTimer);
      };
    }

    const stream = new EventSource(API_BASE + "/api/bookings/stream");

    stream.addEventListener("booking", (event) => {
      try {
        const payload = JSON.parse(event.data);
        listener(payload);
      } catch (_error) {
        listener({ type: "unknown" });
      }
    });

    stream.onerror = function onError() {
      // EventSource auto-reconnects. Keeping handler prevents noisy uncaught errors.
    };

    return function unsubscribeSse() {
      stream.close();
    };
  }

  window.BookingStore = {
    getBookings:         getBookings,
    addBooking:          addBooking,
    updateBookingStatus: updateBookingStatus,
    getPaymentMethods:   getPaymentMethods,   // used by booking.js payment modal
    subscribe:           subscribe,
    canTransition:       canTransition
  };
})();
