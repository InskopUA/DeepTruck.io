const authClient = window.deepTruckAuth?.client;
const signup = document.body.dataset.authPage === "signup";
const form = document.getElementById("auth-form");
const submit = document.getElementById("auth-submit");
const message = document.getElementById("auth-message");
const email = document.getElementById("auth-email");
const password = document.getElementById("auth-password");
let submitting = false;
let openingWorkspace = false;

function showMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
  message.setAttribute("role", error ? "alert" : "status");
}

function openWorkspace() {
  if (openingWorkspace) return;
  openingWorkspace = true;
  location.replace("/admin/");
}

document.getElementById("password-toggle").addEventListener("click", (event) => {
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
  const button = event.currentTarget;
  button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  button.setAttribute("aria-pressed", String(visible));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authClient || submitting) return;
  submitting = true;
  submit.disabled = true;
  submit.textContent = signup ? "Creating account…" : "Signing in…";
  showMessage("");
  try {
    let result;
    if (signup) {
      const firstName = document.getElementById("first-name").value.trim();
      const lastName = document.getElementById("last-name").value.trim();
      const companyName = document.getElementById("company-name").value.trim();
      if (!firstName || !lastName || !companyName) throw new Error("Please enter your name and company.");
      result = await authClient.auth.signUp({
        email: email.value.trim(), password: password.value,
        options: {
          data: { first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}`, company_name: companyName },
          emailRedirectTo: `${location.origin}/admin/`
        }
      });
    } else {
      result = await authClient.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
    }
    if (result.error) throw result.error;
    if (result.data.session) {
      openWorkspace();
    } else if (signup) {
      password.value = "";
      showMessage("Account created. Check your email to confirm your account, then sign in.");
    }
  } catch (error) {
    showMessage(error.message || "Unable to sign in. Please try again.", true);
  } finally {
    submitting = false;
    submit.disabled = false;
    submit.textContent = signup ? "Create account" : "Sign in";
  }
});

async function init() {
  if (!authClient) {
    showMessage("Unable to load sign in. Please refresh the page.", true);
    return;
  }
  try {
    const { data, error } = await authClient.auth.getSession();
    if (error) throw error;
    if (data.session) { openWorkspace(); return; }
    authClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) openWorkspace();
    });
  } catch (error) {
    showMessage(error.message || "Unable to restore your session. Please sign in again.", true);
  }
  submit.disabled = false;
}
init();
