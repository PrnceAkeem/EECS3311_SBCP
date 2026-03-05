(function () {
  // Add "Pending Payment" to valid statuses to match the state pattern
  const VALID_STATUSES = new Set([
    "Requested",
    "Confirmed",
    "Pending Payment",  // Added this
    "Rejected",
    "Cancelled",
    "Paid",
    "Completed"
  ]);

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

  async function updateBookingStatus(bookingId, nextStatus, actor) {
    // Validate that the next status is valid
    const sanitizedStatus = sanitizeStatus(nextStatus);
    
    return apiRequest(`/api/bookings/${bookingId}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        status: sanitizedStatus,
        actor: actor || "system"
      })
    });
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return function unsubscribeNoop() {};
    }

    if (!("EventSource" in window)) {
      // Fallback to polling if EventSource is not supported
      const pollTimer = setInterval(() => {
        listener({ type: "poll" });
      }, 3000);

      return function unsubscribePolling() {
        clearInterval(pollTimer);
      };
    }

    // Use Server-Sent Events for real-time updates
    const stream = new EventSource("/api/bookings/stream");

    stream.addEventListener("booking", (event) => {
      try {
        const payload = JSON.parse(event.data);
        listener(payload);
      } catch (_error) {
        listener({ type: "unknown" });
      }
    });

    stream.addEventListener("connected", () => {
      console.log("Connected to booking stream");
    });

    stream.onerror = function onError() {
      // EventSource auto-reconnects. Keeping handler prevents noisy uncaught errors.
    };

    return function unsubscribeSse() {
      stream.close();
    };
  }

  // Helper function to check if a status allows client actions
  function canClientCancel(status) {
    return status === "Requested" || status === "Confirmed";
  }

  function canClientPay(status) {
    return status === "Pending Payment";
  }

  function canClientModify(status) {
    return canClientCancel(status) || canClientPay(status);
  }

  // Export the BookingStore object
  window.BookingStore = {
    getBookings: getBookings,
    addBooking: addBooking,
    updateBookingStatus: updateBookingStatus,
    subscribe: subscribe,
    // Helper methods for UI logic
    canClientCancel: canClientCancel,
    canClientPay: canClientPay,
    canClientModify: canClientModify,
    // Expose valid statuses for reference
    VALID_STATUSES: Array.from(VALID_STATUSES)
  };
})();