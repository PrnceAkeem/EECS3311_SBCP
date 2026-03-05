document.addEventListener("DOMContentLoaded", () => {
  // Interaction map:
  // - This page owns payment method CRUD against backend /api/payment-methods.
  // - booking.js reads these saved methods during the client payment modal flow.
  // DOM references
  const tableBody  = document.getElementById("methodsTableBody");
  const openBtn    = document.getElementById("openAddMethodBtn");
  const modal      = document.getElementById("addMethodModal");
  const closeBtn   = document.getElementById("addMethodClose");
  const typeSelect = document.getElementById("methodTypeSelect");
  const ccFields   = document.getElementById("ccFields");
  const btFields   = document.getElementById("btFields");
  const itFields   = document.getElementById("itFields");   // Interac e-Transfer
  const saveBtn    = document.getElementById("saveMethodBtn");
  const errorMsg   = document.getElementById("addMethodError");

  // Utilities

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(isoString) {
    const d = new Date(isoString);
    if (isNaN(d)) return "-";
    return d.toLocaleDateString("en-CA"); // produces YYYY-MM-DD
  }

  function showError(message) {
    errorMsg.innerText = message;
    errorMsg.style.display = "block";
  }

  function clearError() {
    errorMsg.innerText = "";
    errorMsg.style.display = "none";
  }

  // Load and render the payment methods table

  async function loadMethods() {
    tableBody.innerHTML = '<tr><td colspan="4" class="empty-bookings">Loading&hellip;</td></tr>';
    try {
      const response = await fetch("/api/payment-methods");
      const methods  = await response.json();
      renderTable(methods);
    } catch {
      tableBody.innerHTML = '<tr><td colspan="4" class="empty-bookings">Failed to load payment methods.</td></tr>';
    }
  }

  function renderTable(methods) {
    // Full replacement — no appending, so no risk of duplicates
    if (!methods.length) {
      tableBody.innerHTML = '<tr><td colspan="4" class="empty-bookings">No payment methods saved yet. Add one below.</td></tr>';
      return;
    }

    tableBody.innerHTML = methods.map((m) => `
      <tr>
        <td>${escapeHtml(m.type)}</td>
        <td>${escapeHtml(m.label)}</td>
        <td>${escapeHtml(formatDate(m.createdAt))}</td>
        <td>
          <button type="button" class="table-action-btn cancel"
                  data-action="delete" data-method-id="${escapeHtml(m.id)}">
            Remove
          </button>
        </td>
      </tr>
    `).join("");
  }

  // Delete a saved method

  tableBody.addEventListener("click", async (event) => {
    const btn = event.target.closest('button[data-action="delete"]');
    if (!btn) return;

    const methodId = btn.dataset.methodId;
    if (!methodId) return;

    btn.disabled = true;
    try {
      const response = await fetch(`/api/payment-methods/${encodeURIComponent(methodId)}`, {
        method: "DELETE"
      });
      // 204 No Content is the success response from the server
      if (!response.ok && response.status !== 204) {
        throw new Error("Failed to remove payment method.");
      }
      loadMethods(); // refresh the table
    } catch (error) {
      alert(error.message || "Could not remove payment method.");
      btn.disabled = false;
    }
  });

  // Modal open / close

  function openModal() {
    // Reset all fields and hide sub-sections before showing the modal
    typeSelect.value = "";
    ccFields.style.display = "none";
    btFields.style.display = "none";
    itFields.style.display = "none";
    document.getElementById("ccName").value  = "";
    document.getElementById("ccLast4").value = "";
    document.getElementById("btBank").value  = "";
    document.getElementById("btNick").value  = "";
    document.getElementById("itEmail").value = "";
    clearError();
    modal.style.display = "flex";
  }

  function closeModal() {
    modal.style.display = "none";
  }

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal(); // backdrop click closes modal
  });

  // Show the right sub-fields whenever the type dropdown changes
  typeSelect.addEventListener("change", () => {
    ccFields.style.display = typeSelect.value === "Credit Card"  ? "block" : "none";
    btFields.style.display = typeSelect.value === "Bank Transfer" ? "block" : "none";
    itFields.style.display = typeSelect.value === "Interac e-Transfer" ? "block" : "none";
    clearError();
  });

  // Save a new payment method
  //
  // We build a human-readable "label" from the form inputs and POST
  // { type, label } to the backend. No real card numbers or credentials
  // are stored — this is a simulation for demo/grading purposes.

  saveBtn.addEventListener("click", async () => {
    clearError();
    const type = typeSelect.value;

    if (!type) {
      showError("Please select a payment method type.");
      return;
    }

    let label = "";

    if (type === "Credit Card") {
      const name  = document.getElementById("ccName").value.trim();
      const last4 = document.getElementById("ccLast4").value.trim();
      if (!name || !last4) {
        showError("Please enter the cardholder name and last 4 digits.");
        return;
      }
      if (!/^\d{4}$/.test(last4)) {
        showError("Last 4 digits must be exactly 4 numbers.");
        return;
      }
      label = `${name} - ending in ${last4}`;

    } else if (type === "Bank Transfer") {
      const bank = document.getElementById("btBank").value.trim();
      const nick = document.getElementById("btNick").value.trim();
      if (!bank || !nick) {
        showError("Please enter the bank name and account nickname.");
        return;
      }
      label = `${bank} (${nick})`;

    } else if (type === "Interac e-Transfer") {
      // Interac only needs a registered email address
      const email = document.getElementById("itEmail").value.trim();
      if (!email) {
        showError("Please enter your Interac email address.");
        return;
      }
      label = email;
    }

    saveBtn.disabled = true;
    try {
      const response = await fetch("/api/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, label })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to save payment method.");
      }
      closeModal();
      loadMethods(); // refresh the table to show the new entry
    } catch (error) {
      showError(error.message || "Could not save payment method.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Load the table on page load
  loadMethods();
});
