document.addEventListener("DOMContentLoaded", () => {
  const bookingsTableBody = document.getElementById("bookingsTableBody");
  const totalBookingsCount = document.getElementById("totalBookingsCount");
  const upcomingBookingsCount = document.getElementById("upcomingBookingsCount");
  const completedBookingsCount = document.getElementById("completedBookingsCount");

  if (!bookingsTableBody || !window.BookingStore) {
    return;
  }

  const UPCOMING_STATUSES = new Set(["Requested", "Confirmed", "Paid"]);
  const COMPLETED_STATUSES = new Set(["Completed"]);
  let unsubscribe = null;

  function getStatusClass(status) {
    if (status === "Confirmed") {
      return "status-confirmed";
    }
    if (status === "Rejected") {
      return "status-rejected";
    }
    if (status === "Cancelled") {
      return "status-cancelled";
    }
    if (status === "Paid") {
      return "status-paid";
    }
    if (status === "Completed") {
      return "status-completed";
    }
    return "status-requested";
  }

  function escapeHtml(value) {
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

  function createActionsCell(booking) {
    if (booking.status === "Confirmed") {
      return `
        <div class="table-action-group">
          <button type="button" class="table-action-btn cancel" data-action="cancel" data-booking-id="${booking.id}">
            Cancel
          </button>
          <button type="button" class="table-action-btn pay" data-action="pay" data-booking-id="${booking.id}">
            Pay
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

    const nextStatus = actionType === "pay" ? "Paid" : "Cancelled";
    actionButton.disabled = true;

    try {
      await window.BookingStore.updateBookingStatus(bookingId, nextStatus, "client");
      renderBookings();
    } catch (error) {
      alert(error.message || "Failed to update booking.");
    } finally {
      actionButton.disabled = false;
    }
  });

  unsubscribe = window.BookingStore.subscribe(() => {
    renderBookings();
  });

  window.addEventListener("beforeunload", () => {
    if (unsubscribe) {
      unsubscribe();
    }
  });

  renderBookings();
});
