document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.getElementById("adminBookingsBody");
  const messageElement = document.getElementById("adminMessage");
  const STATUS_OPTIONS = ["Requested", "Completed", "Cancelled"];

  if (!tableBody || !window.BookingStore) {
    return;
  }

  function getStatusClass(status) {
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
    return STATUS_OPTIONS.map((status) => {
      const selectedAttribute = selectedStatus === status ? "selected" : "";
      return `<option value="${status}" ${selectedAttribute}>${status}</option>`;
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

  function renderBookings() {
    const bookings = window.BookingStore.getBookings();
    tableBody.innerHTML = "";

    if (!bookings.length) {
      tableBody.appendChild(createEmptyRow());
      return;
    }

    bookings.forEach((booking) => {
      tableBody.appendChild(createBookingRow(booking));
    });
  }

  tableBody.addEventListener("click", (event) => {
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

    const updatedBooking = window.BookingStore.updateBookingStatus(
      bookingId,
      selectElement.value,
      "admin"
    );

    if (!updatedBooking) {
      messageElement.innerText = "Could not update booking status.";
      return;
    }

    messageElement.innerText = `Booking #${bookingId} updated to ${updatedBooking.status}.`;
    renderBookings();
  });

  renderBookings();
});
