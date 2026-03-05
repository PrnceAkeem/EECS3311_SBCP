document.addEventListener("DOMContentLoaded", () => {
  const bookingsTableBody = document.getElementById("bookingsTableBody");
  const totalBookingsCount = document.getElementById("totalBookingsCount");
  const upcomingBookingsCount = document.getElementById("upcomingBookingsCount");
  const completedBookingsCount = document.getElementById("completedBookingsCount");

  if (!bookingsTableBody || !window.BookingStore) {
    return;
  }

  // Status sets for filtering
  const UPCOMING_STATUSES = new Set(["Requested", "Confirmed", "Pending Payment", "Paid"]);
  const COMPLETED_STATUSES = new Set(["Completed"]);
  let unsubscribe = null;

  // Get status class for styling
  function getStatusClass(status) {
    const statusClasses = {
      "Confirmed": "status-confirmed",
      "Rejected": "status-rejected",
      "Cancelled": "status-cancelled",
      "Paid": "status-paid",
      "Pending Payment": "status-pending",
      "Completed": "status-completed",
      "Requested": "status-requested"
    };
    
    return statusClasses[status] || "status-requested";
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return "-";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatBookingId(rawId) {
    const numericId = Number(rawId);
    if (!Number.isInteger(numericId)) {
      return `BK-${escapeHtml(rawId)}`;
    }
    return `BK-${String(numericId).padStart(3, "0")}`;
  }

  function formatDateTime(bookingDate, bookingTime) {
    const datePart = String(bookingDate || "").slice(0, 10);
    const timePart = String(bookingTime || "").trim();
    if (!datePart && !timePart) {
      return "-";
    }
    if (!timePart) {
      return datePart;
    }
    return `${datePart} ${timePart}`;
  }

  function createEmptyRow() {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="7" class="empty-bookings">No bookings found yet.</td>';
    return row;
  }

  function createErrorRow(message) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7" class="empty-bookings">${escapeHtml(message)}</td>`;
    return row;
  }

  // Create action buttons based on booking status
  function createActionsCell(booking) {
    // Show pay button for Pending Payment status
    if (booking.status === "Pending Payment") {
      return `
        <div class="table-action-group">
          <button type="button" class="table-action-btn pay" data-action="pay" data-booking-id="${booking.id}">
            Pay Now
          </button>
        </div>
      `;
    }
    
    // Show cancel button for Requested or Confirmed status
    if (booking.status === "Requested" || booking.status === "Confirmed") {
      return `
        <div class="table-action-group">
          <button type="button" class="table-action-btn cancel" data-action="cancel" data-booking-id="${booking.id}">
            Cancel
          </button>
        </div>
      `;
    }

    return '<span class="table-no-action">—</span>';
  }

  function createBookingRow(booking) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(formatBookingId(booking.id))}</td>
      <td>${escapeHtml(booking.service || "-")}</td>
      <td>${escapeHtml(booking.consultantName || "-")}</td>
      <td>${escapeHtml(formatDateTime(booking.bookingDate, booking.bookingTime))}</td>
      <td><span class="status-pill ${getStatusClass(booking.status)}">${escapeHtml(booking.status)}</span></td>
      <td>${escapeHtml(booking.price || "-")}</td>
      <td>${createActionsCell(booking)}</td>
    `;
    return row;
  }

  function updateMetricCards(bookings) {
    const totalBookings = bookings.length;
    const todayDate = new Date().toISOString().slice(0, 10);
    
    const upcomingBookings = bookings.filter((booking) => {
      const bookingDate = String(booking.bookingDate || "").slice(0, 10);
      return UPCOMING_STATUSES.has(booking.status) && bookingDate >= todayDate;
    }).length;
    
    const completedBookings = bookings.filter((booking) => {
      return COMPLETED_STATUSES.has(booking.status);
    }).length;

    if (totalBookingsCount) {
      totalBookingsCount.innerText = String(totalBookings);
    }
    if (upcomingBookingsCount) {
      upcomingBookingsCount.innerText = String(upcomingBookings);
    }
    if (completedBookingsCount) {
      completedBookingsCount.innerText = String(completedBookings);
    }
  }

  async function renderBookings() {
    bookingsTableBody.innerHTML = "";

    try {
      const bookings = await window.BookingStore.getBookings();
      updateMetricCards(bookings);

      if (!bookings.length) {
        bookingsTableBody.appendChild(createEmptyRow());
        return;
      }

      bookings.forEach((booking) => {
        bookingsTableBody.appendChild(createBookingRow(booking));
      });
    } catch (error) {
      bookingsTableBody.appendChild(
        createErrorRow(error.message || "Failed to load bookings.")
      );
    }
  }

  // Handle action button clicks (Pay or Cancel)
  bookingsTableBody.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("button[data-action]");
    if (!actionButton) {
      return;
    }

    const actionType = actionButton.dataset.action;
    const bookingId = Number(actionButton.dataset.bookingId);
    if (!Number.isInteger(bookingId)) {
      return;
    }

    // Determine next status based on action
    let nextStatus;
    if (actionType === "pay") {
      nextStatus = "Paid";
    } else if (actionType === "cancel") {
      nextStatus = "Cancelled";
    } else {
      return;
    }

    // Confirm cancellation
    if (actionType === "cancel") {
      if (!confirm("Are you sure you want to cancel this booking?")) {
        return;
      }
    }

    // Confirm payment
    if (actionType === "pay") {
      if (!confirm("Proceed to payment?")) {
        return;
      }
    }

    actionButton.disabled = true;
    const originalText = actionButton.textContent;
    actionButton.textContent = actionType === "pay" ? "Processing..." : "Cancelling...";

    try {
      await window.BookingStore.updateBookingStatus(bookingId, nextStatus, "client");
      // Show success message
      alert(`Booking ${actionType === "pay" ? "payment initiated" : "cancelled"} successfully!`);
      renderBookings();
    } catch (error) {
      alert(error.message || `Failed to ${actionType} booking.`);
    } finally {
      actionButton.disabled = false;
      actionButton.textContent = originalText;
    }
  });

  // Subscribe to real-time updates
  unsubscribe = window.BookingStore.subscribe(() => {
    renderBookings();
  });

  window.addEventListener("beforeunload", () => {
    if (unsubscribe) {
      unsubscribe();
    }
  });

  // Initial render
  renderBookings();
});