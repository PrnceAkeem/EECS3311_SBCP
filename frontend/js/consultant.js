document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.getElementById("consultantBookingsBody");
  const toastEl = document.getElementById("consultantToast");

  const availabilityConsultantName = document.getElementById("availabilityConsultantName");
  const availabilityDate = document.getElementById("availabilityDate");
  const availabilitySlotPicker = document.getElementById("availabilitySlotPicker");
  const availabilitySlotBtns = document.querySelectorAll(".avail-slot-btn");
  const saveAvailabilityBtn = document.getElementById("saveAvailabilityBtn");
  const slotPickerHint = document.getElementById("slotPickerHint");
  const availabilityTableBody = document.getElementById("availabilityTableBody");

  // dbSlots: current slots in DB for the selected consultant+date
  // key = bookingTime string, value = { id, isAvailable }
  let dbSlots = {};
  // selectedTimes: Set of time strings the consultant has toggled on in the grid
  let selectedTimes = new Set();

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

  function renderSlotGrid() {
    availabilitySlotBtns.forEach((btn) => {
      const time = btn.dataset.time;
      const inDb = dbSlots[time];
      const booked = inDb && !inDb.isAvailable;

      btn.disabled = booked;
      btn.classList.remove("slot-selected", "slot-booked");

      if (booked) {
        btn.classList.add("slot-booked");
      } else if (selectedTimes.has(time)) {
        btn.classList.add("slot-selected");
      }
    });
  }

  async function loadAvailability() {
    const consultantName = availabilityConsultantName.value.trim();
    const bookingDate = availabilityDate.value;

    // Reset grid state
    dbSlots = {};
    selectedTimes = new Set();

    if (!consultantName) {
      availabilitySlotPicker.hidden = true;
      if (availabilityTableBody) {
        availabilityTableBody.innerHTML = '<tr><td colspan="6" class="empty-row">Select a consultant to view availability.</td></tr>';
      }
      return;
    }

    // Show the grid only when both consultant and date are chosen
    availabilitySlotPicker.hidden = !bookingDate;

    if (availabilityTableBody) {
      availabilityTableBody.innerHTML = '<tr><td colspan="6" class="empty-row">Loading availability...</td></tr>';
    }

    try {
      const params = new URLSearchParams({ consultantName });
      const response = await fetch(`/api/availability?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to load availability.");

      const allSlots = await response.json();

      if (availabilityTableBody) {
        if (!allSlots.length) {
          availabilityTableBody.innerHTML = '<tr><td colspan="6" class="empty-row">No availability slots yet.</td></tr>';
        } else {
          availabilityTableBody.innerHTML = allSlots.map((slot) => `
            <tr>
              <td>${escapeHtml(slot.id)}</td>
              <td>${escapeHtml(slot.consultantName)}</td>
              <td>${escapeHtml(slot.bookingDate)}</td>
              <td>${escapeHtml(slot.bookingTime)}</td>
              <td>${slot.isAvailable ? "Available" : "Booked"}</td>
              <td>
                <button type="button" class="table-action-btn cancel" data-role="remove-slot" data-slot-id="${escapeHtml(slot.id)}" ${slot.isAvailable ? "" : "disabled"}>Remove</button>
              </td>
            </tr>
          `).join("");
        }
      }

      // Pre-populate grid for the selected date
      if (bookingDate) {
        allSlots
          .filter((slot) => slot.bookingDate === bookingDate)
          .forEach((slot) => {
            dbSlots[slot.bookingTime] = { id: slot.id, isAvailable: slot.isAvailable };
            if (slot.isAvailable) {
              selectedTimes.add(slot.bookingTime);
            }
          });

        renderSlotGrid();
        const selectedCount = selectedTimes.size;
        slotPickerHint.textContent = selectedCount
          ? `${selectedCount} slot(s) currently available. Toggle to change, then save.`
          : "No slots set for this date. Click times to make them available.";
      }
    } catch (error) {
      if (availabilityTableBody) {
        availabilityTableBody.innerHTML = `<tr><td colspan="6" class="empty-row">${escapeHtml(error.message || "Failed to load availability.")}</td></tr>`;
      }
    }
  }

  async function saveAvailability() {
    const consultantName = availabilityConsultantName.value.trim();
    const bookingDate = availabilityDate.value;

    if (!consultantName || !bookingDate) {
      showToast("Select a consultant and date first.");
      return;
    }

    saveAvailabilityBtn.disabled = true;

    try {
      const toAdd = [];
      const toRemove = [];

      availabilitySlotBtns.forEach((btn) => {
        const time = btn.dataset.time;
        const inDb = dbSlots[time];
        const isSelected = selectedTimes.has(time);

        if (isSelected && !inDb) {
          toAdd.push(time);
        } else if (!isSelected && inDb && inDb.isAvailable) {
          toRemove.push(inDb.id);
        }
      });

      await Promise.all([
        ...toAdd.map((bookingTime) =>
          fetch("/api/availability", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ consultantName, bookingDate, bookingTime })
          })
        ),
        ...toRemove.map((id) =>
          fetch(`/api/availability/${encodeURIComponent(id)}`, { method: "DELETE" })
        )
      ]);

      showToast("Availability saved.");
      await loadAvailability();
    } catch (error) {
      showToast(error.message || "Could not save availability.");
    } finally {
      saveAvailabilityBtn.disabled = false;
    }
  }

  // Toggle slot on click
  availabilitySlotBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const time = btn.dataset.time;
      if (selectedTimes.has(time)) {
        selectedTimes.delete(time);
      } else {
        selectedTimes.add(time);
      }
      renderSlotGrid();
    });
  });

  saveAvailabilityBtn.addEventListener("click", saveAvailability);

  availabilityConsultantName.addEventListener("change", loadAvailability);
  availabilityDate.addEventListener("change", loadAvailability);

  availabilityTableBody.addEventListener("click", async (event) => {
    const removeButton = event.target.closest('button[data-role="remove-slot"]');
    if (!removeButton) return;

    const slotId = Number(removeButton.dataset.slotId);
    if (!Number.isInteger(slotId)) return;

    removeButton.disabled = true;
    try {
      const response = await fetch(`/api/availability/${encodeURIComponent(slotId)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to remove slot.");
      }
      showToast("Slot removed.");
      await loadAvailability();
    } catch (error) {
      showToast(error.message || "Could not remove slot.");
      removeButton.disabled = false;
    }
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
  loadConsultants().then(() => {
    loadAvailability();
  });
});
