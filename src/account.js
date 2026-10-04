const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");
const authStatus = document.getElementById("auth-status");
let busy = false;

function showStatus(text = "", error = false) {
  authStatus.textContent = text;
  authStatus.classList.toggle("error", error);
  authStatus.setAttribute("role", error ? "alert" : "status");
}
function renderAccount(user) {
  const connected = Boolean(user?.email);
  document.body.dataset.accountState = connected ? "connected" : "signin";
  document.getElementById("account-loading").hidden = true;
  document.getElementById("signin-panel").hidden = connected;
  document.getElementById("connected-panel").hidden = !connected;
  if (!connected) return;
  loginPassword.value = "";
  const metadata = user.user_metadata || {};
  const name = metadata.full_name || [metadata.first_name, metadata.last_name].filter(Boolean).join(" ") || user.email.split("@")[0];
  document.getElementById("account-name").textContent = name;
  document.getElementById("account-email").textContent = user.email;
  document.getElementById("account-company").textContent = metadata.company_name || metadata.dealership_name || "";
  document.getElementById("account-avatar").textContent = name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase();
}
async function load() {
  loginButton.disabled = true;
  try {
    const auth = await send("auth.get");
    renderAccount(auth.user);
  } catch (error) {
    renderAccount(null);
    showStatus(error.message || "Unable to load your account. Please sign in again.", true);
  } finally { loginButton.disabled = false; }
}
loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  busy = true; loginButton.disabled = true; loginButton.textContent = "Signing in…"; showStatus();
  try {
    const response = await send("auth.login", { email: loginEmail.value.trim(), password: loginPassword.value });
    if (!response.user?.email) throw new Error("Unable to sign in. Please try again.");
    loginPassword.value = "";
    loginPassword.type = "password";
    document.getElementById("password-toggle").setAttribute("aria-label", "Show password");
    document.getElementById("password-toggle").setAttribute("aria-pressed", "false");
    renderAccount(response.user);
    logoutButton.focus();
  } catch (error) { showStatus(error.message || "Unable to sign in. Please try again.", true); }
  finally { busy = false; loginButton.disabled = false; loginButton.textContent = "Sign in"; }
});
logoutButton.addEventListener("click", async () => {
  if (busy) return;
  busy = true; logoutButton.disabled = true; logoutButton.textContent = "Signing out…"; showStatus();
  try {
    await send("auth.logout");
    loginPassword.value = "";
    renderAccount(null);
    loginEmail.focus();
  } catch (error) { showStatus(error.message || "Unable to sign out. Please try again.", true); }
  finally { busy = false; logoutButton.disabled = false; logoutButton.textContent = "Sign out"; }
});
document.getElementById("password-toggle").addEventListener("click", event => {
  const visible = loginPassword.type === "password";
  loginPassword.type = visible ? "text" : "password";
  event.currentTarget.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  event.currentTarget.setAttribute("aria-pressed", String(visible));
});
document.getElementById("open-settings")?.addEventListener("click", async () => {
  try { await chrome.runtime.openOptionsPage(); }
  catch { showStatus("Unable to open account settings. Please try again.", true); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.authSession && !busy) { showStatus(); load(); }
});
function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, response => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!response?.ok) { reject(new Error(response?.error || "DeepTruck request failed.")); return; }
      resolve(response.payload);
    });
  });
}
load();
