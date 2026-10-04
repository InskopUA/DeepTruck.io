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
  open: false,
  authReady: false,
  canVerify: false,
  authError: ""
};

init();

function init() {
  mount();
  refreshAccount();
  scanAndRefresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.authSession) refreshAccount();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.open) { setPanelOpen(false); document.getElementById(LAUNCHER_ID)?.focus(); }
  });

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
  if (state.loading) return;
  state.error = "";
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
  if (action === "signin") {
    try { await send("account.open"); } catch (error) { state.error = error.message; update(); }
    return;
  }
  if (action !== "close" && state.loading) return;

  if (action === "close") {
    state.open = false;
    setPanelOpen(false);
    document.getElementById(LAUNCHER_ID)?.focus();
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

async function refreshAccount() {
  try {
    const account = await send("auth.get");
    state.canVerify = account.canVerify ?? Boolean(account.user);
    state.authError = "";
  } catch (error) {
    state.canVerify = false;
    state.authError = error.message || "Please sign in again.";
  } finally { state.authReady = true; update(); }
}

function update() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  const scrollTop = root.querySelector(".cv-body")?.scrollTop || 0;
  const focusedAction = root.contains(document.activeElement) ? document.activeElement.dataset.cvAction : null;
  root.innerHTML = render();
  const body = root.querySelector(".cv-body");
  if (body) body.scrollTop = scrollTop;
  if (focusedAction) root.querySelector(`[data-cv-action="${focusedAction}"]`)?.focus({ preventScroll: true });
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

function cvIcon(name) {
  const paths = {
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3a7 7 0 0 0 11.6-1"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/>',
    document: '<path d="M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6"/>',
    external: '<path d="M14 3h7v7m0-7-10 10M10 3H3v18h18v-7"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.document}</svg>`;
}
function cvShield() {
  return '<svg class="cv-shield" viewBox="0 0 64 72" aria-hidden="true"><path d="M32 4C23 10 14 13 6 14V35C6 49 17 61 32 68C47 61 58 49 58 35V14C50 13 41 10 32 4Z" fill="#eef5ff" stroke="#3979c9" stroke-width="2.5" stroke-linejoin="round"/></svg>';
}
function render() {
  const carrier = state.carrier;
  const verification = state.verification;
  const verified = verification?.emailVerified && verification?.phoneVerified && verification?.licenseUploaded && verification?.w9Uploaded && verification?.coiUploaded;
  const error = state.error || state.authError;
  return `
    <section class="cv-card ${state.open ? "cv-open" : "cv-closed"}" role="region" aria-label="DeepTruck carrier verification">
      <header class="cv-head">
        <a class="cv-brand" href="https://www.deeptruck.io" target="_blank" rel="noopener noreferrer">${cvShield()}<span>DeepTruck <small>Verify</small></span></a>
        <div class="cv-head-actions">
          <button data-cv-action="refresh" title="Refresh carrier profile" aria-label="Refresh carrier profile" ${state.loading ? "disabled" : ""}>${cvIcon("refresh")}</button>
          <button data-cv-action="close" aria-label="Close verification panel">${cvIcon("close")}</button>
        </div>
      </header>
      <div class="cv-carrier-heading">
          <div class="cv-heading-top"><span class="cv-kicker">Carrier profile</span><span class="cv-pill ${verified ? "cv-good" : verification ? "cv-warn" : "cv-neutral"}">${verified ? "Verified" : verification ? "Pending" : "Profile"}</span></div>
          <h2 class="cv-title">${carrier ? escapeHtml(carrier.name) : state.loading ? "Finding your carrier…" : "Carrier verification"}</h2>
          <p class="cv-subtitle">${state.dot ? `USDOT ${escapeHtml(state.dot)}${carrier?.mc ? ` · ${escapeHtml(carrier.mc)}` : ""}` : "Central Dispatch"}</p>
      </div>
      <div class="cv-body">
        ${state.loading ? `<div class="cv-loader" role="status"><span class="cv-spinner"></span>${carrier ? "Updating verification…" : "Loading carrier profile…"}</div>` : ""}
        ${error ? `<div class="cv-error" role="alert">${escapeHtml(error)}</div>` : ""}
        ${carrier ? renderCarrier(carrier) : state.loading ? "" : `<div class="cv-empty">Open a carrier profile with a USDOT number to get started.</div>`}
        ${carrier && verification ? renderVerification(verification, verified) : ""}
      </div>
      <div class="cv-panel-bottom">
        ${carrier ? renderActions(carrier, verification, verified) : `<div class="cv-actions"><button class="cv-secondary" data-cv-action="refresh" ${state.loading ? "disabled" : ""}>${cvIcon("refresh")} Try again</button></div>`}
        <footer class="cv-footer"><span>DeepTruck Verify</span><a href="https://www.deeptruck.io/admin/" target="_blank" rel="noopener noreferrer">Open workspace ${cvIcon("arrow")}</a></footer>
      </div>
    </section>
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
    renderLauncher(launcher);
    if (!launcher.parentElement) document.documentElement.appendChild(launcher);
    return;
  }

  const launcher = existing || createLauncher(false);
  launcher.classList.toggle("cv-launcher-floating", false);
  launcher.classList.toggle("cv-launcher-active", state.open);
  renderLauncher(launcher);

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
  renderLauncher(launcher);
}

function renderLauncher(button) {
  button.innerHTML = `${cvShield()}<span>${state.open ? "Verify open" : "Verify carrier"}</span>`;
  button.setAttribute("aria-expanded", String(state.open));
  button.setAttribute("aria-controls", ROOT_ID);
}

function createLauncher(floating) {
  const button = document.createElement("button");
  button.id = LAUNCHER_ID;
  button.type = "button";
  renderLauncher(button);
  button.className = floating ? "cv-launcher-floating" : "";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setPanelOpen(!state.open);
    if (state.open) document.querySelector(`#${ROOT_ID} [data-cv-action="close"]`)?.focus();
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
  const bipd = carrier.insurance?.minimumBipdAmount ? `${money(carrier.insurance?.minimumBipdAmount)} min BIPD` : "No min BIPD";
  return `
    <div class="cv-grid">
      ${field("Email", carrier.email || "Not listed")}
      ${field("Phone", formatPhone(carrier.phone) || "Not listed")}
      ${field("Authority", carrier.authorityStatus || carrier.dotStatus || "-")}
      ${field("Fleet", `${carrier.fleet?.powerUnits ?? "-"} units / ${carrier.fleet?.drivers ?? "-"} drivers`)}
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
        ${signal("BOC-3", carrier.insurance?.bocFiled ? "Filed" : "Not found")}
        ${signal("Coverage", bipd)}
      </div>
    </div>
  `;
}

function renderActions(carrier, verification, verified) {
  const disabled = state.loading ? "disabled" : "";
  if (!state.authReady) return '<div class="cv-note">Loading your account…</div>';
  if (!state.canVerify) return `<div class="cv-action-intro">Sign in to your DeepTruck account to start or review a verification.</div><div class="cv-actions"><button data-cv-action="signin">Sign in to Verify ${cvIcon("arrow")}</button></div>`;
  if (!verification) {
    const canStart = carrier.email && carrier.phone;
    return `<div class="cv-action-intro">Verify listed contacts and collect driver documents in one request.</div>
      ${!canStart ? '<div class="cv-note">An email address and phone number are needed to send a request.</div>' : ""}
      <div class="cv-actions"><button data-cv-action="start" ${canStart ? disabled : "disabled"}>${cvShield()} Send verification</button></div>`;
  }
  return `<div class="cv-actions"><button data-cv-action="poll" ${disabled}>${cvIcon("refresh")} ${verified ? "Refresh status" : "Check status"}</button><button class="cv-secondary" data-cv-action="new" ${disabled}>New request</button></div>
    ${verification.verificationUrl ? `<a class="cv-request-link" target="_blank" rel="noopener noreferrer" href="${escapeAttribute(normalizeVerificationUrl(verification.verificationUrl, verification.id))}">Open verification link ${cvIcon("external")}</a>` : ""}`;
}
function renderVerification(verification, verified) {
  const checks = [verification.emailVerified, verification.phoneVerified, verification.licenseUploaded, verification.w9Uploaded, verification.coiUploaded];
  const completed = checks.filter(Boolean).length;
  return `<div class="cv-verification">
      <div class="cv-section-heading"><h3>Verification checks</h3><span>${completed} of 5 complete</span></div>
      <div class="cv-progress" role="progressbar" aria-label="Verification checks completed" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${completed}"><span style="width:${completed * 20}%"></span></div>
      <div class="cv-checks">
        ${check("Email verified", verification.emailVerified, "email")}
        ${check("Phone verified by SMS", verification.phoneVerified, "phone")}
        ${check("Driver license", verification.licenseUploaded, "document")}
        ${check("W-9", verification.w9Uploaded, "document")}
        ${check("Insurance certificate", verification.coiUploaded, "document")}
      </div>
      ${verified ? `<div class="cv-complete">${cvIcon("check")} All checks complete. Ready for your review.</div>` : ""}
      ${verification.demoMode ? '<div class="cv-note">Demo request — no email or SMS has been sent.</div>' : ""}
    </div>`;
}

function field(label, value) {
  return `<div class="cv-field"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function signal(label, value) {
  return `<div class="cv-signal"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function check(label, done, icon) {
  return `<div class="cv-check ${done ? "cv-done" : ""}"><span class="cv-check-icon">${cvIcon(icon)}</span><span class="cv-check-label">${escapeHtml(label)}</span><b>${done ? "Done" : "Pending"}</b></div>`;
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
        reject(new Error(response?.error || "DeepTruck request failed."));
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
    return `https://www.deeptruck.io/verify?id=${encodeURIComponent(id)}`;
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
