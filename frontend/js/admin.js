document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.getElementById("adminBookingsBody");
  const toastEl = document.getElementById("adminToast");

  const registrationTableBody = document.getElementById("registrationTableBody");

  const policyCancellationWindow = document.getElementById("policyCancellationWindow");
  const policyPricingMultiplier = document.getElementById("policyPricingMultiplier");
  const policyNotificationsEnabled = document.getElementById("policyNotificationsEnabled");
  const policyRefundPolicy = document.getElementById("policyRefundPolicy");
  const savePoliciesBtn = document.getElementById("savePoliciesBtn");

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
  let isRendering = false;
  let toastTimer = null;

  if (!tableBody || !window.BookingStore) {
    return;
  }

  function showToast(message) {
    toastEl.innerText = message;
    toastEl.classList.add("toast-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("toast-visible"), 3000);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatRef(prefix, value, fallbackId) {
    const text = String(value || "").trim();
    if (text) {
      return text.replace(/^bk_/i, "BK-").replace(/^cu_/i, "CUS-");
    }

    const n = Number(fallbackId);
    return Number.isInteger(n)
      ? `${prefix}-${String(n).padStart(3, "0")}`
      : `${prefix}-${escapeHtml(String(fallbackId || "-"))}`;
  }

  function getStatusClass(status) {
    if (status === "Pending Payment") return "status-pending";
    if (status === "Confirmed") return "status-confirmed";
    if (status === "Rejected") return "status-rejected";
    if (status === "Paid") return "status-paid";
    if (status === "Completed") return "status-completed";
    if (status === "Cancelled") return "status-cancelled";
    return "status-requested";
  }

  function createStatusOptions(selectedStatus) {
    return STATUS_OPTIONS.map((status) => {
      const isSelected = selectedStatus === status;
      const canMove = window.BookingStore && window.BookingStore.canTransition(selectedStatus, status);
      const isEnabled = isSelected || canMove;
      return `<option value="${status}" ${isSelected ? "selected" : ""} ${isEnabled ? "" : "disabled"}>${status}</option>`;
    }).join("");
  }

  function createBookingRow(booking) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(formatRef("BK", booking.bookingRef, booking.id))}</td>
      <td>${escapeHtml(formatRef("CUS", booking.customerId, booking.id))}</td>
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
    if (isRendering) return;
    isRendering = true;
    tableBody.innerHTML = "";

    try {
      const bookings = await window.BookingStore.getBookings();
      if (!bookings.length) {
        tableBody.innerHTML = '<tr><td colspan="9" class="empty-row">No bookings are available yet.</td></tr>';
        return;
      }

      bookings.forEach((booking) => {
        tableBody.appendChild(createBookingRow(booking));
      });
    } catch (error) {
      tableBody.innerHTML = `<tr><td colspan="9" class="empty-row">${escapeHtml(error.message || "Failed to load bookings.")}</td></tr>`;
    } finally {
      isRendering = false;
    }
  }

  async function loadRegistrations() {
    if (!registrationTableBody) return;

    registrationTableBody.innerHTML = '<tr><td colspan="6" class="empty-row">Loading registrations...</td></tr>';

    try {
      const response = await fetch("/api/consultants/registrations");
      if (!response.ok) {
        throw new Error("Failed to load consultant registrations.");
      }

      const registrations = await response.json();
      if (!registrations.length) {
        registrationTableBody.innerHTML = '<tr><td colspan="6" class="empty-row">No consultant registrations submitted yet.</td></tr>';
        return;
      }

      registrationTableBody.innerHTML = registrations.map((registration) => {
        const canReview = registration.status === "Pending";
        return `
          <tr>
            <td>${escapeHtml(registration.id)}</td>
            <td>${escapeHtml(registration.name)}</td>
            <td>${escapeHtml(registration.email)}</td>
            <td>${escapeHtml(registration.expertise || "-")}</td>
            <td>${escapeHtml(registration.status)}</td>
            <td>
              ${canReview ? `
                <div class="table-action-group">
                  <button type="button" class="table-action-btn pay" data-role="registration-action" data-status="Approved" data-registration-id="${escapeHtml(registration.id)}">Approve</button>
                  <button type="button" class="table-action-btn cancel" data-role="registration-action" data-status="Rejected" data-registration-id="${escapeHtml(registration.id)}">Reject</button>
                </div>
              ` : "<span class='table-no-action'>Reviewed</span>"}
            </td>
          </tr>
        `;
      }).join("");
    } catch (error) {
      registrationTableBody.innerHTML = `<tr><td colspan="6" class="empty-row">${escapeHtml(error.message || "Failed to load registrations.")}</td></tr>`;
    }
  }

  async function reviewRegistration(registrationId, status, buttonEl) {
    buttonEl.disabled = true;
    try {
      const response = await fetch(`/api/consultants/registrations/${encodeURIComponent(registrationId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          status,
          actor: "admin"
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to update consultant registration.");
      }

      showToast(`Registration ${status.toLowerCase()}.`);
      await loadRegistrations();
    } catch (error) {
      showToast(error.message || "Could not review registration.");
      buttonEl.disabled = false;
    }
  }

  async function loadPolicies() {
    try {
      const response = await fetch("/api/policies");
      if (!response.ok) {
        throw new Error("Failed to load policies.");
      }

      const policies = await response.json();
      policyCancellationWindow.value = policies.cancellationWindowHours;
      policyPricingMultiplier.value = policies.pricingMultiplier;
      policyNotificationsEnabled.value = String(Boolean(policies.notificationsEnabled));
      policyRefundPolicy.value = policies.refundPolicy || "";
    } catch (error) {
      showToast(error.message || "Could not load system policies.");
    }
  }

  async function savePolicies() {
    const payload = {
      cancellationWindowHours: Number(policyCancellationWindow.value),
      pricingMultiplier: Number(policyPricingMultiplier.value),
      notificationsEnabled: policyNotificationsEnabled.value === "true",
      refundPolicy: policyRefundPolicy.value.trim()
    };

    savePoliciesBtn.disabled = true;
    try {
      const response = await fetch("/api/policies", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save policies.");
      }

      showToast("System policies saved.");
      await loadPolicies();
    } catch (error) {
      showToast(error.message || "Could not save policies.");
    } finally {
      savePoliciesBtn.disabled = false;
    }
  }

  tableBody.addEventListener("click", async (event) => {
    const saveButton = event.target.closest('button[data-role="status-save"]');
    if (!saveButton) return;

    const bookingId = Number(saveButton.dataset.bookingId);
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
    } catch (error) {
      showToast(error.message || "Could not update booking status.");
    } finally {
      saveButton.disabled = false;
    }
  });

  registrationTableBody.addEventListener("click", async (event) => {
    const actionButton = event.target.closest('button[data-role="registration-action"]');
    if (!actionButton) return;

    const registrationId = actionButton.dataset.registrationId;
    const status = actionButton.dataset.status;

    if (!registrationId || !status) return;

    await reviewRegistration(registrationId, status, actionButton);
  });

  savePoliciesBtn.addEventListener("click", savePolicies);

  unsubscribe = window.BookingStore.subscribe(() => {
    renderBookings();
  });

  window.addEventListener("beforeunload", () => {
    if (unsubscribe) unsubscribe();
  });

  renderBookings();
  loadRegistrations();
  loadPolicies();
});
