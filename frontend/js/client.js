document.addEventListener("DOMContentLoaded", () => {
  const serviceNameElement = document.getElementById("serviceName");
  const servicePriceElement = document.getElementById("servicePrice");
  const bookingForm = document.getElementById("bookingForm");
  const bookingModal = document.getElementById("bookingModal");
  const closeBookingModalButton = document.getElementById("closeBookingModal");
  const cancelBookingButton = document.getElementById("cancelBookingButton");
  const confirmBookingButton = document.getElementById("confirmBookingButton");
  const clientNameInput = document.getElementById("clientName");
  const clientEmailInput = document.getElementById("clientEmail");
  const consultantNameSelect = document.getElementById("consultantName");
  const bookingDateInput = document.getElementById("bookingDate");
  const bookingTimeInput = document.getElementById("bookingTime");
  const serviceButtons = document.querySelectorAll(".service-book-btn");
  const timeSlotButtons = document.querySelectorAll(".time-slot-btn");
  const slotAvailabilityHint = document.getElementById("slotAvailabilityHint");

  if (bookingDateInput) {
    bookingDateInput.min = new Date().toISOString().split("T")[0];
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

  function setHint(message) {
    if (slotAvailabilityHint) {
      slotAvailabilityHint.innerText = message;
    }
  }

  function clearTimeSelection() {
    bookingTimeInput.value = "";
    timeSlotButtons.forEach((slotButton) => {
      slotButton.classList.remove("active");
    });
  }

  function disableAllSlots() {
    clearTimeSelection();
    timeSlotButtons.forEach((slotButton) => {
      slotButton.disabled = true;
    });
  }

  function applyAvailability(availableTimes) {
    clearTimeSelection();

    let enabledCount = 0;
    timeSlotButtons.forEach((slotButton) => {
      const normalized = normalizeTime(slotButton.innerText);
      const enabled = availableTimes.has(normalized);
      slotButton.disabled = !enabled;
      if (enabled) {
        enabledCount += 1;
      }
    });

    if (!enabledCount) {
      setHint("No available slots for this consultant on that date.");
      return;
    }

    setHint(`${enabledCount} slot(s) available. Select one to continue.`);
  }

  async function refreshAvailability() {
    const consultantName = consultantNameSelect.value;
    const bookingDate = bookingDateInput.value;

    if (!consultantName || !bookingDate) {
      disableAllSlots();
      setHint("Choose a consultant and date to load available slots.");
      return;
    }

    setHint("Loading available slots...");

    try {
      const params = new URLSearchParams({
        consultantName,
        bookingDate
      });

      const response = await fetch(`/api/availability?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Could not load consultant availability.");
      }

      const slots = await response.json();
      const availableTimes = new Set(
        slots
          .filter((slot) => slot && slot.isAvailable)
          .map((slot) => normalizeTime(slot.bookingTime))
          .filter(Boolean)
      );

      applyAvailability(availableTimes);
    } catch (error) {
      disableAllSlots();
      setHint(error.message || "Failed to load availability.");
    }
  }

  function openBookingModal() {
    bookingModal.hidden = false;
    document.body.style.overflow = "hidden";
    disableAllSlots();
    setHint("Choose a consultant and date to load available slots.");
  }

  function resetBookingForm() {
    if (bookingForm) {
      bookingForm.reset();
    }

    serviceNameElement.innerText = "--";
    servicePriceElement.innerText = "--";
    disableAllSlots();
    setHint("Choose a consultant and date to load available slots.");
  }

  function closeBookingModal() {
    bookingModal.hidden = true;
    document.body.style.overflow = "";
  }

  function validateBookingForm() {
    if (serviceNameElement.innerText === "--") {
      alert("Select a service first.");
      return false;
    }
    if (!clientNameInput.value.trim()) {
      alert("Enter your name.");
      return false;
    }
    if (!clientEmailInput.value.trim()) {
      alert("Enter your email.");
      return false;
    }
    if (!consultantNameSelect.value) {
      alert("Select a consultant.");
      return false;
    }
    if (!bookingDateInput.value) {
      alert("Select your preferred date.");
      return false;
    }
    if (!bookingTimeInput.value) {
      alert("Select an available time slot.");
      return false;
    }
    return true;
  }

  serviceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      serviceNameElement.innerText = button.dataset.service || "--";
      servicePriceElement.innerText = button.dataset.price || "--";
      openBookingModal();
      refreshAvailability();
    });
  });

  timeSlotButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) {
        return;
      }

      timeSlotButtons.forEach((slotButton) => {
        slotButton.classList.remove("active");
      });

      button.classList.add("active");
      bookingTimeInput.value = normalizeTime(button.innerText.trim());
    });
  });

  consultantNameSelect.addEventListener("change", () => {
    refreshAvailability();
  });

  bookingDateInput.addEventListener("change", () => {
    refreshAvailability();
  });

  confirmBookingButton.addEventListener("click", async () => {
    if (!validateBookingForm()) {
      return;
    }

    confirmBookingButton.disabled = true;
    try {
      await window.BookingStore.addBooking({
        service: serviceNameElement.innerText.trim(),
        price: servicePriceElement.innerText.trim(),
        clientName: clientNameInput.value.trim(),
        clientEmail: clientEmailInput.value.trim(),
        consultantName: consultantNameSelect.value,
        bookingDate: bookingDateInput.value,
        bookingTime: bookingTimeInput.value
      });

      alert("Booking submitted successfully. Status: Requested.");
      closeBookingModal();
      resetBookingForm();
      window.location.href = "booking.html";
    } catch (error) {
      alert(error.message || "Failed to submit booking.");
      await refreshAvailability();
    } finally {
      confirmBookingButton.disabled = false;
    }
  });

  closeBookingModalButton.addEventListener("click", () => {
    closeBookingModal();
    resetBookingForm();
  });

  cancelBookingButton.addEventListener("click", () => {
    closeBookingModal();
    resetBookingForm();
  });

  bookingModal.addEventListener("click", (event) => {
    if (event.target === bookingModal) {
      closeBookingModal();
      resetBookingForm();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !bookingModal.hidden) {
      closeBookingModal();
      resetBookingForm();
    }
  });
});
