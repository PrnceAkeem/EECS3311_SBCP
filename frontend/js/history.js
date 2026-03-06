document.addEventListener("DOMContentLoaded", () => {
  // Payment History page:
  // - Fetches all bookings via BookingStore (same REST endpoint as booking.js)
  // - Filters for Paid and Completed bookings only
  // - Subscribes to SSE so the table updates live when a payment is processed
  const tableBody = document.getElementById("payHistoryBody");
  if (!tableBody || !window.BookingStore) return;

  const PAID_STATUSES = new Set(["Paid", "Completed"]);
  let isRendering = false;
  let unsubscribe = null;

  function escapeHtml(v) {
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Same format as booking.js — BK-001, BK-002, etc.
  function formatBookingId(rawId) {
    const n = Number(rawId);
    return Number.isInteger(n) ? `BK-${String(n).padStart(3, "0")}` : `BK-${escapeHtml(String(rawId))}`;
  }

  function getStatusClass(status) {
    if (status === "Paid") return "status-paid";
    if (status === "Completed") return "status-completed";
    return "";
  }

  async function loadHistory() {
    if (isRendering) return;
    isRendering = true;
    tableBody.innerHTML = '<tr><td colspan="5" class="empty-bookings">Loading&hellip;</td></tr>';
    try {
      const all = await window.BookingStore.getBookings();
      const paid = all.filter((b) => PAID_STATUSES.has(b.status));

      if (!paid.length) {
        tableBody.innerHTML = '<tr><td colspan="5" class="empty-bookings">No payment history yet.</td></tr>';
        return;
      }

      tableBody.innerHTML = paid.map((b) => `
        <tr>
          <td>${escapeHtml(formatBookingId(b.id))}</td>
          <td>${escapeHtml(b.service || "-")}</td>
          <td>${escapeHtml(b.price || "-")}</td>
          <td>${escapeHtml(String(b.bookingDate || "-").slice(0, 10))}</td>
          <td><span class="status-pill ${getStatusClass(b.status)}">${escapeHtml(b.status)}</span></td>
        </tr>
      `).join("");
    } catch (error) {
      tableBody.innerHTML = `<tr><td colspan="5" class="empty-bookings">${escapeHtml(error.message || "Failed to load payment history.")}</td></tr>`;
    } finally {
      isRendering = false;
    }
  }

  // SSE subscription — table updates live when any booking status changes
  unsubscribe = window.BookingStore.subscribe(() => loadHistory());

  window.addEventListener("beforeunload", () => {
    if (unsubscribe) unsubscribe();
  });

  loadHistory();
});
