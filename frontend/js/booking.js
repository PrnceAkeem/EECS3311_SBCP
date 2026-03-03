document.addEventListener("DOMContentLoaded", () => {
  const bookingsTableBody = document.getElementById("bookingsTableBody");
  if (!bookingsTableBody || !window.BookingStore) {
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function createEmptyRow() {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="8" class="empty-bookings">No bookings found yet.</td>';
    return row;
  }

  function createBookingRow(booking) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <th scope="row">${escapeHtml(booking.id)}</th>
      <td>${escapeHtml(booking.service)}</td>
      <td>${escapeHtml(booking.consultantName)}</td>
      <td>${escapeHtml(booking.bookingDate)}</td>
      <td>${escapeHtml(booking.bookingTime)}</td>
      <td><span class="status-pill ${getStatusClass(booking.status)}">${escapeHtml(booking.status)}</span></td>
      <td>${escapeHtml(booking.price)}</td>
      <td>${escapeHtml(booking.updatedBy || "client")}</td>
    `;
    return row;
  }

  function renderBookings() {
    const bookings = window.BookingStore.getBookings();
    bookingsTableBody.innerHTML = "";

    if (!bookings.length) {
      bookingsTableBody.appendChild(createEmptyRow());
      return;
    }

    bookings.forEach((booking) => {
      bookingsTableBody.appendChild(createBookingRow(booking));
    });
  }

  renderBookings();
});
