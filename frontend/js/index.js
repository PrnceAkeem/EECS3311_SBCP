const DEMO_USERS = {
  "client@synergy.ca": "client.html",
  "consultant@synergy.ca": "consultant.html",
  "admin@synergy.ca": "admin.html"
};

const DEMO_PASSWORD = "pass12345";

function handleLogin() {
  const email = document.getElementById("signin-email").value.trim().toLowerCase();
  const password = document.getElementById("signin-password").value;

  if (password !== DEMO_PASSWORD) {
    alert("Incorrect password. Use: pass12345");
    return;
  }

  const destination = DEMO_USERS[email];
  if (destination) {
    window.location.href = destination;
    return;
  }

  alert(
    "Email not recognized.\n\nDemo accounts:\n- client@synergy.ca\n- consultant@synergy.ca\n- admin@synergy.ca"
  );
}

const loginButton = document.getElementById("login-button");
if (loginButton) {
  loginButton.addEventListener("click", handleLogin);
}
