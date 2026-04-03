document.addEventListener("DOMContentLoaded", () => {
  // Interaction map:
  // - Reads and subscribes through BookingStore (frontend/js/bookings-data.js).
  // - BookingStore talks to backend REST + SSE endpoints in server.js.
  // - Payment metadata sent from here is consumed by backend Strategy pattern.
  const bookingsTableBody     = document.getElementById("bookingsTableBody");
  const totalBookingsCount    = document.getElementById("totalBookingsCount");
  const upcomingBookingsCount = document.getElementById("upcomingBookingsCount");
  const completedBookingsCount = document.getElementById("completedBookingsCount");

  if (!bookingsTableBody || !window.BookingStore) {
    return;
  }

  const UPCOMING_STATUSES  = new Set(["Requested", "Confirmed", "Pending Payment", "Paid"]);
  const COMPLETED_STATUSES = new Set(["Completed"]);

  // Guard flag — prevents two concurrent renderBookings() calls from
  // stomping on each other (e.g. manual call + SSE callback at the same time).
  let isRendering = false;

  // Each time the payment modal opens this counter increments.
  // The fetch callback checks the counter before touching the DOM so that
  // a stale response from a closed modal cannot render into a new one.
  let currentModalId = 0;

  let unsubscribe = null;

  // Small utilities

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getStatusClass(status) {
    if (status === "Confirmed")       return "status-confirmed";
    if (status === "Rejected")        return "status-rejected";
    if (status === "Cancelled")       return "status-cancelled";
    if (status === "Paid")            return "status-paid";
    if (status === "Completed")       return "status-completed";
    if (status === "Pending Payment") return "status-pending";
    return "status-requested";
  }

  function formatBookingId(rawId) {
    const n = Number(rawId);
    return Number.isInteger(n) ? `BK-${String(n).padStart(3, "0")}` : `BK-${escapeHtml(rawId)}`;
  }

  function formatDateTime(bookingDate, bookingTime) {
    const d = String(bookingDate || "").slice(0, 10);
    const t = String(bookingTime || "").trim();
    if (!d && !t) return "-";
    return t ? `${d} ${t}` : d;

  }

  // Table row builders

  // Which buttons appear depends entirely on the booking's current status.
  // Cancel is available while the booking has not been finalized.
  // "Pay Now" only appears when the consultant has set status to "Pending Payment".
  function createActionsCell(booking) {
    const buttons = [];

    if (["Requested", "Confirmed", "Pending Payment"].includes(booking.status)) {
      buttons.push(`
        <button type="button" class="table-action-btn cancel"
                data-action="cancel" data-booking-id="${booking.id}">
          Cancel
        </button>`);
        
    }

    if (booking.status === "Pending Payment") {
      buttons.push(`
        <button type="button" class="table-action-btn pay"
                data-action="pay" data-booking-id="${booking.id}">
          Pay Now
        </button>`);
    }

    if (!buttons.length) {
      return '<span class="table-no-action">—</span>';
    }
    return `<div class="table-action-group">${buttons.join("")}</div>`;
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

  // Metric cards

  function updateMetricCards(bookings) {
    const total   = bookings.length;
    const today   = new Date().toISOString().slice(0, 10);
    const upcoming = bookings.filter(
      (b) => UPCOMING_STATUSES.has(b.status) && String(b.bookingDate || "").slice(0, 10) >= today
    ).length;
    const completed = bookings.filter((b) => COMPLETED_STATUSES.has(b.status)).length;

    if (totalBookingsCount)     totalBookingsCount.innerText     = String(total);
    if (upcomingBookingsCount)  upcomingBookingsCount.innerText  = String(upcoming);
    if (completedBookingsCount) completedBookingsCount.innerText = String(completed);
  }

  // ==========================================================================
  // Render bookings table
  // isRendering flag stops a second concurrent fetch from running if the
  // SSE callback and a manual call both fire within the same tick.
  // ==========================================================================

  async function renderBookings() {
    if (isRendering) return;
    isRendering = true;
    bookingsTableBody.innerHTML = "";
    try {
      const bookings = await window.BookingStore.getBookings();
      updateMetricCards(bookings);
      if (!bookings.length) {
        const empty = document.createElement("tr");
        empty.innerHTML = '<td colspan="7" class="empty-bookings">No bookings found yet.</td>';
        bookingsTableBody.appendChild(empty);
        return;
      }
      bookings.forEach((b) => bookingsTableBody.appendChild(createBookingRow(b)));
    } catch (error) {
      const errRow = document.createElement("tr");
      errRow.innerHTML = `<td colspan="7" class="empty-bookings">${escapeHtml(error.message || "Failed to load bookings.")}</td>`;
      bookingsTableBody.appendChild(errRow);
    } finally {
      isRendering = false;
    }
  }

  // ==========================================================================
  // Payment Modal
  //
  // Flow:
  //   1. Client clicks "Pay Now" on a Pending Payment booking
  //   2. Modal opens and fetches saved payment methods from the API
  //   3. Client selects a method and clicks "Confirm Payment"
  //   4. A 2-second spinner simulates payment processing
  //   5. API call moves booking status to "Paid"
  //   6. Success screen shown, modal auto-closes, table refreshes
  //
  // Bug prevention: currentModalId increments every open. The fetch .then()
  // checks the ID before touching the DOM — if the user closed the modal
  // before the fetch finished, the stale response is silently discarded.
  // ==========================================================================

  function openPaymentModal(bookingId) {
    // Remove any leftover modal (e.g. user opened one, then clicked another row)
    const old = document.getElementById("paymentModal");
    if (old) old.remove();

    const modalId = ++currentModalId;

    const modal = document.createElement("div");
    modal.id = "paymentModal";
    modal.className = "pay-modal-overlay";
    modal.innerHTML = `
      <div class="pay-modal">
        <button type="button" class="pay-modal-close" id="payModalClose" aria-label="Close">&#x2715;</button>
        <div class="pay-modal-header">
          <h2>Complete Payment</h2>
          <p class="pay-modal-sub">Booking <strong>${escapeHtml(formatBookingId(bookingId))}</strong></p>
        </div>
        <div id="payModalBody" class="pay-modal-body">
          <p class="pay-modal-loading">Loading payment methods&hellip;</p>
        </div>
        <div class="pay-modal-footer" id="payModalFooter" style="display:none;">
          <button type="button" class="action-btn" id="payConfirmBtn">Confirm Payment</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Close on backdrop click or X
    modal.addEventListener("click", (e) => { if (e.target === modal) closePaymentModal(); });
    document.getElementById("payModalClose").addEventListener("click", closePaymentModal);

    //Fetch saved methods — check modalId before touching the DOM so stale
    //responses from a previously closed modal do nothing.
    fetch("/api/payment-methods")
      .then((r) => r.json())
      .then((methods) => {
        if (modalId !== currentModalId) return; // this modal was closed already
        renderMethodList(bookingId, methods);
      })
      .catch(() => {
        if (modalId !== currentModalId) return;
        renderMethodList(bookingId, []);
      });
  }

  function renderMethodList(bookingId, methods) {
    const body   = document.getElementById("payModalBody");
    const footer = document.getElementById("payModalFooter");
    if (!body) return;

    if (!methods.length) {
      // No saved methods — tell the client where to add one
      body.innerHTML = `
        <div class="pay-modal-empty">
          <p>You have no saved payment methods.</p>
          <a href="methods.html" class="pay-modal-link">Add a payment method &rarr;</a>
        </div>
      `;
      return;
    }

    // Render a radio list of the client's saved payment methods
    body.innerHTML = `
      <p class="pay-modal-hint">Select a payment method to complete your booking:</p>
      <div class="pay-method-list">
        ${methods.map((m) => `
          <label class="pay-method-item">
            <input type="radio" name="paymentMethod" value="${escapeHtml(m.id)}" />
            <span class="pay-method-info">
              <strong>${escapeHtml(m.type)}</strong>
              <span>${escapeHtml(m.label)}</span>
            </span>
          </label>
        `).join("")}
      </div>
    `;

    footer.style.display = "block";

    // { once: true } ensures this listener fires at most once, preventing
    // a stacked duplicate listener if renderMethodList is ever called again.
    document.getElementById("payConfirmBtn").addEventListener("click", () => {
      const selected = document.querySelector('input[name="paymentMethod"]:checked');
      if (!selected) {
        alert("Please select a payment method.");
        return;
      }
      const method = methods.find((m) => m.id === selected.value);
      if (!method) {
        alert("Selected payment method is no longer available.");
        return;
      }
      processPayment(bookingId, method);
    }, { once: true });
  }

  function processPayment(bookingId, method) {
    const body     = document.getElementById("payModalBody");
    const footer   = document.getElementById("payModalFooter");
    const closeBtn = document.getElementById("payModalClose");
    if (!body) return;

    // Lock the modal while processing — hide close and footer buttons
    if (footer)   footer.style.display   = "none";
    if (closeBtn) closeBtn.style.display = "none";

    body.innerHTML = `
      <div class="pay-processing">
        <div class="pay-spinner"></div>
        <p>Processing payment&hellip;</p>
        <p class="pay-processing-sub">Please do not close this window.</p>
      </div>
    `;

    // Simulate a 2-second processing delay, then call the status API.
    // The backend Strategy pattern generates the real transaction ID.
    setTimeout(async () => {
      try {
        const updatedBooking = await window.BookingStore.updateBookingStatus(
          bookingId,
          "Paid",
          "client",
          {
            paymentMethodId: method.id,
            paymentMethodType: method.type,
            paymentMethodLabel: method.label
          }
        );
        const txnId =
          updatedBooking && updatedBooking.payment
            ? updatedBooking.payment.transactionId
            : "";

        body.innerHTML = `
          <div class="pay-success">
            <div class="pay-success-icon">&#10003;</div>
            <p>Payment successful!</p>
            <p class="pay-processing-sub">Your booking is now Paid.</p>
            ${txnId ? `<p class="pay-processing-sub">Transaction ID: <strong>${escapeHtml(txnId)}</strong></p>` : ""}
          </div>
        `;

        // Auto-close after 1.8s and refresh the table
        setTimeout(() => {
          closePaymentModal();
          renderBookings();
        }, 1800);
      } catch (error) {
        // Payment failed — show the error and re-enable the close button
        body.innerHTML = `
          <div class="pay-error">
            <p>Payment failed: ${escapeHtml(error.message || "Unknown error.")}</p>
          </div>
        `;
        if (closeBtn) closeBtn.style.display = "";
      }
    }, 2000);
  }

  function closePaymentModal() {
    const modal = document.getElementById("paymentModal");
    if (modal) modal.remove();
  }

  // Table click handler (cancel and pay buttons)

  bookingsTableBody.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;

    const action    = btn.dataset.action;
    const bookingId = Number(btn.dataset.bookingId);
    if (!Number.isInteger(bookingId)) return;

    if (action === "pay") {
      openPaymentModal(bookingId);
      return;
    }

    // Cancel the booking
    btn.disabled = true;
    try {
      await window.BookingStore.updateBookingStatus(bookingId, "Cancelled", "client");
      // Re-render immediately. The SSE callback will also fire, but isRendering
      // prevents a second concurrent fetch from running.
      renderBookings();
    } catch (error) {
      alert(error.message || "Failed to cancel booking.");
      btn.disabled = false; // only re-enable on failure (row still exists)
    }
  });

  // SSE real-time updates — re-renders the table whenever any booking changes.
  // The isRendering guard prevents it from doubling up with manual calls above.
  unsubscribe = window.BookingStore.subscribe(() => {
    renderBookings();
  });

  window.addEventListener("beforeunload", () => {
    if (unsubscribe) unsubscribe();
  });

  renderBookings();
});
