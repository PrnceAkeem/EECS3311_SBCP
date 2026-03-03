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

  if (bookingDateInput) {
    bookingDateInput.min = new Date().toISOString().split("T")[0];
  }

  function openBookingModal() {
    bookingModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function resetBookingForm() {
    if (bookingForm) {
      bookingForm.reset();
    }
    bookingTimeInput.value = "";
    timeSlotButtons.forEach((slotButton) => {
      slotButton.classList.remove("active");
    });
    serviceNameElement.innerText = "--";
    servicePriceElement.innerText = "--";
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
      alert("Select a time slot.");
      return false;
    }
    return true;
  }

  serviceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      serviceNameElement.innerText = button.dataset.service || "--";
      servicePriceElement.innerText = button.dataset.price || "--";
      openBookingModal();
    });
  });

  timeSlotButtons.forEach((button) => {
    button.addEventListener("click", () => {
      timeSlotButtons.forEach((slotButton) => {
        slotButton.classList.remove("active");
      });
      button.classList.add("active");
      bookingTimeInput.value = button.innerText.trim();
    });
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
