const API_BASE_URL = "https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/carrier-verify";
const params = new URLSearchParams(location.search);
const id = params.get("id") || "";
let emailAutoVerified = false;

const els = {
  carrierName: document.getElementById("carrier-name"),
  statusPill: document.getElementById("status-pill"),
  dot: document.getElementById("dot"),
  mc: document.getElementById("mc"),
  email: document.getElementById("email"),
  phone: document.getElementById("phone"),
  pageMessage: document.getElementById("page-message"),
  progress: document.getElementById("verification-progress"),
  progressLabel: document.getElementById("progress-label"),
  progressHelp: document.getElementById("progress-help"),
  completionMessage: document.getElementById("completion-message"),
  emailCheck: document.getElementById("email-check"),
  phoneCheck: document.getElementById("phone-check"),
  licenseCheck: document.getElementById("license-check"),
  w9Check: document.getElementById("w9-check"),
  coiCheck: document.getElementById("coi-check"),
  emailButton: document.getElementById("verify-email"),
  phoneButton: document.getElementById("verify-phone"),
  phoneHelp: document.getElementById("phone-help"),
  uploadButton: document.getElementById("upload-license"),
  w9UploadButton: document.getElementById("upload-w9"),
  coiUploadButton: document.getElementById("upload-coi"),
  code: document.getElementById("code"),
  phoneMsg: document.getElementById("phone-msg"),
  license: document.getElementById("license"),
  licenseLabel: document.getElementById("license-label"),
  licenseMsg: document.getElementById("license-msg"),
  w9: document.getElementById("w9"),
  w9Label: document.getElementById("w9-label"),
  w9Msg: document.getElementById("w9-msg"),
  coi: document.getElementById("coi"),
  coiLabel: document.getElementById("coi-label"),
  coiMsg: document.getElementById("coi-msg")
};

if (!id) {
  showError("Verification id is missing.");
} else {
  load().catch((error) => showError(error.message));
}

els.emailButton.addEventListener("click", async () => {
  if (els.emailButton.classList.contains("done")) return;
  await verifyEmail().catch((error) => showError(error.message));
});

document.getElementById("phone-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (els.phoneButton.classList.contains("done")) return;
  els.phoneButton.disabled = true;
  els.phoneMsg.textContent = "";
  try {
    await post("phone", { code: els.code.value });
    await load();
  } catch (error) {
    els.phoneMsg.textContent = error.message;
    els.phoneButton.disabled = false;
  }
});

els.license.addEventListener("change", () => uploadSelectedDocument("license"));
els.w9.addEventListener("change", () => uploadSelectedDocument("w9"));
els.coi.addEventListener("change", () => uploadSelectedDocument("coi"));

async function load() {
  const record = await request(`${API_BASE_URL}/public/verification-requests/${id}`);
  if (!record.emailVerified && !emailAutoVerified) {
    emailAutoVerified = true;
    await verifyEmail();
    return;
  }
  render(record);
}

