(function () {
  // Interaction map:
  // - client.js/admin.js/consultant.js/booking.js call into BookingStore.
  // - BookingStore talks to server.js REST + SSE endpoints.
  // - server.js validates transitions using the backend State Pattern.
  // - server.js applies Strategy/Observer/Factory behaviors as needed.
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
    const response = await fetch(path, {
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

  async function getBookings() {
    return apiRequest("/api/bookings");
  }

  async function addBooking(bookingData) {
    return apiRequest("/api/bookings", {
      method: "POST",
      body: JSON.stringify(bookingData || {})
    });
  }

  // metadata is optional and currently used by booking.js when client pays.
  // It forwards payment method info so backend Strategy can process payment.
  async function updateBookingStatus(bookingId, nextStatus, actor, metadata) {
    const payload = {
      status: sanitizeStatus(nextStatus),
      actor: actor || "system"
    };

    if (metadata && typeof metadata === "object") {
      if (metadata.paymentMethodId) {
        payload.paymentMethodId = metadata.paymentMethodId;
      }
      if (metadata.paymentMethodType) {
        payload.paymentMethodType = metadata.paymentMethodType;
      }
      if (metadata.paymentMethodLabel) {
        payload.paymentMethodLabel = metadata.paymentMethodLabel;
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

    const stream = new EventSource("/api/bookings/stream");

    stream.addEventListener("booking", (event) => {
      try {
        const payload = JSON.parse(event.data);
        listener(payload);
      } catch (_error) {
        listener({ type: "unknown" });
      }
    });

    stream.onerror = function onError() {
      //EventSource auto-reconnects. Keeping handler prevents noisy uncaught errors.
    };

    return function unsubscribeSse() {
      stream.close();
    };
  }

  window.BookingStore = {
    getBookings: getBookings,
    addBooking: addBooking,
    updateBookingStatus: updateBookingStatus,
    subscribe: subscribe,
    canTransition: canTransition
  };
})();
