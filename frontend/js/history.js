document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.getElementById("payHistoryBody");
  if (!tableBody || !window.BookingStore) return;

  let isRendering = false;
  let unsubscribe = null;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatBookingId(rawId) {
    const text = String(rawId || "").trim();
    if (/^bk_/i.test(text)) {
      return text.replace(/^bk_/i, "BK-");
    }

    const n = Number(rawId);
    return Number.isInteger(n)
      ? `BK-${String(n).padStart(3, "0")}`
      : `BK-${escapeHtml(String(rawId || "-"))}`;
  }

  function derivePaymentStatus(booking) {
    if (booking.paymentStatus) return booking.paymentStatus;
    if (booking.refundTransactionId) return "Refunded";
    if (booking.status === "Pending Payment") return "Pending";
    if (booking.status === "Paid" || booking.status === "Completed") return "Success";
    return "-";
  }

  function paymentStatusClass(paymentStatus) {
    if (paymentStatus === "Pending") return "status-pending";
    if (paymentStatus === "Success") return "status-paid";
    if (paymentStatus === "Refunded") return "status-cancelled";
    return "status-requested";
  }

  function isPaymentHistoryRow(booking) {
    if (booking.paymentStatus) return true;
    if (booking.paymentTransactionId) return true;
    if (booking.refundTransactionId) return true;
    if (booking.status === "Pending Payment") return true;
    return false;
  }

  function getUpdatedTimestamp(booking) {
    return booking.refundProcessedAt || booking.paymentProcessedAt || booking.updatedAt || booking.createdAt;
  }

  async function loadHistory() {
    if (isRendering) return;
    isRendering = true;

    tableBody.innerHTML = '<tr><td colspan="7" class="empty-bookings">Loading&hellip;</td></tr>';

    try {
      const allBookings = await window.BookingStore.getBookings();
      const rows = allBookings
        .filter((booking) => isPaymentHistoryRow(booking))
        .sort((a, b) => {
          return new Date(getUpdatedTimestamp(b)).getTime() - new Date(getUpdatedTimestamp(a)).getTime();
        });

      if (!rows.length) {
        tableBody.innerHTML = '<tr><td colspan="7" class="empty-bookings">No payment history yet.</td></tr>';
        return;
      }

      tableBody.innerHTML = rows.map((booking) => {
        const paymentStatus = derivePaymentStatus(booking);
        const updatedAt = getUpdatedTimestamp(booking);
        const updatedDate = updatedAt ? new Date(updatedAt).toLocaleString("en-CA") : "-";

        return `
          <tr>
            <td>${escapeHtml(formatBookingId(booking.bookingRef || booking.id))}</td>
            <td>${escapeHtml(booking.service || "-")}</td>
            <td>${escapeHtml(booking.price || "-")}</td>
            <td><span class="status-pill ${paymentStatusClass(paymentStatus)}">${escapeHtml(paymentStatus)}</span></td>
            <td>${escapeHtml(booking.paymentTransactionId || "-")}</td>
            <td>${escapeHtml(booking.refundTransactionId || "-")}</td>
            <td>${escapeHtml(updatedDate)}</td>
          </tr>
        `;
      }).join("");
    } catch (error) {
      tableBody.innerHTML = `<tr><td colspan="7" class="empty-bookings">${escapeHtml(error.message || "Failed to load payment history.")}</td></tr>`;
    } finally {
      isRendering = false;
    }
  }

  unsubscribe = window.BookingStore.subscribe(() => {
    loadHistory();
  });

  window.addEventListener("beforeunload", () => {
    if (unsubscribe) unsubscribe();
  });

  loadHistory();
});