async function post(action, body) {
  return request(`${API_BASE_URL}/verify/${id}/${action}`, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(body)
  });
}

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Network request failed.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function render(record) {
  const done = record.emailVerified && record.phoneVerified && record.licenseUploaded && record.w9Uploaded && record.coiUploaded;
  const completed = [record.emailVerified, record.phoneVerified, record.licenseUploaded, record.w9Uploaded, record.coiUploaded].filter(Boolean).length;
  els.progress.value = completed;
  els.progressLabel.textContent = `${completed} of 5 complete`;
  els.progressHelp.textContent = done ? "Verification complete. Thank you." : "All five steps are required to complete verification.";
  els.completionMessage.hidden = !done;
  els.pageMessage.hidden = true;
  els.carrierName.textContent = record.carrierName || "Carrier verification";
  els.statusPill.textContent = done ? "Verified" : "Pending";
  els.statusPill.classList.toggle("done", done);
  els.statusPill.classList.remove("error");
  els.dot.textContent = record.dot || "-";
  els.mc.textContent = record.mc || "-";
  els.email.textContent = record.email || "-";
  els.phone.textContent = formatPhone(record.phone) || "-";

  setDone(els.emailCheck, record.emailVerified);
  setDone(els.phoneCheck, record.phoneVerified);
  setDone(els.licenseCheck, record.licenseUploaded);
  setDone(els.w9Check, record.w9Uploaded);
  setDone(els.coiCheck, record.coiUploaded);
  setButton(els.emailButton, record.emailVerified, "Email verified", "Verifying...");
  els.emailButton.disabled = true;
  setButton(els.phoneButton, record.phoneVerified, "Phone verified", "Verify phone");
  els.phoneButton.disabled = Boolean(record.phoneVerified);
  els.code.disabled = Boolean(record.phoneVerified);
  [els.license, els.w9, els.coi].forEach(input => { input.disabled = input.closest(".file-control").classList.contains("is-busy"); });
  if (record.phoneVerified) els.phoneMsg.textContent = "";
  setFileControl(els.uploadButton, els.licenseLabel, record.licenseUploaded, record.licenseFileName, "Upload license");
  setFileControl(els.w9UploadButton, els.w9Label, record.w9Uploaded, record.w9FileName, "Upload W-9");
  setFileControl(els.coiUploadButton, els.coiLabel, record.coiUploaded, record.coiFileName, "Upload COI");
  const trialMode = record.smsTrialMode === true;
  els.phoneHelp.textContent = trialMode
    ? "Confirm that the test SMS was received. Trial Twilio SMS uses its own template code until the account is upgraded."
    : "Enter the six-digit SMS code sent to the carrier phone.";
  els.code.style.display = trialMode || record.phoneVerified ? "none" : "block";
  if (trialMode && !record.phoneVerified) els.phoneButton.textContent = "Confirm SMS received";
  els.licenseMsg.textContent = record.licenseUploaded ? record.licenseFileName || "" : "";
  els.w9Msg.textContent = record.w9Uploaded ? record.w9FileName || "" : "";
  els.coiMsg.textContent = record.coiUploaded ? record.coiFileName || "" : "";
  [els.licenseMsg, els.w9Msg, els.coiMsg].forEach(node => node.classList.remove("error"));
}

function setDone(node, done) {
  node.classList.toggle("done", Boolean(done));
  node.closest(".step").classList.toggle("is-complete", Boolean(done));
}

function setButton(button, done, doneText, pendingText) {
  button.classList.toggle("done", Boolean(done));
  button.textContent = done ? doneText : pendingText;
}

function setFileControl(control, label, done, fileName, pendingText) {
  control.classList.toggle("done", Boolean(done));
  label.textContent = done ? fileName || "Uploaded" : pendingText;
}

async function verifyEmail() {
  await post("email", {});
  await load();
}

async function uploadSelectedDocument(type) {
  const config = {
    license: {
      input: els.license,
      label: els.licenseLabel,
      control: els.uploadButton,
      message: els.licenseMsg,
      pendingText: "Upload license"
    },
    w9: {
      input: els.w9,
      label: els.w9Label,
      control: els.w9UploadButton,
      message: els.w9Msg,
      pendingText: "Upload W-9"
    },
    coi: {
      input: els.coi,
      label: els.coiLabel,
      control: els.coiUploadButton,
      message: els.coiMsg,
      pendingText: "Upload COI"
    }
  }[type];

  config.message.textContent = "";
  config.message.classList.remove("error");
  const file = config.input.files[0];
  if (!file) {
    config.label.textContent = config.pendingText;
    return;
  }

  config.label.textContent = "Uploading...";
  config.control.classList.add("is-busy");
  config.input.disabled = true;
  try {
    const fileData = await readFile(file);
    await post(type, { fileName: file.name, fileData });
    config.label.textContent = file.name;
    await load();
  } catch (error) {
    config.label.textContent = config.pendingText;
    config.message.textContent = error.message;
    config.message.classList.add("error");
  } finally {
    config.control.classList.remove("is-busy");
    config.input.disabled = false;
  }
}

function showError(message) {
  els.statusPill.textContent = "Error";
  els.statusPill.classList.remove("done");
  els.statusPill.classList.add("error");
  els.pageMessage.textContent = message;
  els.pageMessage.hidden = false;
  els.progressLabel.textContent = "Unable to load";
  if (els.carrierName.textContent === "Loading carrier…") els.carrierName.textContent = "Carrier verification";
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
