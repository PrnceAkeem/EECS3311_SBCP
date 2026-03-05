document.addEventListener("DOMContentLoaded", () => {
  // Consultant page role:
  // - reads all bookings from BookingStore (REST)
  // - transitions booking statuses via BookingStore (PATCH)
  // - stays in sync via BookingStore.subscribe (SSE)
  const tableBody = document.getElementById("consultantBookingsBody");
  const messageElement = document.getElementById("consultantMessage");
  // All possible statuses — "Pending Payment" added to match the State Pattern.
  const STATUS_OPTIONS = [
    "Requested",
    "Confirmed",
    "Pending Payment",
    "Rejected",
    "Cancelled",
    "Paid",
    "Completed"
  ];
  let unsubscribe = null;

  if (!tableBody || !window.BookingStore) {
    return;
  }

  function getStatusClass(status) {
    if (status === "Pending Payment") {
      return "status-pending";
    }
    if (status === "Confirmed") {
      return "status-confirmed";
    }
    if (status === "Rejected") {
      return "status-rejected";
    }
    if (status === "Paid") {
      return "status-paid";
    }
    if (status === "Completed") {
      return "status-completed";
    }
    if (status === "Cancelled") {
      return "status-cancelled";
    }
    return "status-requested";
  }

  function createEmptyRow() {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="8" class="empty-row">No bookings are available yet.</td>';
    return row;
  }

  function createStatusOptions(selectedStatus) {
    // Show every possible status but disable the ones that are not valid
    // transitions from the current status. The current status is always shown
    // as selected and enabled (can't change away from it without picking a
    // valid next status). This mirrors the State Pattern on the backend.
    return STATUS_OPTIONS.map((status) => {
      const isSelected = selectedStatus === status;
      const canMove = window.BookingStore && window.BookingStore.canTransition(selectedStatus, status);
      // Keep the option visible but disabled so it's clear the path is blocked
      const isEnabled = isSelected || canMove;
      return `<option value="${status}" ${isSelected ? "selected" : ""} ${isEnabled ? "" : "disabled"}>${status}</option>`;
    }).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function createBookingRow(booking) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(booking.id)}</td>
      <td>${escapeHtml(booking.clientName || "-")}</td>
      <td>${escapeHtml(booking.service || "-")}</td>
      <td>${escapeHtml(booking.consultantName || "-")}</td>
      <td>${escapeHtml(booking.bookingDate || "-")}</td>
      <td>${escapeHtml(booking.bookingTime || "-")}</td>
      <td><span class="status-pill ${getStatusClass(booking.status)}">${escapeHtml(booking.status)}</span></td>
      <td>
        <div class="status-actions">
          <select data-role="status-select" data-booking-id="${booking.id}">
            ${createStatusOptions(booking.status)}
          </select>
          <button type="button" data-role="status-save" data-booking-id="${booking.id}">Save</button>
        </div>
      </td>
    `;
    return row;
  }

  async function renderBookings() {
    tableBody.innerHTML = "";

    try {
      const bookings = await window.BookingStore.getBookings();
      if (!bookings.length) {
        tableBody.appendChild(createEmptyRow());
        return;
      }

      bookings.forEach((booking) => {
        tableBody.appendChild(createBookingRow(booking));
      });
    } catch (error) {
      const row = document.createElement("tr");
      row.innerHTML = `<td colspan="8" class="empty-row">${escapeHtml(error.message || "Failed to load bookings.")}</td>`;
      tableBody.appendChild(row);
    }
  }

  tableBody.addEventListener("click", async (event) => {
    const saveButton = event.target.closest('button[data-role="status-save"]');
    if (!saveButton) {
      return;
    }

    const bookingId = Number(saveButton.dataset.bookingId);
    const selectElement = tableBody.querySelector(
      `select[data-role="status-select"][data-booking-id="${bookingId}"]`
    );
    if (!selectElement) {
      return;
    }

    saveButton.disabled = true;
    try {
      const updatedBooking = await window.BookingStore.updateBookingStatus(
        bookingId,
        selectElement.value,
        "consultant"
      );
      messageElement.innerText = `Booking #${bookingId} updated to ${updatedBooking.status}.`;
      renderBookings();
    } catch (error) {
      messageElement.innerText = error.message || "Could not update booking status.";
    } finally {
      saveButton.disabled = false;
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
