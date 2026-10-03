const ROOT_ID = "carrierverify-root";
const LAUNCHER_ID = "carrierverify-launcher";
const POLL_INTERVAL_MS = 5000;

const state = {
  dot: "",
  carrier: null,
  verification: null,
  loading: false,
  error: "",
  pollTimer: 0,
  open: false
};

init();

function init() {
  mount();
  scanAndRefresh();

  let lastUrl = location.href;
  const observer = new MutationObserver((mutations) => {
    if (mutations.every(isCarrierVerifyMutation)) return;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(scanAndRefresh, 700);
      return;
    }
    if (!state.dot) scanAndRefresh();
    const launcher = document.getElementById(LAUNCHER_ID);
    if (state.dot && (!launcher || launcher.classList.contains("cv-launcher-floating"))) syncLauncher();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("beforeunload", stopPolling);
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
  syncLauncher();
  await lookup();
  syncLauncher();
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
      updatePolling();
    }
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.loading = false;
    update();
    syncLauncher();
  }
}

async function onClick(event) {
  const action = event.target?.closest("[data-cv-action]")?.dataset.cvAction;
  if (!action) return;

  if (action === "close") {
    state.open = false;
    setPanelOpen(false);
    return;
  }

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
      updatePolling();
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
    updatePolling();
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.loading = false;
    update();
  }
}

function updatePolling() {
  const verification = state.verification;
  const verified = verification?.emailVerified && verification?.phoneVerified && verification?.licenseUploaded && verification?.w9Uploaded && verification?.coiUploaded;
  if (verification?.id && !verified && !verification.demoMode) {
    startPolling();
    return;
  }
  stopPolling();
}

function startPolling() {
  if (state.pollTimer) return;
  state.pollTimer = window.setInterval(refreshVerificationStatus, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (!state.pollTimer) return;
  window.clearInterval(state.pollTimer);
  state.pollTimer = 0;
}

async function refreshVerificationStatus() {
  if (!state.verification?.id || state.loading) return;
  try {
    const next = await send("verification.get", { verificationId: state.verification.id });
    const before = JSON.stringify({
      emailVerified: state.verification.emailVerified,
      phoneVerified: state.verification.phoneVerified,
      licenseUploaded: state.verification.licenseUploaded,
      w9Uploaded: state.verification.w9Uploaded,
      coiUploaded: state.verification.coiUploaded,
      status: state.verification.status
    });
    const after = JSON.stringify({
      emailVerified: next.emailVerified,
      phoneVerified: next.phoneVerified,
      licenseUploaded: next.licenseUploaded,
      w9Uploaded: next.w9Uploaded,
      coiUploaded: next.coiUploaded,
      status: next.status
    });
    state.verification = next;
    state.error = "";
    updatePolling();
    if (before !== after) update();
  } catch (error) {
    state.error = error.message || String(error);
    update();
  }
}

function update() {
  const root = document.getElementById(ROOT_ID);
  if (root) root.innerHTML = render();
}

function setPanelOpen(open) {
  state.open = open;
  const card = document.querySelector(`#${ROOT_ID} .cv-card`);
  if (card) {
    card.classList.toggle("cv-open", open);
    card.classList.toggle("cv-closed", !open);
  } else {
    update();
  }
  updateLauncherState();
}

function render() {
  const carrier = state.carrier;
  const verification = state.verification;
  const verified = verification?.emailVerified && verification?.phoneVerified && verification?.licenseUploaded && verification?.w9Uploaded && verification?.coiUploaded;

  return `
    <div class="cv-card ${state.open ? "cv-open" : "cv-closed"}">
      <div class="cv-head">
        <div>
          <div class="cv-kicker">CarrierVerify</div>
          <div class="cv-title">${carrier ? escapeHtml(carrier.name) : "Carrier check"}</div>
        </div>
        <div class="cv-head-actions">
          <span class="cv-pill ${verified ? "cv-good" : verification ? "cv-warn" : "cv-neutral"}">
            ${verified ? "Verified" : verification ? "Pending" : state.dot ? `DOT ${escapeHtml(state.dot)}` : "No DOT"}
          </span>
          <button data-cv-action="close" aria-label="Close CarrierVerify panel">×</button>
        </div>
      </div>

      ${state.loading ? `<div class="cv-loader">Loading carrier data...</div>` : ""}
      ${state.error ? `<div class="cv-error">${escapeHtml(state.error)}</div>` : ""}
      ${carrier ? renderCarrier(carrier) : `<div class="cv-empty">Open a Central Dispatch carrier profile with a USDOT number.</div>`}
      ${carrier ? renderVerification(carrier, verification, verified) : ""}
    </div>
  `;
}

function syncLauncher() {
  const existing = document.getElementById(LAUNCHER_ID);
  if (!state.dot && !state.carrier) {
    existing?.remove();
    return;
  }

  const preferButton = findPreferButton();
  const target = preferButton || findCarrierTitleTarget();
  if (!target) {
    const launcher = existing || createLauncher(true);
    launcher.classList.add("cv-launcher-floating");
    launcher.classList.toggle("cv-launcher-active", state.open);
    launcher.textContent = state.open ? "CarrierVerify open" : "Verify carrier";
    if (!launcher.parentElement) document.documentElement.appendChild(launcher);
    return;
  }

  const launcher = existing || createLauncher(false);
  launcher.classList.toggle("cv-launcher-floating", false);
  launcher.classList.toggle("cv-launcher-active", state.open);
  launcher.textContent = state.open ? "CarrierVerify open" : "Verify carrier";

  if (preferButton) {
    launcher.classList.add("cv-launcher-prefer");
    if (launcher.nextElementSibling !== preferButton) preferButton.insertAdjacentElement("beforebegin", launcher);
    return;
  }

  launcher.classList.remove("cv-launcher-prefer");
  if (launcher.parentElement !== target) target.appendChild(launcher);
}

function updateLauncherState() {
  const launcher = document.getElementById(LAUNCHER_ID);
  if (!launcher) return;
  launcher.classList.toggle("cv-launcher-active", state.open);
  launcher.textContent = state.open ? "CarrierVerify open" : "Verify carrier";
}

function createLauncher(floating) {
  const button = document.createElement("button");
  button.id = LAUNCHER_ID;
  button.type = "button";
  button.textContent = state.open ? "CarrierVerify open" : "Verify carrier";
  button.className = floating ? "cv-launcher-floating" : "";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setPanelOpen(true);
  });
  return button;
}

