document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.getElementById("methodsTableBody");
  const openBtn = document.getElementById("openAddMethodBtn");
  const modal = document.getElementById("addMethodModal");
  const closeBtn = document.getElementById("addMethodClose");
  const typeSelect = document.getElementById("methodTypeSelect");
  const cardFields = document.getElementById("cardFields");
  const btFields = document.getElementById("btFields");
  const ppFields = document.getElementById("ppFields");
  const saveBtn = document.getElementById("saveMethodBtn");
  const errorMsg = document.getElementById("addMethodError");

  const cardName = document.getElementById("cardName");
  const cardNumber = document.getElementById("cardNumber");
  const cardExpiry = document.getElementById("cardExpiry");
  const cardCvv = document.getElementById("cardCvv");

  const btBank = document.getElementById("btBank");
  const btAccount = document.getElementById("btAccount");
  const btRouting = document.getElementById("btRouting");

  const ppEmail = document.getElementById("ppEmail");

  let methodsCache = [];

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(isoString) {
    const d = new Date(isoString);
    if (isNaN(d)) return "-";
    return d.toLocaleDateString("en-CA");
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function isFutureExpiry(expiryText) {
    const match = String(expiryText || "").trim().match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
    if (!match) return false;

    const expiryMonth = Number(match[1]);
    const expiryYear = 2000 + Number(match[2]);
    const expiryDate = new Date(expiryYear, expiryMonth, 0, 23, 59, 59, 999);
    return expiryDate.getTime() >= Date.now();
  }

  function showError(message) {
    errorMsg.innerText = message;
    errorMsg.style.display = "block";
  }

  function clearError() {
    errorMsg.innerText = "";
    errorMsg.style.display = "none";
  }

  function resetFields() {
    typeSelect.value = "";
    cardName.value = "";
    cardNumber.value = "";
    cardExpiry.value = "";
    cardCvv.value = "";
    btBank.value = "";
    btAccount.value = "";
    btRouting.value = "";
    ppEmail.value = "";

    cardFields.style.display = "none";
    btFields.style.display = "none";
    ppFields.style.display = "none";
  }

  function openModal() {
    resetFields();
    clearError();
    modal.style.display = "flex";
  }

  function closeModal() {
    modal.style.display = "none";
  }

  async function loadMethods() {
    tableBody.innerHTML = '<tr><td colspan="4" class="empty-bookings">Loading&hellip;</td></tr>';
    try {
      const response = await fetch("/api/payment-methods");
      if (!response.ok) {
        throw new Error("Failed to load payment methods.");
      }

      methodsCache = await response.json();
      renderTable(methodsCache);
    } catch (error) {
      tableBody.innerHTML = `<tr><td colspan="4" class="empty-bookings">${escapeHtml(error.message || "Failed to load payment methods.")}</td></tr>`;
    }
  }

  function renderTable(methods) {
    if (!methods.length) {
      tableBody.innerHTML = '<tr><td colspan="4" class="empty-bookings">No payment methods saved yet. Add one below.</td></tr>';
      return;
    }

    tableBody.innerHTML = methods
      .map((method) => {
        return `
          <tr>
            <td>${escapeHtml(method.type)}</td>
            <td>${escapeHtml(method.label)}</td>
            <td>${escapeHtml(formatDate(method.createdAt))}</td>
            <td>
              <div class="table-action-group">
                <button type="button" class="table-action-btn pay" data-action="edit" data-method-id="${escapeHtml(method.id)}">Edit</button>
                <button type="button" class="table-action-btn cancel" data-action="delete" data-method-id="${escapeHtml(method.id)}">Remove</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function removeMethod(methodId, buttonEl) {
    buttonEl.disabled = true;
    try {
      const response = await fetch(`/api/payment-methods/${encodeURIComponent(methodId)}`, {
        method: "DELETE"
      });

      if (!response.ok && response.status !== 204) {
        throw new Error("Failed to remove payment method.");
      }

      await loadMethods();
    } catch (error) {
      alert(error.message || "Could not remove payment method.");
      buttonEl.disabled = false;
    }
  }

  async function editMethod(methodId) {
    const method = methodsCache.find((item) => item.id === methodId);
    if (!method) {
      alert("Payment method not found.");
      return;
    }

    const nextLabel = prompt("Update payment method label:", method.label || "");
    if (nextLabel === null) {
      return;
    }

    const trimmedLabel = nextLabel.trim();
    if (!trimmedLabel) {
      alert("Label cannot be empty.");
      return;
    }

    try {
      const response = await fetch(`/api/payment-methods/${encodeURIComponent(methodId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ label: trimmedLabel })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to update payment method.");
      }

      await loadMethods();
    } catch (error) {
      alert(error.message || "Could not update payment method.");
    }
  }

  function buildMethodPayload() {
    const type = typeSelect.value;

    if (!type) {
      return { error: "Please select a payment method type." };
    }

    if (type === "Credit Card" || type === "Debit Card") {
      const holder = cardName.value.trim();
      const number = cardNumber.value.replace(/\D/g, "");
      const expiry = cardExpiry.value.trim();
      const cvv = cardCvv.value.replace(/\D/g, "");

      if (!holder) {
        return { error: "Cardholder name is required." };
      }
      if (!/^\d{16}$/.test(number)) {
        return { error: "Card number must be exactly 16 digits." };
      }
      if (!isFutureExpiry(expiry)) {
        return { error: "Expiry must be in MM/YY format and in the future." };
      }
      if (!/^\d{3,4}$/.test(cvv)) {
        return { error: "CVV must be 3 or 4 digits." };
      }

      return {
        payload: {
          type,
          label: `${holder} - ending in ${number.slice(-4)}`,
          details: {
            cardholderName: holder,
            cardNumber: number,
            expiry,
            cvv
          }
        }
      };
    }

    if (type === "Bank Transfer") {
      const bankName = btBank.value.trim();
      const accountNumber = btAccount.value.replace(/\D/g, "");
      const routingNumber = btRouting.value.replace(/\D/g, "");

      if (!bankName) {
        return { error: "Bank name is required." };
      }
      if (!/^\d{6,17}$/.test(accountNumber)) {
        return { error: "Account number must be 6 to 17 digits." };
      }
      if (!/^\d{9}$/.test(routingNumber)) {
        return { error: "Routing number must be exactly 9 digits." };
      }

      return {
        payload: {
          type,
          label: `${bankName} (Acct ••••${accountNumber.slice(-4)})`,
          details: {
            bankName,
            accountNumber,
            routingNumber
          }
        }
      };
    }

    if (type === "PayPal") {
      const email = ppEmail.value.trim();
      if (!isValidEmail(email)) {
        return { error: "A valid PayPal email is required." };
      }

      return {
        payload: {
          type,
          label: email,
          details: {
            paypalEmail: email
          }
        }
      };
    }

    return { error: "Unsupported payment method type." };
  }

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  typeSelect.addEventListener("change", () => {
    const type = typeSelect.value;
    cardFields.style.display = type === "Credit Card" || type === "Debit Card" ? "block" : "none";
    btFields.style.display = type === "Bank Transfer" ? "block" : "none";
    ppFields.style.display = type === "PayPal" ? "block" : "none";
    clearError();
  });

  saveBtn.addEventListener("click", async () => {
    clearError();

    const { payload, error } = buildMethodPayload();
    if (error) {
      showError(error);
      return;
    }

    saveBtn.disabled = true;
    try {
      const response = await fetch("/api/payment-methods", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const responsePayload = await response.json().catch(() => ({}));
        throw new Error(responsePayload.error || "Failed to save payment method.");
      }

      closeModal();
      await loadMethods();
    } catch (saveError) {
      showError(saveError.message || "Could not save payment method.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const methodId = button.dataset.methodId;
    const action = button.dataset.action;

    if (!methodId || !action) return;

    if (action === "delete") {
      await removeMethod(methodId, button);
      return;
    }

    if (action === "edit") {
      await editMethod(methodId);
    }
  });

  loadMethods();
});
