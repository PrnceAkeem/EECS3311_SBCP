// =============================================================================
// methods.js — Payment Methods management page (methods.html)
// =============================================================================
//
// WHAT THIS FILE DOES:
//   Handles all user interactions on the "Pay Methods" page.  Every action
//   (load, add, remove) makes an HTTP request to the Java backend, which
//   persists data in the PostgreSQL payment_methods table.
//
// HOW HTTP REQUESTS + JSON PARSING WORK HERE:
//
//   We use the browser's fetch() API to send HTTP requests.  fetch() always
//   returns a Promise, so every network call is asynchronous (async/await).
//   The Java server responds with JSON text; response.json() parses that text
//   into a JavaScript object automatically.
//
//   ┌─────────────────────────────────────────────────────────────────────┐
//   │  JS fetch()  →  HTTP request  →  Java handler  →  JDBC  →  SQL DB  │
//   │  JS result   ←  HTTP response  ←  JSON string  ←  ResultSet rows   │
//   └─────────────────────────────────────────────────────────────────────┘
//
// THREE OPERATIONS:
//   GET  /api/payment-methods         → load and render the table
//   POST /api/payment-methods         → save a new method, refresh table
//   DELETE /api/payment-methods/:id   → remove a method, refresh table
//
// NOTE ON RELATIVE vs ABSOLUTE URLs:
//   methods.html loads ONLY this script (bookings-data.js is not loaded here).
//   We therefore define API_BASE directly in this file.
//   All fetch() calls use API_BASE + path (absolute URL), NOT relative paths.
//   Relative paths like "/api/..." would resolve against the file server that
//   serves the HTML — not the Java backend — and would fail with 404.
//
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {

  // ── Base URL for the Java HTTP backend ────────────────────────────────────
  // All fetch() calls in this file target this origin.
  // Must match the port in Server.java (PORT = 8080).
  const API_BASE = "http://localhost:8080";

  // ── DOM references ────────────────────────────────────────────────────────
  const tableBody  = document.getElementById("methodsTableBody");
  const openBtn    = document.getElementById("openAddMethodBtn");
  const modal      = document.getElementById("addMethodModal");
  const closeBtn   = document.getElementById("addMethodClose");
  const typeSelect = document.getElementById("methodTypeSelect");
  const ccFields   = document.getElementById("ccFields");
  const btFields   = document.getElementById("btFields");
  const itFields   = document.getElementById("itFields");
  const saveBtn    = document.getElementById("saveMethodBtn");
  const errorMsg   = document.getElementById("addMethodError");

  // ── Utilities ─────────────────────────────────────────────────────────────

  /** Escapes special HTML characters to prevent XSS when inserting user data. */
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Formats an ISO-8601 date string into a locale-friendly YYYY-MM-DD date. */
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

  // ==========================================================================
  // LOAD — GET /api/payment-methods
  // ==========================================================================
  //
  // HTTP flow:
  //   fetch(API_BASE + "/api/payment-methods")
  //   → Java GetPaymentMethodsHandler.handle()
  //   → new PaymentMethodStore().getAllMethodsJson()
  //   → SQL: SELECT id, type, label, created_at FROM payment_methods ORDER BY created_at DESC
  //   → Java hand-builds a JSON array string and writes it to the response body
  //   → response.json() parses "[{...},{...}]" into a JS array
  //   → renderTable(methods) stamps each object into a <tr>
  //
  // ==========================================================================

  async function loadMethods() {
    tableBody.innerHTML =
      '<tr><td colspan="4" class="empty-bookings">Loading&hellip;</td></tr>';

    try {
      // fetch() sends a GET request; the Java server responds with JSON
      const response = await fetch(API_BASE + "/api/payment-methods");

      if (!response.ok) {
        // Non-2xx status: try to read the error message the server sent
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Server error ${response.status}`);
      }

      // response.json() reads the response body text and parses it as JSON.
      // The result is a JS array: [{ id, type, label, createdAt }, ...]
      const methods = await response.json();
      renderTable(methods);

    } catch (err) {
      tableBody.innerHTML =
        `<tr><td colspan="4" class="empty-bookings">
           Failed to load payment methods: ${escapeHtml(err.message)}
         </td></tr>`;
    }
  }

  // ==========================================================================
  // RENDER — builds the table rows from the JS array returned by the server
  // ==========================================================================

  function renderTable(methods) {
    // Full replacement — no appending, so no risk of duplicate rows
    if (!methods.length) {
      tableBody.innerHTML =
        '<tr><td colspan="4" class="empty-bookings">' +
        'No payment methods saved yet. Add one below.</td></tr>';
      return;
    }

    // Each object in the array has: { id, type, label, createdAt }
    // The Java PaymentMethod.toJson() serialises these fields.
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

  // ==========================================================================
  // DELETE — DELETE /api/payment-methods/:id
  // ==========================================================================
  //
  // HTTP flow:
  //   fetch(API_BASE + "/api/payment-methods/" + id, { method: "DELETE" })
  //   → Java DeletePaymentMethodHandler.handle()
  //   → URL pattern extracts the id segment
  //   → new PaymentMethodStore().deleteMethod(id)
  //   → SQL: DELETE FROM payment_methods WHERE id = ?
  //   → Java returns 204 No Content (no body) on success
  //
  // ==========================================================================

  tableBody.addEventListener("click", async (event) => {
    const btn = event.target.closest('button[data-action="delete"]');
    if (!btn) return;

    const methodId = btn.dataset.methodId;
    if (!methodId) return;

    btn.disabled = true;
    try {
      // encodeURIComponent handles IDs that contain special characters
      const response = await fetch(
        API_BASE + "/api/payment-methods/" + encodeURIComponent(methodId),
        { method: "DELETE" }
      );

      // 204 No Content is the success response (no body to parse)
      // 404 means the id does not exist in the DB
      if (!response.ok && response.status !== 204) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Server error ${response.status}`);
      }

      loadMethods(); // re-fetch and re-render the updated list

    } catch (error) {
      alert(error.message || "Could not remove payment method.");
      btn.disabled = false;
    }
  });

  // ── Modal open / close ────────────────────────────────────────────────────

  function openModal() {
    // Reset all fields and hide sub-sections before showing the modal
    typeSelect.value           = "";
    ccFields.style.display     = "none";
    btFields.style.display     = "none";
    itFields.style.display     = "none";
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

  // Show the right sub-fields when the type dropdown changes
  typeSelect.addEventListener("change", () => {
    ccFields.style.display = typeSelect.value === "Credit Card"        ? "block" : "none";
    btFields.style.display = typeSelect.value === "Bank Transfer"      ? "block" : "none";
    itFields.style.display = typeSelect.value === "Interac e-Transfer" ? "block" : "none";
    clearError();
  });

  // ==========================================================================
  // SAVE — POST /api/payment-methods
  // ==========================================================================
  //
  // HTTP flow:
  //   fetch(API_BASE + "/api/payment-methods", { method: "POST", body: JSON })
  //   → Java PostPaymentMethodHandler.handle()
  //   → reads body, calls parseField("type") and parseField("label")
  //   → generates id = "pm_" + System.currentTimeMillis()
  //   → new PaymentMethodStore().addMethod(id, type, label)
  //   → SQL: INSERT INTO payment_methods (id, type, label)
  //          VALUES (?, ?, ?) RETURNING id, type, label, created_at
  //   → Java returns the inserted row as JSON (status 201 Created)
  //   → JS closes the modal and re-fetches the table to show the new row
  //
  // We build a human-readable "label" from the form inputs and POST
  // { type, label } to the backend.  No real card numbers or credentials
  // are stored — this is a simulation for demo/grading purposes.
  //
  // ==========================================================================

  saveBtn.addEventListener("click", async () => {
    clearError();
    const type = typeSelect.value;

    if (!type) {
      showError("Please select a payment method type.");
      return;
    }

    // Build the label string from whichever sub-fields are visible
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
      const email = document.getElementById("itEmail").value.trim();
      if (!email) {
        showError("Please enter your Interac email address.");
        return;
      }
      label = email;
    }

    saveBtn.disabled = true;
    try {
      // Send { type, label } as a JSON body.
      // The Java handler generates the id ("pm_<epochMs>") server-side.
      const response = await fetch(API_BASE + "/api/payment-methods", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type, label })
      });

      if (!response.ok) {
        // Parse the { "error": "..." } object the Java handler sends on failure
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to save payment method.");
      }

      // response.json() parses the 201-Created body: the newly inserted row
      // { id, type, label, createdAt } — we don't need it here, just refresh
      await response.json();

      closeModal();
      loadMethods(); // re-fetch and re-render to show the new row

    } catch (error) {
      showError(error.message || "Could not save payment method.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  // ── Initial page load ─────────────────────────────────────────────────────
  // Fetch and render the current list of saved payment methods from the DB.
  loadMethods();
});
