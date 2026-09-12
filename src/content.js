const ROOT_ID = "carrierverify-root";

const state = {
  dot: "",
  carrier: null,
  verification: null,
  loading: false,
  error: ""
};

init();

function init() {
  mount();
  scanAndRefresh();

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(scanAndRefresh, 700);
      return;
    }
    if (!state.dot) scanAndRefresh();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function mount() {
  if (document.getElementById(ROOT_ID)) return;
  const root = document.createElement("aside");
  root.id = ROOT_ID;
  root.innerHTML = render();
  document.documentElement.appendChild(root);
  root.addEventListener("click", onClick);
}

async function scanAndRefresh() {
  const pageText = document.body?.innerText || "";
  const dot = extractDot(pageText);
  if (!dot || dot === state.dot || state.loading) return;
  state.dot = dot;
  state.pageContact = extractPageContact(pageText);
  state.carrier = null;
  state.verification = null;
  state.error = "";
  await lookup();
}

async function lookup() {
  state.loading = true;
  update();
  try {
    const carrier = await send("carrier.lookup", { dot: state.dot, pageContact: state.pageContact || {} });
    state.carrier = carrier;
    const storedVerificationId = await getStoredVerificationId(carrier.dot);
    if (storedVerificationId) {
      state.verification = await send("verification.get", { verificationId: storedVerificationId });
    }
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.loading = false;
    update();
  }
}

async function onClick(event) {
  const action = event.target?.closest("[data-cv-action]")?.dataset.cvAction;
  if (!action) return;

  if (action === "refresh") {
    await lookup();
  }

  if (action === "start" && state.carrier) {
    await createVerification();
  }

  if (action === "new" && state.carrier) {
    await createVerification();
  }

  if (action === "poll" && state.verification?.id) {
    state.loading = true;
    state.error = "";
    update();
    try {
      state.verification = await send("verification.get", { verificationId: state.verification.id });
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      state.loading = false;
      update();
    }
  }
}

async function createVerification() {
  state.loading = true;
  state.error = "";
  update();
  try {
    state.verification = await send("verification.create", { carrier: state.carrier });
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.loading = false;
    update();
  }
}

function update() {
  const root = document.getElementById(ROOT_ID);
  if (root) root.innerHTML = render();
}

function render() {
  const carrier = state.carrier;
  const verification = state.verification;
  const verified = verification?.emailVerified && verification?.phoneVerified && verification?.licenseUploaded;

  return `
    <div class="cv-card">
      <div class="cv-head">
        <div>
          <div class="cv-kicker">CarrierVerify</div>
          <div class="cv-title">${carrier ? escapeHtml(carrier.name) : "Carrier check"}</div>
        </div>
        <span class="cv-pill ${verified ? "cv-good" : verification ? "cv-warn" : "cv-neutral"}">
          ${verified ? "Verified" : verification ? "Pending" : state.dot ? `DOT ${escapeHtml(state.dot)}` : "No DOT"}
        </span>
      </div>

      ${state.loading ? `<div class="cv-loader">Loading carrier data...</div>` : ""}
      ${state.error ? `<div class="cv-error">${escapeHtml(state.error)}</div>` : ""}
      ${carrier ? renderCarrier(carrier) : `<div class="cv-empty">Open a Central Dispatch carrier profile with a USDOT number.</div>`}
      ${carrier ? renderVerification(carrier, verification, verified) : ""}
    </div>
  `;
}

function renderCarrier(carrier) {
  return `
    <div class="cv-grid">
      ${field("USDOT", carrier.dot)}
      ${field("MC", carrier.mc || "-")}
      ${field("Email", carrier.email || "Not listed")}
      ${field("Phone", formatPhone(carrier.phone) || "Not listed")}
      ${field("Authority", carrier.authorityStatus || carrier.dotStatus || "-")}
      ${field("Fleet", `${carrier.fleet.powerUnits ?? "-"} units / ${carrier.fleet.drivers ?? "-"} drivers`)}
    </div>
    <div class="cv-safety">
      <span class="${carrier.outOfService ? "cv-red" : "cv-green"}">${carrier.outOfService ? "Out of service" : "Not out of service"}</span>
      <span>${carrier.insurance.bocFiled ? "BOC-3 filed" : "BOC-3 not found"}</span>
      <span>${carrier.insurance.minimumBipdAmount ? money(carrier.insurance.minimumBipdAmount) + " min BIPD" : "No min BIPD"}</span>
    </div>
  `;
}

function renderVerification(carrier, verification, verified) {
  const canStart = carrier.email && carrier.phone;
  if (!verification) {
    return `
      <div class="cv-actions">
        <button data-cv-action="start" ${canStart ? "" : "disabled"}>Send verification</button>
        <button class="cv-secondary" data-cv-action="refresh">Refresh</button>
      </div>
      ${canStart ? "" : `<div class="cv-note">FMCSA/MOTUS record must include both email and phone before sending.</div>`}
    `;
  }

  return `
    <div class="cv-checks">
      ${check("Email verified", verification.emailVerified)}
      ${check("SMS code verified", verification.phoneVerified)}
      ${check("Driver license uploaded", verification.licenseUploaded)}
    </div>
    <div class="cv-actions">
      <button data-cv-action="poll">${verified ? "Refresh verified status" : "Check status"}</button>
      <button class="cv-secondary" data-cv-action="new">New request</button>
      ${verification.verificationUrl ? `<a target="_blank" rel="noreferrer" href="${escapeAttribute(normalizeVerificationUrl(verification.verificationUrl, verification.id))}">Open link</a>` : ""}
    </div>
    ${verification.demoMode ? `<div class="cv-note">Demo mode: connect your backend in extension options to send real email/SMS and receive license uploads.</div>` : ""}
  `;
}

function field(label, value) {
  return `<div class="cv-field"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function check(label, done) {
  return `<div class="cv-check ${done ? "cv-done" : ""}"><span>${done ? "✓" : "•"}</span>${escapeHtml(label)}</div>`;
}

function extractDot(text) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const patterns = [
    /USDOT\s*#?\s*(\d{5,8})/i,
    /US\s*DOT\s*#?\s*(\d{5,8})/i,
    /\bDOT\s*#?\s*(\d{5,8})/i
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function extractPageContact(text) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const email = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const phone =
    normalized.match(/Business Phone Number\s*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i)?.[1] ||
    normalized.match(/Dispatcher Contact Number\s*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i)?.[1] ||
    normalized.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0] ||
    "";
  return { email, phone };
}

async function getStoredVerificationId(dot) {
  const { dotVerificationMap = {} } = await chrome.storage.local.get("dotVerificationMap");
  return dotVerificationMap[dot] || "";
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

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return value || "";
}

function normalizeVerificationUrl(url, id) {
  if (url.includes("/functions/v1/carrier-verify/verify/")) {
    return `https://carrierverify.skopetskyi-serhii-us.chatgpt.site/verify.html?id=${encodeURIComponent(id)}`;
  }
  return url;
}

function money(value) {
  return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
