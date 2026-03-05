document.addEventListener("DOMContentLoaded", () => {
  const consultantBookingsBody = document.getElementById("consultantBookingsBody");
  const consultantMessage = document.getElementById("consultantMessage");

  if (!consultantBookingsBody || !window.BookingStore) {
    return;
  }

  let unsubscribe = null;

  // Define valid status transitions for consultants based on state pattern
  const CONSULTANT_TRANSITIONS = {
    "Requested": ["Confirmed", "Rejected"],     // Can confirm or reject
    "Confirmed": ["Pending Payment", "Cancelled"], // Can request payment or cancel
    "Pending Payment": ["Paid", "Cancelled"],   // Can mark as paid or cancel
    "Paid": ["Completed", "Cancelled"],         // Can complete or cancel
    "Completed": [],                             // Terminal state - no actions
    "Rejected": [],                              // Terminal state - no actions
    "Cancelled": []                              // Terminal state - no actions
  };

  // Map status to display text for dropdown
  const STATUS_DISPLAY = {
    "Confirmed": "Confirm",
    "Rejected": "Reject",
    "Pending Payment": "Request Payment",
    "Paid": "Mark as Paid",
    "Completed": "Complete Session",
    "Cancelled": "Cancel Booking"
  };

  function escapeHtml(value) {
    if (value === null || value === undefined) return "-";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDateTime(bookingDate, bookingTime) {
    const datePart = String(bookingDate || "").slice(0, 10);
    const timePart = String(bookingTime || "").trim();
    if (!datePart && !timePart) {
      return "-";
    }
    if (!timePart) {
      return datePart;
    }
    return `${datePart} ${timePart}`;
  }

  function getStatusClass(status) {
    const statusClasses = {
      "Confirmed": "status-confirmed",
      "Rejected": "status-rejected",
      "Cancelled": "status-cancelled",
      "Paid": "status-paid",
      "Pending Payment": "status-pending",
      "Completed": "status-completed",
      "Requested": "status-requested"
    };
    return statusClasses[status] || "status-requested";
  }

  function createStatusDropdown(booking) {
    const allowedTransitions = CONSULTANT_TRANSITIONS[booking.status] || [];
    
    if (allowedTransitions.length === 0) {
      return '<span class="table-no-action">No actions available</span>';
    }

    const options = allowedTransitions.map(status => 
      `<option value="${status}">${STATUS_DISPLAY[status] || status}</option>`
    ).join('');

    return `
      <div class="status-update-group">
        <select class="status-select" data-booking-id="${booking.id}" data-current-status="${booking.status}">
          <option value="" selected disabled>— Select action —</option>
          ${options}
        </select>
        <button type="button" class="update-status-btn" data-booking-id="${booking.id}" disabled>Update</button>
      </div>
    `;
  }

  function createBookingRow(booking) {
    // Format date properly for display
    const formattedDate = booking.bookingDate ? 
      new Date(booking.bookingDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).replace(/\//g, '-') : "-";
    
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(booking.id)}</td>
      <td>${escapeHtml(booking.clientName || "-")}</td>
      <td>${escapeHtml(booking.service || "-")}</td>
      <td>${escapeHtml(booking.consultantName || "-")}</td>
      <td>${escapeHtml(formattedDate)}</td>
      <td>${escapeHtml(booking.bookingTime || "-")}</td>
      <td><span class="status-pill ${getStatusClass(booking.status)}">${escapeHtml(booking.status)}</span></td>
      <td>${createStatusDropdown(booking)}</td>
    `;
    return row;
  }

  function createEmptyRow() {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="8" class="empty-bookings">No bookings assigned to you yet.</td>';
    return row;
  }

  function createErrorRow(message) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="8" class="empty-bookings">${escapeHtml(message)}</td>`;
    return row;
  }

  function showMessage(text, isError = false) {
    if (consultantMessage) {
      consultantMessage.textContent = text;
      consultantMessage.className = isError ? 'page-message error' : 'page-message success';
      setTimeout(() => {
        consultantMessage.textContent = '';
        consultantMessage.className = 'page-message';
      }, 3000);
    }
  }

  // Handle dropdown change - enable/disable update button
  function setupDropdownListeners() {
    document.querySelectorAll('.status-select').forEach(select => {
      // Remove existing listener to avoid duplicates
      select.removeEventListener('change', handleSelectChange);
      select.addEventListener('change', handleSelectChange);
    });
  }

  function handleSelectChange(e) {
    const bookingId = e.target.dataset.bookingId;
    const updateBtn = document.querySelector(`.update-status-btn[data-booking-id="${bookingId}"]`);
    if (updateBtn) {
      updateBtn.disabled = !e.target.value;
    }
  }

  // Handle update button clicks
  async function handleStatusUpdate(event) {
    const updateBtn = event.target.closest('.update-status-btn');
    if (!updateBtn) return;

    const bookingId = updateBtn.dataset.bookingId;
    const selectEl = document.querySelector(`.status-select[data-booking-id="${bookingId}"]`);
    
    if (!selectEl || !selectEl.value) {
      showMessage('Please select a status update action', true);
      return;
    }

    const nextStatus = selectEl.value;
    const currentStatus = selectEl.dataset.currentStatus;

    // Create confirmation message
    const confirmMessages = {
      'Confirmed': `confirm booking #${bookingId}`,
      'Rejected': `reject booking #${bookingId}`,
      'Pending Payment': `request payment for booking #${bookingId}`,
      'Paid': `mark booking #${bookingId} as paid`,
      'Completed': `complete booking #${bookingId}`,
      'Cancelled': `cancel booking #${bookingId}`
    };

    const action = confirmMessages[nextStatus] || `update booking #${bookingId}`;
    
    if (!confirm(`Are you sure you want to ${action}?`)) {
      return;
    }

    updateBtn.disabled = true;
    updateBtn.textContent = 'Updating...';

    try {
      await window.BookingStore.updateBookingStatus(Number(bookingId), nextStatus, "consultant");
      showMessage(`Booking #${bookingId} updated to ${nextStatus} successfully!`);
      renderBookings(); // Re-render to reflect changes
    } catch (error) {
      showMessage(error.message || `Failed to update booking status.`, true);
      renderBookings(); // Re-render to reset the button state
    }
  }

  async function renderBookings() {
    consultantBookingsBody.innerHTML = "";

    try {
      const bookings = await window.BookingStore.getBookings();
      
      // For demo purposes, show all bookings
      // In a real app, you'd filter by consultant name
      const consultantBookings = bookings; // .filter(b => b.consultantName === "Current Consultant");

      if (!consultantBookings.length) {
        consultantBookingsBody.appendChild(createEmptyRow());
        return;
      }

      // Sort bookings by ID
      consultantBookings.sort((a, b) => a.id - b.id);

      consultantBookings.forEach((booking) => {
        consultantBookingsBody.appendChild(createBookingRow(booking));
      });

      // Setup dropdown listeners after rendering
      setupDropdownListeners();
      
    } catch (error) {
      consultantBookingsBody.appendChild(
        createErrorRow(error.message || "Failed to load bookings.")
      );
    }
  }

  // Global click handler for update buttons
  consultantBookingsBody.addEventListener('click', handleStatusUpdate);

  // Subscribe to real-time updates
  unsubscribe = window.BookingStore.subscribe(() => {
    renderBookings();
  });

  window.addEventListener("beforeunload", () => {
    if (unsubscribe) {
      unsubscribe();
    }
  });

  // Initial render
  renderBookings();
});