function isCarrierVerifyMutation(mutation) {
  const target = mutation.target;
  if (target?.nodeType === Node.ELEMENT_NODE) {
    if (target.closest?.(`#${ROOT_ID}`) || target.closest?.(`#${LAUNCHER_ID}`)) return true;
  }

  const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return changedNodes.length > 0 && changedNodes.every((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return true;
    return node.id === ROOT_ID || node.id === LAUNCHER_ID || Boolean(node.closest?.(`#${ROOT_ID}, #${LAUNCHER_ID}`));
  });
}

function findCarrierTitleTarget() {
  const name = normalizeText(state.carrier?.name);
  if (!name) return null;
  const candidates = Array.from(document.querySelectorAll("h1, h2, h3"));
  return candidates.find((element) => {
    if (element.closest(`#${ROOT_ID}`) || element.closest(`#${LAUNCHER_ID}`)) return false;
    const text = normalizeText(element.textContent);
    if (!text.includes(name)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.width < 900 && rect.height > 0 && rect.top > -20 && rect.top < window.innerHeight;
  }) || null;
}

function findPreferButton() {
  const buttons = Array.from(document.querySelectorAll("button, a, [role='button']"));
  return buttons.find((element) => {
    if (element.closest(`#${ROOT_ID}`) || element.closest(`#${LAUNCHER_ID}`)) return false;
    if (normalizeText(element.textContent) !== "prefer") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top > -20 && rect.top < window.innerHeight;
  }) || null;
}

function renderCarrier(carrier) {
  const insuranceExpiry = getInsuranceExpiry(carrier.insurance?.currentFilings || []);
  const activeFor = getDurationLabel(carrier.activeSince);
  const fmcsaUpdated = getUpdatedAgeLabel(carrier.fmcsaUpdatedAt);
  const bipd = carrier.insurance.minimumBipdAmount ? `${money(carrier.insurance.minimumBipdAmount)} min BIPD` : "No min BIPD";
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
      <div class="cv-signal cv-signal-status ${carrier.outOfService ? "cv-red" : "cv-green"}">
        <span>Safety</span>
        <b>${carrier.outOfService ? "Out of service" : "Not out of service"}</b>
      </div>
      <div class="cv-signal-grid">
        ${activeFor ? signal("Active", activeFor) : ""}
        ${fmcsaUpdated ? signal("FMCSA update", fmcsaUpdated) : ""}
      </div>
      <div class="cv-signal cv-insurance ${escapeAttribute(insuranceExpiry.className)}">
        <span>Insurance</span>
        <b>${escapeHtml(insuranceExpiry.dateLabel)}</b>
        <em>${escapeHtml(insuranceExpiry.timeLabel)}</em>
      </div>
      <div class="cv-signal-grid">
        ${signal("BOC-3", carrier.insurance.bocFiled ? "Filed" : "Not found")}
        ${signal("Coverage", bipd)}
      </div>
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
      ${check("W-9 uploaded", verification.w9Uploaded)}
      ${check("COI uploaded", verification.coiUploaded)}
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

function signal(label, value) {
  return `<div class="cv-signal"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
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
  const yearEstablished = normalized.match(/Year Established\s*(\d{4})/i)?.[1] || "";
  const lastUpdated = normalized.match(/Last Updated\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1] || "";
  const phone =
    normalized.match(/Business Phone Number\s*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i)?.[1] ||
    normalized.match(/Dispatcher Contact Number\s*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i)?.[1] ||
    normalized.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0] ||
    "";
  return { email, phone, yearEstablished, lastUpdated };
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

function getInsuranceExpiry(filings) {
  const dates = filings
    .map((filing) => parseDate(filing.cancellationDate))
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime());

  if (!dates.length) {
    return { dateLabel: "Active", timeLabel: "No end date listed", className: "cv-green" };
  }

  const today = startOfDay(new Date());
  const future = dates.find((date) => startOfDay(date).getTime() >= today.getTime());
  const target = future || dates[dates.length - 1];
  const days = Math.ceil((startOfDay(target).getTime() - today.getTime()) / 86400000);
  const dateLabel = target.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (days < 0) {
    return { dateLabel, timeLabel: `Expired ${Math.abs(days)}d ago`, className: "cv-red" };
  }

  if (days === 0) {
    return { dateLabel, timeLabel: "Expires today", className: "cv-yellow" };
  }

  return {
    dateLabel,
    timeLabel: `${days}d remaining`,
    className: days <= 14 ? "cv-yellow" : "cv-green"
  };
}

function getDurationLabel(value) {
  const date = parseDate(value);
  if (!date) return "";

  const today = startOfDay(new Date());
  const started = startOfDay(date);
  if (started.getTime() > today.getTime()) return "";

  let months = (today.getFullYear() - started.getFullYear()) * 12 + today.getMonth() - started.getMonth();
  if (today.getDate() < started.getDate()) months -= 1;

  if (months >= 12) {
    const years = Math.floor(months / 12);
    const restMonths = months % 12;
    return restMonths ? `${years}y ${restMonths}mo` : `${years}y`;
  }

  if (months >= 1) return `${months}mo`;

  const days = Math.max(0, Math.floor((today.getTime() - started.getTime()) / 86400000));
  return days === 1 ? "1d" : `${days}d`;
}

function getUpdatedAgeLabel(value) {
  const date = parseDate(value);
  if (!date) return "";

  const today = startOfDay(new Date());
  const updated = startOfDay(date);
  const days = Math.floor((today.getTime() - updated.getTime()) / 86400000);

  if (days <= 0) return "Today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function parseDate(value) {
  if (!value) return null;
  const clean = String(value).trim();
  if (/^\d{4}$/.test(clean)) return new Date(Number(clean), 0, 1);
  const usDate = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usDate) return new Date(Number(usDate[3]), Number(usDate[1]) - 1, Number(usDate[2]));
  const date = new Date(clean);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
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
