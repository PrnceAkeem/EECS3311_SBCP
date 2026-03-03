document.addEventListener("DOMContentLoaded", () => {
  const serviceNameElement = document.getElementById("serviceName");
  const servicePriceElement = document.getElementById("servicePrice");
  const bookingTimeInput = document.getElementById("bookingTime");
  const serviceButtons = document.querySelectorAll(".service-book-btn");
  const timeSlotButtons = document.querySelectorAll(".time-slot-btn");

  serviceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      serviceNameElement.innerText = button.dataset.service || "--";
      servicePriceElement.innerText = button.dataset.price || "--";
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
});
