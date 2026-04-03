document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.getElementById("consultantBookingsBody");
  const toastEl = document.getElementById("consultantToast");

  const availabilityConsultantName = document.getElementById("availabilityConsultantName");
  const availabilityDate = document.getElementById("availabilityDate");
  const availabilityTime = document.getElementById("availabilityTime");
  const addAvailabilityBtn = document.getElementById("addAvailabilityBtn");
  const availabilityTableBody = document.getElementById("availabilityTableBody");
  const registrationNameInput = document.getElementById("registrationNameInput");
  const registrationEmailInput = document.getElementById("registrationEmailInput");
  const registrationExpertiseInput = document.getElementById("registrationExpertiseInput");
  const submitRegistrationBtn = document.getElementById("submitRegistrationBtn");

  const STATUS_OPTIONS = [
    "Requested",
    "Confirmed",
    "Pending Payment",
    "Rejected",
    "Cancelled",
    "Paid",
    "Completed"
  ];

  const HARDCODED_EXPERTISE_OPTIONS = [
    "Software Architecture Review",
    "Cloud Migration Consulting",
    "Career Path Consulting",
    "Technical Interview Prep",
    "Startup Strategy Session",
    "Code Review & Mentorship"
  ];

  let unsubscribe = null;
  let isRendering = false;
  let toastTimer = null;

  if (!tableBody || !window.BookingStore) {
    return;
  }

  if (availabilityDate) {
    availabilityDate.min = new Date().toISOString().split("T")[0];
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

  function normalizeTime(value) {
    const raw = String(value || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");

    const match = raw.match(/^(0?[1-9]|1[0-2]):([0-5][0-9])\s(AM|PM)$/);
    if (!match) {
      return "";
    }

    const hour = String(Number(match[1])).padStart(2, "0");
    return `${hour}:${match[2]} ${match[3]}`;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function formatRef(prefix, rawId) {
    const n = Number(rawId);
    return Number.isInteger(n)
      ? `${prefix}-${String(n).padStart(3, "0")}`
      : `${prefix}-${escapeHtml(String(rawId || "-"))}`;
  }

  async function loadConsultants() {
    if (!availabilityConsultantName) return;

    const currentValue = availabilityConsultantName.value;

    try {
      const response = await fetch("/api/consultants");
      if (!response.ok) {
        throw new Error("Failed to load consultants.");
      }

      const consultants = await response.json();
      if (!Array.isArray(consultants) || !consultants.length) {
        availabilityConsultantName.innerHTML =
          '<option value="" selected disabled>No consultants available</option>';
        return;
      }

      availabilityConsultantName.innerHTML = [
        '<option value="" disabled>Select consultant</option>',
        ...consultants.map((consultant) => {
          const name = String(consultant.name || "").trim();
          const expertise = String(consultant.expertise || "general").trim();
          return `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${escapeHtml(expertise)})</option>`;
        })
      ].join("");

      const hasCurrent = consultants.some((consultant) => consultant.name === currentValue);
      availabilityConsultantName.value = hasCurrent
        ? currentValue
        : String(consultants[0].name || "");
    } catch (error) {
      availabilityConsultantName.innerHTML =
        '<option value="" selected disabled>Unable to load consultants</option>';
      showToast(error.message || "Could not load consultants.");
    }
  }

  async function loadRegistrationExpertiseOptions() {
    if (!registrationExpertiseInput) {
      return;
    }

    registrationExpertiseInput.innerHTML =
      '<option value="" selected disabled>Loading expertise...</option>';

    try {
      const response = await fetch("/api/policies/expertise-options");
      if (!response.ok) {
        throw new Error("Failed to load expertise options.");
      }

      const options = await response.json();
      const expertiseValues = options
        .map((item) => String(item?.name || "").trim())
        .filter(Boolean);

      if (!expertiseValues.length) {
        throw new Error("No expertise options found.");
      }

      registrationExpertiseInput.innerHTML = [
        '<option value="" disabled>Select expertise</option>',
        ...expertiseValues.map((name) => (
          `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
        ))
      ].join("");
      registrationExpertiseInput.value = expertiseValues[0];
    } catch (error) {
      registrationExpertiseInput.innerHTML = [
        '<option value="" disabled>Select expertise</option>',
        ...HARDCODED_EXPERTISE_OPTIONS.map((name) => (
          `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
        ))
      ].join("");
      registrationExpertiseInput.value = HARDCODED_EXPERTISE_OPTIONS[0];
      showToast(error.message || "Using default expertise options.");
    }
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
      <td>${escapeHtml(formatRef("BK", booking.id))}</td>
      <td>${escapeHtml(formatRef("CUS", booking.id))}</td>
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
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="9" class="empty-row">No bookings are available yet.</td>';
        tableBody.appendChild(row);
        return;
      }

      bookings.forEach((booking) => {
        tableBody.appendChild(createBookingRow(booking));
      });
    } catch (error) {
      const row = document.createElement("tr");
      row.innerHTML = `<td colspan="9" class="empty-row">${escapeHtml(error.message || "Failed to load bookings.")}</td>`;
      tableBody.appendChild(row);
    } finally {
      isRendering = false;
    }
  }

  async function loadAvailability() {
    if (!availabilityTableBody) return;

    const consultantName = availabilityConsultantName.value.trim();
    if (!consultantName) {
      availabilityTableBody.innerHTML = '<tr><td colspan="6" class="empty-row">Select a consultant to view availability.</td></tr>';
      return;
    }

    availabilityTableBody.innerHTML = '<tr><td colspan="6" class="empty-row">Loading availability...</td></tr>';

    try {
      const params = new URLSearchParams({ consultantName });
      const response = await fetch(`/api/availability?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to load availability.");
      }

      const slots = await response.json();
      if (!slots.length) {
        availabilityTableBody.innerHTML = '<tr><td colspan="6" class="empty-row">No availability slots yet.</td></tr>';
        return;
      }

      availabilityTableBody.innerHTML = slots.map((slot) => {
        const availabilityText = slot.isAvailable ? "Available" : "Booked";
        return `
          <tr>
            <td>${escapeHtml(slot.id)}</td>
            <td>${escapeHtml(slot.consultantName)}</td>
            <td>${escapeHtml(slot.bookingDate)}</td>
            <td>${escapeHtml(slot.bookingTime)}</td>
            <td>${escapeHtml(availabilityText)}</td>
            <td>
              <button type="button" class="table-action-btn cancel" data-role="remove-slot" data-slot-id="${escapeHtml(slot.id)}" ${slot.isAvailable ? "" : "disabled"}>Remove</button>
            </td>
          </tr>
        `;
      }).join("");
    } catch (error) {
      availabilityTableBody.innerHTML = `<tr><td colspan="6" class="empty-row">${escapeHtml(error.message || "Failed to load availability.")}</td></tr>`;
    }
  }

  async function addAvailability() {
    const consultantName = availabilityConsultantName.value.trim();
    const bookingDate = availabilityDate.value;
    const bookingTime = normalizeTime(availabilityTime.value);

    if (!consultantName || !bookingDate || !bookingTime) {
      showToast("Consultant name, date, and time are required.");
      return;
    }

    addAvailabilityBtn.disabled = true;
    try {
      const response = await fetch("/api/availability", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ consultantName, bookingDate, bookingTime })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to add availability slot.");
      }

      availabilityTime.value = "";
      showToast("Availability slot saved.");
      await loadAvailability();
    } catch (error) {
      showToast(error.message || "Could not add slot.");
    } finally {
      addAvailabilityBtn.disabled = false;
    }
  }

  async function removeAvailability(slotId, buttonEl) {
    buttonEl.disabled = true;
    try {
      const response = await fetch(`/api/availability/${encodeURIComponent(slotId)}`, {
        method: "DELETE"
      });

      if (!response.ok && response.status !== 204) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to remove availability slot.");
      }

      showToast("Availability slot removed.");
      await loadAvailability();
    } catch (error) {
      showToast(error.message || "Could not remove slot.");
      buttonEl.disabled = false;
    }
  }

  async function submitRegistration() {
    const name = String(registrationNameInput?.value || "").trim();
    const email = String(registrationEmailInput?.value || "").trim().toLowerCase();
    const expertise = String(registrationExpertiseInput?.value || "").trim();

    if (!name || !email || !expertise) {
      showToast("Name, email, and expertise are required.");
      return;
    }
    if (!isValidEmail(email)) {
      showToast("Email format is invalid.");
      return;
    }

    submitRegistrationBtn.disabled = true;
    try {
      const response = await fetch("/api/consultants/registrations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          email,
          expertise
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to submit registration.");
      }

      registrationNameInput.value = "";
      registrationEmailInput.value = "";
      showToast("Registration submitted. Wait for admin approval.");
    } catch (error) {
      showToast(error.message || "Could not submit registration.");
    } finally {
      submitRegistrationBtn.disabled = false;
    }
  }

  addAvailabilityBtn.addEventListener("click", addAvailability);
  if (submitRegistrationBtn) {
    submitRegistrationBtn.addEventListener("click", submitRegistration);
  }
  availabilityConsultantName.addEventListener("change", () => {
    loadAvailability();
  });

  availabilityTableBody.addEventListener("click", async (event) => {
    const removeButton = event.target.closest('button[data-role="remove-slot"]');
    if (!removeButton) return;

    const slotId = Number(removeButton.dataset.slotId);
    if (!Number.isInteger(slotId)) return;

    await removeAvailability(slotId, removeButton);
  });

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
      showToast(`Booking updated to ${updatedBooking.status}.`);
      await loadAvailability();
    } catch (error) {
      showToast(error.message || "Could not update booking status.");
    } finally {
      saveButton.disabled = false;
    }
  });

  unsubscribe = window.BookingStore.subscribe(() => {
    renderBookings();
    loadAvailability();
  });

  window.addEventListener("beforeunload", () => {
    if (unsubscribe) {
      unsubscribe();
    }
  });

  renderBookings();
  loadRegistrationExpertiseOptions();
  loadConsultants().then(() => {
    loadAvailability();
  });
});
