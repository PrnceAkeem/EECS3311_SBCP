(function () {
  const VALID_STATUSES = new Set([
    "Requested",
    "Confirmed",
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
    return apiRequest(`/api/bookings/${bookingId}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        status: sanitizeStatus(nextStatus),
        actor: actor || "system"
      })
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
      // EventSource auto-reconnects. Keeping handler prevents noisy uncaught errors.
    };

    return function unsubscribeSse() {
      stream.close();
    };
  }

  window.BookingStore = {
    getBookings: getBookings,
    addBooking: addBooking,
    updateBookingStatus: updateBookingStatus,
    subscribe: subscribe
  };
})();
