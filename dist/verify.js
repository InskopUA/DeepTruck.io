const API_BASE_URL = "https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/carrier-verify";
const params = new URLSearchParams(location.search);
const id = params.get("id") || "";

const els = {
  carrierName: document.getElementById("carrier-name"),
  statusPill: document.getElementById("status-pill"),
  dot: document.getElementById("dot"),
  mc: document.getElementById("mc"),
  email: document.getElementById("email"),
  phone: document.getElementById("phone"),
  emailCheck: document.getElementById("email-check"),
  phoneCheck: document.getElementById("phone-check"),
  licenseCheck: document.getElementById("license-check"),
  emailButton: document.getElementById("verify-email"),
  phoneButton: document.getElementById("verify-phone"),
  phoneHelp: document.getElementById("phone-help"),
  uploadButton: document.getElementById("upload-license"),
  code: document.getElementById("code"),
  phoneMsg: document.getElementById("phone-msg"),
  license: document.getElementById("license"),
  licenseMsg: document.getElementById("license-msg")
};

if (!id) {
  showError("Verification id is missing.");
} else {
  load();
}

els.emailButton.addEventListener("click", async () => {
  await post("email", {});
  await load();
});

els.phoneButton.addEventListener("click", async () => {
  els.phoneMsg.textContent = "";
  try {
    await post("phone", { code: els.code.value });
    await load();
  } catch (error) {
    els.phoneMsg.textContent = error.message;
  }
});

els.uploadButton.addEventListener("click", async () => {
  els.licenseMsg.textContent = "";
  const file = els.license.files[0];
  if (!file) {
    els.licenseMsg.textContent = "Choose a file first.";
    return;
  }

  const fileData = await readFile(file);
  await post("license", { fileName: file.name, fileData });
  await load();
});

async function load() {
  const record = await request(`${API_BASE_URL}/verification-requests/${id}`);
  render(record);
}

async function post(action, body) {
  return request(`${API_BASE_URL}/verify/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function render(record) {
  const done = record.emailVerified && record.phoneVerified && record.licenseUploaded;
  els.carrierName.textContent = record.carrierName || "Carrier verification";
  els.statusPill.textContent = done ? "Verified" : "Pending";
  els.statusPill.classList.toggle("done", done);
  els.dot.textContent = record.dot || "-";
  els.mc.textContent = record.mc || "-";
  els.email.textContent = record.email || "-";
  els.phone.textContent = formatPhone(record.phone) || "-";

  setDone(els.emailCheck, record.emailVerified);
  setDone(els.phoneCheck, record.phoneVerified);
  setDone(els.licenseCheck, record.licenseUploaded);
  setButton(els.emailButton, record.emailVerified, "Email verified", "Verify email");
  setButton(els.phoneButton, record.phoneVerified, "Phone verified", "Verify phone");
  setButton(els.uploadButton, record.licenseUploaded, "License uploaded", "Upload license");
  const trialMode = record.smsTrialMode === true;
  els.phoneHelp.textContent = trialMode
    ? "Confirm that the test SMS was received. Trial Twilio SMS uses its own template code until the account is upgraded."
    : "Enter the six-digit SMS code sent to the carrier phone.";
  els.code.style.display = trialMode ? "none" : "block";
  if (trialMode && !record.phoneVerified) els.phoneButton.textContent = "Confirm SMS received";
  els.licenseMsg.textContent = record.licenseFileName || "";
}

function setDone(node, done) {
  node.classList.toggle("done", Boolean(done));
}

function setButton(button, done, doneText, pendingText) {
  button.classList.toggle("done", Boolean(done));
  button.textContent = done ? doneText : pendingText;
}

function showError(message) {
  els.statusPill.textContent = "Error";
  els.carrierName.textContent = message;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return value || "";
}
