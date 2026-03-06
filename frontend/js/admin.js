document.addEventListener("DOMContentLoaded", () => {
  // Admin page role:
  // - reads all bookings from BookingStore (REST)
  // - updates booking statuses through BookingStore (PATCH)
  // - receives live updates through BookingStore.subscribe (SSE)
  const tableBody = document.getElementById("adminBookingsBody");
  const toastEl   = document.getElementById("adminToast");

  // All valid booking statuses — must match the State Pattern on the backend.
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
  let isRendering = false; // prevents two concurrent renders from doubling up rows
  let toastTimer  = null;

  if (!tableBody || !window.BookingStore) {
    return;
  }

  // Shows a small popup notification at the bottom-right of the screen.
  // It fades out automatically after 3 seconds.
  function showToast(message) {
    toastEl.innerText = message;
    toastEl.classList.add("toast-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("toast-visible"), 3000);
  }

  // Formats a raw integer ID into BK-001 / CUS-001 style.
  // Matches the format used on booking.html and consultant.html.
  function formatId(prefix, rawId) {
    const n = Number(rawId);
    return Number.isInteger(n) ? `${prefix}-${String(n).padStart(3, "0")}` : `${prefix}-${rawId}`;
  }

  // Returns the CSS class for a status pill badge.
  function getStatusClass(status) {
    if (status === "Pending Payment") return "status-pending";
    if (status === "Confirmed")       return "status-confirmed";
    if (status === "Rejected")        return "status-rejected";
    if (status === "Paid")            return "status-paid";
    if (status === "Completed")       return "status-completed";
    if (status === "Cancelled")       return "status-cancelled";
    return "status-requested";
  }

  // Safely escapes any user-provided text before putting it into HTML.
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
    row.innerHTML = '<td colspan="9" class="empty-row">No bookings are available yet.</td>';
    return row;
  }

  // Builds the status dropdown for a booking row.
  // Valid next statuses are enabled; all others are shown but greyed out.
  // This mirrors the State Pattern validation on the backend.
  function createStatusOptions(selectedStatus) {
    return STATUS_OPTIONS.map((status) => {
      const isSelected = selectedStatus === status;
      const canMove    = window.BookingStore && window.BookingStore.canTransition(selectedStatus, status);
      const isEnabled  = isSelected || canMove;
      return `<option value="${status}" ${isSelected ? "selected" : ""} ${isEnabled ? "" : "disabled"}>${status}</option>`;
    }).join("");
  }

  // Builds a single table row for one booking.
  function createBookingRow(booking) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(formatId("BK",  booking.id))}</td>
      <td>${escapeHtml(formatId("CUS", booking.id))}</td>
      <td>${escapeHtml(booking.clientName     || "-")}</td>
      <td>${escapeHtml(booking.service        || "-")}</td>
      <td>${escapeHtml(booking.consultantName || "-")}</td>
      <td>${escapeHtml(booking.bookingDate    || "-")}</td>
      <td>${escapeHtml(booking.bookingTime    || "-")}</td>
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

  // Fetches all bookings and rebuilds the table.
  // The isRendering flag prevents two concurrent fetches from both appending
  // rows to the same tbody — which is what causes the duplication bug.
  async function renderBookings() {
    if (isRendering) return;
    isRendering = true;
    tableBody.innerHTML = "";

    try {
      const bookings = await window.BookingStore.getBookings();
      if (!bookings.length) {
        tableBody.appendChild(createEmptyRow());
        return;
      }
      bookings.forEach((booking) => tableBody.appendChild(createBookingRow(booking)));
    } catch (error) {
      const row = document.createElement("tr");
      row.innerHTML = `<td colspan="9" class="empty-row">${escapeHtml(error.message || "Failed to load bookings.")}</td>`;
      tableBody.appendChild(row);
    } finally {
      isRendering = false;
    }
  }

  // Save button click — sends the selected status to the backend.
  tableBody.addEventListener("click", async (event) => {
    const saveButton = event.target.closest('button[data-role="status-save"]');
    if (!saveButton) return;

    const bookingId     = Number(saveButton.dataset.bookingId);
    const selectElement = tableBody.querySelector(
      `select[data-role="status-select"][data-booking-id="${bookingId}"]`
    );
    if (!selectElement) return;

    saveButton.disabled = true;
    try {
      const updatedBooking = await window.BookingStore.updateBookingStatus(
        bookingId,
        selectElement.value,
        "admin"
      );
      showToast(`Booking updated to ${updatedBooking.status}.`);
      // The SSE subscription below will trigger renderBookings() automatically.
      // Calling it here too would cause the duplication bug, so we rely on SSE only.
    } catch (error) {
      showToast(error.message || "Could not update booking status.");
    } finally {
      saveButton.disabled = false;
    }
  });

  // SSE subscription — re-renders the table whenever any booking changes anywhere.
  unsubscribe = window.BookingStore.subscribe(() => renderBookings());

  window.addEventListener("beforeunload", () => {
    if (unsubscribe) unsubscribe();
  });

  renderBookings();
});
