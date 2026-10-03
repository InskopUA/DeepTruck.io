const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");
const authStatus = document.getElementById("auth-status");

load();

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authStatus.textContent = "Logging in...";
  loginButton.disabled = true;
  try {
    const response = await send("auth.login", {
      email: loginEmail.value,
      password: loginPassword.value
    });
    loginPassword.value = "";
    renderAccount(response.user);
  } catch (error) {
    authStatus.textContent = error.message || String(error);
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  authStatus.textContent = "Logging out...";
  logoutButton.disabled = true;
  await send("auth.logout");
  renderAccount(null);
});

async function load() {
  const auth = await send("auth.get");
  renderAccount(auth.user);
}

function renderAccount(user) {
  if (user?.email) {
    loginEmail.value = user.email;
    authStatus.textContent = `Signed in as ${user.email}`;
    loginButton.textContent = "Switch account";
    logoutButton.disabled = false;
    return;
  }
  authStatus.textContent = "Not signed in";
  loginButton.textContent = "Login";
  logoutButton.disabled = true;
}

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "CarrierVerify request failed."));
        return;
      }
      resolve(response.payload);
    });
  });
}
