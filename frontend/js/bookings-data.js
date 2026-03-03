(function () {
  const STORAGE_KEY = "synergy_bookings_v1";
  const VALID_STATUSES = ["Requested", "Completed", "Cancelled"];

  function readBookings() {
    const rawData = localStorage.getItem(STORAGE_KEY);
    if (!rawData) {
      return [];
    }

    try {
      const parsedData = JSON.parse(rawData);
      return Array.isArray(parsedData) ? parsedData : [];
    } catch (_error) {
      return [];
    }
  }

  function writeBookings(bookings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
  }

  function getNextBookingId(bookings) {
    if (!bookings.length) {
      return 1;
    }
    const maxId = bookings.reduce((currentMax, booking) => {
      const bookingId = Number(booking.id) || 0;
      return bookingId > currentMax ? bookingId : currentMax;
    }, 0);
    return maxId + 1;
  }

  function normalizeStatus(status) {
    return VALID_STATUSES.includes(status) ? status : "Requested";
  }

  function getBookings() {
    return readBookings();
  }

  function addBooking(bookingData) {
    const bookings = readBookings();
    const timestamp = new Date().toISOString();
    const newBooking = {
      id: getNextBookingId(bookings),
      service: bookingData.service || "",
      price: bookingData.price || "",
      clientName: bookingData.clientName || "",
      clientEmail: bookingData.clientEmail || "",
      consultantName: bookingData.consultantName || "",
      bookingDate: bookingData.bookingDate || "",
      bookingTime: bookingData.bookingTime || "",
      status: "Requested",
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedBy: "client"
    };

    bookings.push(newBooking);
    writeBookings(bookings);
    return newBooking;
  }

  function updateBookingStatus(bookingId, nextStatus, actor) {
    const bookings = readBookings();
    const targetId = Number(bookingId);
    const bookingIndex = bookings.findIndex((booking) => Number(booking.id) === targetId);
    if (bookingIndex === -1) {
      return null;
    }

    bookings[bookingIndex].status = normalizeStatus(nextStatus);
    bookings[bookingIndex].updatedAt = new Date().toISOString();
    bookings[bookingIndex].updatedBy = actor || "system";
    writeBookings(bookings);
    return bookings[bookingIndex];
  }

  window.BookingStore = {
    getBookings: getBookings,
    addBooking: addBooking,
    updateBookingStatus: updateBookingStatus
  };
})();
