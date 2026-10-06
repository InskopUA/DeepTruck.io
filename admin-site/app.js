const API_BASE_URL = "https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/carrier-verify";
const POLL_INTERVAL_MS = 5000;
const authClient = window.deepTruckAuth?.client;
const state = {
  items: [], query: "", filter: "all", manualCarrier: null, manualVerification: null,
  manualMessage: "", pollTimer: 0, isLookupLoading: false, session: null, user: null
};
const adminApp = document.getElementById("admin-app");
const accountEmail = document.getElementById("account-email");
const logoutButton = document.getElementById("logout-button");
const settingsCompany = document.getElementById("settings-company");
const settingsEmail = document.getElementById("settings-email");
const saveAccountButton = document.getElementById("save-account-button");
const settingsMessage = document.getElementById("settings-message");
const views = document.querySelectorAll(".view");
const navButtons = document.querySelectorAll(".sidebar [data-view]");
const title = document.getElementById("page-title");
const tbody = document.getElementById("history-body");
const details = document.getElementById("details");
const detailsContent = document.getElementById("details-content");
const dotForm = document.getElementById("dot-form");
const dotInput = document.getElementById("dot-input");
const dotSearchButton = document.getElementById("dot-search-button");
const manualResult = document.getElementById("manual-result");
const verifyMessage = document.getElementById("verify-message");
let detailsTrigger = null;
let openingLogin = false;

const pageCopy = {
  verifications: "Verifications",
  history: "Verification history",
  tracking: "Tracking",
  billing: "Plans & billing",
  settings: "Account settings"
};
function setView(view, updateAddress = true) {
  const selected = pageCopy[view] ? view : "verifications";
  navButtons.forEach(button => {
    const active = button.dataset.view === selected;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  views.forEach(section => section.classList.toggle("active", section.id === selected));
  title.textContent = pageCopy[selected];
  document.getElementById("new-verification-button").hidden = selected !== "history";
  document.getElementById("new-tracking-button").hidden = selected !== "tracking";
  if (selected === "tracking" && state.session) window.deepTruckTracking?.activate();
  document.title = `${pageCopy[selected]} · DeepTruck Verify`;
  if (updateAddress) {
    const hash = selected === "verifications" ? "" : `#${selected}`;
    if (location.hash !== hash) history.pushState(null, "", `${location.pathname}${location.search}${hash}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}
navButtons.forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelectorAll("[data-go-view]").forEach(button => button.addEventListener("click", () => {
  setView(button.dataset.goView);
  if (button.dataset.goView === "verifications") dotInput.focus();
}));
window.addEventListener("popstate", () => setView(location.hash.slice(1), false));
window.addEventListener("hashchange", () => setView(location.hash.slice(1), false));

document.getElementById("search").addEventListener("input", event => {
  state.query = event.target.value.toLowerCase(); renderTable();
});
document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(item => {
    item.classList.toggle("active", item === button);
    item.setAttribute("aria-pressed", String(item === button));
  });
  renderTable();
}));
document.getElementById("refresh-history").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await load(); } finally { button.disabled = false; }
});
window.searchCarrierFromDot = async event => {
  event?.preventDefault(); await lookupManualCarrier(dotInput.value);
};
dotForm.addEventListener("submit", window.searchCarrierFromDot);
manualResult.addEventListener("click", async event => {
  const action = event.target?.closest("[data-action]")?.dataset.action;
  if (action === "send-verification") await createManualVerification();
  if (action === "refresh-verification") await refreshManualVerification(true);
  if (action === "new-search") { resetManualVerification(); dotInput.focus(); }
});
logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    const { error } = await authClient.auth.signOut();
    if (error) throw error;
    stopPolling(); showAuth();
  } catch (error) {
    const message = document.getElementById("app-message");
    message.textContent = error.message || "Unable to sign out. Please try again.";
    message.classList.add("error");
    logoutButton.disabled = false;
  }
});
document.getElementById("settings-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.session) return;
  const company = settingsCompany.value.trim();
  if (!company) { settingsMessage.textContent = "Enter your company name."; settingsMessage.classList.add("error"); return; }
  settingsMessage.textContent = ""; settingsMessage.classList.remove("error");
  saveAccountButton.disabled = true; saveAccountButton.textContent = "Saving…";
  try {
    const { data, error } = await authClient.auth.updateUser({ data: { company_name: company } });
    if (error) throw error;
    state.user = data.user; renderAccount(); settingsMessage.textContent = "Changes saved.";
  } catch (error) {
    settingsMessage.textContent = error.message || "Unable to save changes.";
    settingsMessage.classList.add("error");
  } finally {
    saveAccountButton.disabled = false; saveAccountButton.textContent = "Save changes";
  }
});
function closeDetails() {
  details.classList.remove("open"); details.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  detailsTrigger?.focus();
}
document.getElementById("close-details").addEventListener("click", closeDetails);
details.addEventListener("click", event => { if (event.target === details) closeDetails(); });
document.addEventListener("keydown", event => {
  if (!details.classList.contains("open")) return;
  if (event.key === "Escape") { event.preventDefault(); closeDetails(); return; }
  if (event.key === "Tab") {
    const focusable = [...details.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
async function initSession() {
  if (location.hash === "#signup") { location.replace("/signup"); return; }
  if (location.hash === "#login") { location.replace("/login"); return; }
  if (!authClient) { document.getElementById("session-message").textContent = "Unable to load your workspace. Please refresh the page."; return; }
  try {
    const { data, error } = await authClient.auth.getSession();
    if (error) throw error;
    if (data.session) await useSession(data.session);
    else { showAuth(); return; }
    authClient.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      if (session) setTimeout(() => useSession(session), 0);
      else if (event === "SIGNED_OUT") showAuth();
    });
  } catch (error) {
    document.getElementById("session-message").textContent = "Unable to restore your session. Please sign in again.";
    const link = document.createElement("a"); link.href = "/login"; link.textContent = "Go to sign in";
    document.getElementById("session-loading").append(link);
  }
}
async function useSession(session) {
  if (state.user && state.user.id !== session.user.id) { location.reload(); return; }
  const firstLoad = !state.session;
  state.session = session; state.user = session.user;
  document.getElementById("session-loading").hidden = true;
  adminApp.classList.remove("auth-hidden"); renderAccount();
  if (firstLoad) { setView(location.hash.slice(1), false); await load(); }
}
function showAuth() {
  if (openingLogin) return;
  openingLogin = true;
  stopPolling();
  location.replace("/login");
}
function renderAccount() {
  const metadata = state.user?.user_metadata || {};
  const name = metadata.full_name || [metadata.first_name, metadata.last_name].filter(Boolean).join(" ") || state.user?.email?.split("@")[0] || "Your account";
  const company = metadata.company_name || metadata.dealership_name || "Your workspace";
  accountEmail.textContent = state.user?.email || "";
  document.querySelectorAll("[data-account-name]").forEach(el => el.textContent = name);
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  document.querySelectorAll("[data-account-initials]").forEach(el => el.textContent = initials);
  document.getElementById("workspace-company").textContent = company;
  settingsEmail.value = state.user?.email || "";
  settingsCompany.value = metadata.company_name || metadata.dealership_name || "";
  document.getElementById("settings-name").value = name;
}
window.deepTruckTracking.init({getSession: () => state.session, getVerifications: () => state.items, showTracking: () => setView("tracking")});
initSession();

async function load() {
  if (!state.session) return;
  const requestUser = state.user?.id;
  try {
    const response = await fetch(`${API_BASE_URL}/verification-requests?limit=100`, { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Failed to load history.");
    if (state.user?.id !== requestUser) return;
    state.items = data.items || [];
    renderMetrics();
    renderTable();
    window.deepTruckTracking?.updateCarriers();
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty error">${escapeHtml(error.message)}</td></tr>`;
    document.getElementById("recent-body").innerHTML = `<tr><td colspan="3" class="empty error">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function lookupManualCarrier(dot) {
  if (state.isLookupLoading) return;
  const cleanDot = String(dot || "").replace(/\D/g, "");
  if (!/^\d{5,8}$/.test(cleanDot)) {
    setManualMessage("Enter a valid USDOT number.", true);
    return;
  }

  state.isLookupLoading = true;
  renderSearchButton();
  setManualMessage("Searching carrier...");
  manualResult.innerHTML = renderManualLoading("Reading MOTUS/FMCSA carrier profile...");
  state.manualCarrier = null;
  state.manualVerification = null;
  stopPolling();

  try {
    state.manualCarrier = await lookupCarrier(cleanDot);
    await load();
    state.manualVerification = findLatestVerification(cleanDot, "verified");
    setManualMessage(state.manualVerification ? `Carrier was verified ${relativeAge(state.manualVerification.updatedAt || state.manualVerification.createdAt)}.` : "");
    renderManualResult();
  } catch (error) {
    const message = formatLookupError(error);
    setManualMessage(message, true);
    manualResult.innerHTML = renderManualEmpty("Carrier lookup failed", message);
  } finally {
    state.isLookupLoading = false;
    renderSearchButton();
  }
}

function renderSearchButton() {
  dotSearchButton.disabled = state.isLookupLoading;
  dotSearchButton.textContent = state.isLookupLoading ? "Searching..." : "Search";
}

async function createManualVerification() {
  const carrier = state.manualCarrier;
  if (!carrier) return;
  if (!carrier.email || !carrier.phone) {
    setManualMessage("Carrier must have both email and phone before verification can be sent.", true);
    return;
  }

  setManualMessage("Sending verification request...");
  renderManualResult(true);
  try {
    const response = await fetch(`${API_BASE_URL}/verification-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        dot: carrier.dot,
        carrierName: carrier.name,
        email: carrier.email,
        phone: carrier.phone,
        mc: carrier.mc,
        createdAt: new Date().toISOString()
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || "Verification API request failed.");
    state.manualVerification = data;
    setManualMessage("Verification request sent.");
    renderManualResult();
    startPolling();
    await load();
  } catch (error) {
    setManualMessage(error.message || String(error), true);
    renderManualResult();
  }
}

async function refreshManualVerification(showMessage = false) {
  if (!state.manualVerification?.id) return;
  if (showMessage) setManualMessage("Refreshing verification status...");
  try {
    const response = await fetch(`${API_BASE_URL}/verification-requests/${state.manualVerification.id}`, { headers: authHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || "Verification status request failed.");
    state.manualVerification = data;
    if (showMessage) setManualMessage("Status updated.");
    renderManualResult();
    updatePolling();
    await load();
  } catch (error) {
    setManualMessage(error.message || String(error), true);
  }
}

function resetManualVerification() {
  state.manualCarrier = null;
  state.manualVerification = null;
  setManualMessage("");
  stopPolling();
  manualResult.innerHTML = renderManualEmpty("Carrier preview", "Search a USDOT number to load carrier identity, insurance, authority, and contact details.");
}

function startPolling() {
  if (state.pollTimer) return;
  state.pollTimer = window.setInterval(() => refreshManualVerification(false), POLL_INTERVAL_MS);
}

function stopPolling() {
  if (!state.pollTimer) return;
  window.clearInterval(state.pollTimer);
  state.pollTimer = 0;
}

function updatePolling() {
  const verification = state.manualVerification;
  const complete = verification && isVerificationComplete(verification);
  if (verification?.id && !complete) {
    startPolling();
    return;
  }
  stopPolling();
}

function renderMetrics() {
  const stats = {
    total: state.items.length,
    verified: state.items.filter(item => item.status === "verified").length,
    pending: state.items.filter(item => item.status !== "verified").length,
    ready: state.items.filter(isVerificationComplete).length
  };
  document.querySelectorAll("[data-stat]").forEach(el => el.textContent = stats[el.dataset.stat]);
}
function verificationRow(item, compact = false) {
  const status = item.status === "verified" ? "Verified" : "Pending";
  const carrier = `<td class="carrier"><button class="carrier-link" type="button" aria-haspopup="dialog">${escapeHtml(item.carrierName)}</button><span>${compact ? "USDOT " + escapeHtml(item.dot) : "Record " + escapeHtml(String(item.id).slice(0, 8))}</span></td>`;
  const identifiers = compact ? "" : `<td><b>${escapeHtml(item.dot)}</b><div class="sub">${escapeHtml(item.mc || "—")}</div></td><td>${escapeHtml(item.email)}<div class="sub">${escapeHtml(formatPhone(item.phone))}</div></td>`;
  return `<tr data-id="${escapeAttribute(item.id)}">${carrier}${identifiers}<td><span class="badge ${status.toLowerCase()}"><i></i>${status}</span></td><td class="date-cell">${formatDate(item.createdAt)}</td></tr>`;
}
function renderTable() {
  const items = state.items.filter(item => {
    const haystack = `${item.carrierName} ${item.dot} ${item.mc} ${item.email} ${item.phone}`.toLowerCase();
    const matchesStatus = state.filter === "all" || (state.filter === "verified" ? item.status === "verified" : item.status !== "verified");
    return haystack.includes(state.query) && matchesStatus;
  });
  document.getElementById("history-count").textContent = items.length;
  tbody.innerHTML = items.length ? items.map(item => verificationRow(item)).join("") : '<tr><td colspan="5" class="empty">No verifications match. Try another search or filter.</td></tr>';
  const recent = [...state.items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  document.getElementById("recent-body").innerHTML = recent.length ? recent.map(item => verificationRow(item, true)).join("") : '<tr><td colspan="3" class="empty">Your verification requests will appear here.</td></tr>';
  document.querySelectorAll('tr[data-id]').forEach(row => row.addEventListener("click", () => openDetails(row.dataset.id)));
}

function renderManualResult(isBusy = false) {
  const carrier = state.manualCarrier;
  const verification = state.manualVerification;
  if (!carrier) return;
  const complete = verification && isVerificationComplete(verification);
  const canSend = carrier.email && carrier.phone && !isBusy;
  const badgeText = complete
    ? `Verified · ${relativeAge(verification.updatedAt || verification.createdAt)}`
    : verification
      ? "Pending"
      : "Ready to verify";
  const requestState = complete
    ? `completed ${relativeAge(verification.updatedAt || verification.createdAt)}`
    : verification
      ? "waiting on carrier"
      : "ready to send";

  manualResult.innerHTML = `
    <section class="carrier-shell">
      <header class="manual-hero">
        <div>
          <p class="eyebrow">Carrier lookup</p>
          <h2>${escapeHtml(carrier.name)}</h2>
          <span>USDOT ${escapeHtml(carrier.dot)} · ${escapeHtml(carrier.mc || "No MC")}</span>
        </div>
        <b class="badge ${complete ? "verified" : verification ? "pending" : "ready"}">${escapeHtml(badgeText)}</b>
      </header>

      <div class="manual-grid">
        ${infoCard("USDOT", carrier.dot)}
        ${infoCard("MC", carrier.mc || "-")}
        ${infoCard("Email", carrier.email || "Not listed")}
        ${infoCard("Phone", formatPhone(carrier.phone))}
        ${infoCard("Authority", carrier.authorityStatus || carrier.dotStatus || "-")}
        ${infoCard("Fleet", `${carrier.fleet.powerUnits ?? "-"} units / ${carrier.fleet.drivers ?? "-"} drivers`)}
      </div>

      <div class="risk-grid">
        ${riskCard("Safety", carrier.outOfService ? "Out of service" : "Not out of service", carrier.outOfService ? "bad" : "good")}
        ${riskCard("Insurance", getInsuranceLabel(carrier), getInsuranceTone(carrier))}
        ${riskCard("BOC-3", carrier.insurance.bocFiled ? "Filed" : "Not found", carrier.insurance.bocFiled ? "neutral" : "warn")}
        ${riskCard("Coverage", carrier.insurance.minimumBipdAmount ? money(carrier.insurance.minimumBipdAmount) + " min BIPD" : "No min BIPD", carrier.insurance.minimumBipdAmount ? "neutral" : "warn")}
      </div>

      <section class="manual-flow">
        <div class="detail-section-title">
          <h3>Verification request</h3>
          <span>${escapeHtml(requestState)}</span>
        </div>
        ${verification ? renderManualChecks(verification) : `<p class="muted">Send a request to verify the FMCSA-listed email, phone, driver license, W-9, and COI.</p>`}
        <div class="manual-actions">
          ${verification && !complete ? `<button class="primary" data-action="refresh-verification">Refresh status</button>` : ""}
          ${!verification ? `<button class="primary" data-action="send-verification" ${canSend ? "" : "disabled"}>${isBusy ? "Sending..." : "Verify carrier"}</button>` : ""}
          <button class="primary quiet" data-action="new-search">New search</button>
          ${verification?.verificationUrl ? `<a class="primary quiet" target="_blank" rel="noreferrer" href="${escapeAttribute(verification.verificationUrl)}">Open carrier link</a>` : ""}
        </div>
        ${canSend || verification ? "" : `<p class="inline-message error">This carrier is missing email or phone.</p>`}
      </section>
    </section>
  `;
}

function findLatestVerification(dot, status = "") {
  const matches = state.items
    .filter((item) => item.dot === dot && (!status || item.status === status))
    .sort((left, right) => new Date(right.updatedAt || right.createdAt) - new Date(left.updatedAt || left.createdAt));
  return matches[0] || null;
}

function renderManualChecks(verification) {
  return `
    <div class="checks manual-checks">
      ${checkRow("Email verified", verification.emailVerified)}
      ${checkRow("SMS code verified", verification.phoneVerified)}
      ${checkRow("Driver license uploaded", verification.licenseUploaded)}
      ${checkRow("W-9 uploaded", verification.w9Uploaded)}
      ${checkRow("COI uploaded", verification.coiUploaded)}
    </div>
  `;
}

function renderManualLoading(message) {
  return `<section class="panel empty-panel loading-panel" role="status"><span class="loading-ring"></span><h2>Finding your carrier</h2><p class="muted">${escapeHtml(message)}</p></section>`;
}

function renderManualEmpty(titleText, message) {
  return `<section class="panel empty-panel"><p class="eyebrow">Carrier verification</p><h2>${escapeHtml(titleText)}</h2><p class="muted">${escapeHtml(message)}</p></section>`;
}

function riskCard(label, value, tone = "neutral") {
  return `<div class="risk-card ${escapeAttribute(tone)}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function setManualMessage(message, isError = false) {
  state.manualMessage = message || "";
  verifyMessage.textContent = state.manualMessage;
  verifyMessage.classList.toggle("error", Boolean(isError));
}

function openDetails(id) {
  detailsTrigger = document.activeElement;
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const complete = item.emailVerified && item.phoneVerified && item.licenseUploaded && item.w9Uploaded && item.coiUploaded;
  detailsContent.innerHTML = `
    <header class="detail-hero">
      <div>
        <p class="eyebrow">Carrier verification</p>
        <h2>${escapeHtml(item.carrierName)}</h2>
        <span>USDOT ${escapeHtml(item.dot)} · ${escapeHtml(item.mc || "No MC")}</span>
      </div>
      <div class="detail-hero-actions"><b class="badge ${complete ? "verified" : "pending"}"><i></i>${complete ? "verified" : "pending"}</b>${complete ? '<button id="create-tracking-from-verification" class="primary" type="button">Create tracking</button>' : ''}</div>
    </header>

    <div class="detail-grid">
      ${infoCard("Email", item.email)}
      ${infoCard("Phone", formatPhone(item.phone))}
      ${infoCard("Started", formatDate(item.createdAt))}
      ${infoCard("Last update", formatDate(item.updatedAt))}
    </div>

    <section class="detail-section">
      <div class="detail-section-title">
        <h3>Verification checks</h3>
        <span>${complete ? "ready for shipper review" : "waiting on carrier"}</span>
      </div>
      <div class="checks">
        ${checkRow("Email verified", item.emailVerified)}
        ${checkRow("SMS code verified", item.phoneVerified)}
        ${checkRow("Driver license uploaded", item.licenseUploaded)}
        ${checkRow("W-9 uploaded", item.w9Uploaded)}
        ${checkRow("COI uploaded", item.coiUploaded)}
      </div>
    </section>

    <section class="detail-section">
      <div class="detail-section-title">
        <h3>Activity timeline</h3>
        <span>request audit trail</span>
      </div>
      <div class="activity-feed">
        <div><span></span><b>Request created</b><em>${formatDate(item.createdAt)}</em></div>
        <div class="${item.emailVerified ? "done" : ""}"><span></span><b>Email verification</b><em>${item.emailVerified ? "confirmed" : "pending"}</em></div>
        <div class="${item.phoneVerified ? "done" : ""}"><span></span><b>SMS verification</b><em>${item.phoneVerified ? "confirmed" : "pending"}</em></div>
        <div class="${complete ? "done" : ""}"><span></span><b>Final review</b><em>${complete ? "ready" : "waiting"}</em></div>
      </div>
    </section>

    <section class="detail-section">
      <div class="detail-section-title">
        <h3>Documents</h3>
        <span>uploaded by carrier</span>
      </div>
      <div class="document-grid">
        ${documentCard("Driver license", item.documents?.license, item.licenseUploaded, item.licenseFileName)}
        ${documentCard("W-9", item.documents?.w9, item.w9Uploaded, item.w9FileName)}
        ${documentCard("COI", item.documents?.coi, item.coiUploaded, item.coiFileName)}
      </div>
    </section>
  `;
  details.classList.add("open");
  document.getElementById("create-tracking-from-verification")?.addEventListener("click", () => { closeDetails(); window.deepTruckTracking.openCreate(item.id); });
  details.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  document.getElementById("close-details").focus();
}

function infoCard(label, value) {
  return `<div class="info-card"><span>${escapeHtml(label)}</span><b>${escapeHtml(value || "-")}</b></div>`;
}

function checkRow(label, done) {
  return `<div><span>${escapeHtml(label)}</span> <b class="${done ? "done" : ""}">${done ? "Done" : "Pending"}</b></div>`;
}

function documentCard(label, document, uploaded, fallbackFileName) {
  const fileName = document?.fileName || fallbackFileName || "";
  const url = document?.url || "";
  return `
    <article class="document-card ${uploaded ? "uploaded" : ""}">
      <div>
        <span>${escapeHtml(label)}</span>
        <b>${uploaded ? escapeHtml(fileName || "Uploaded") : "Pending upload"}</b>
      </div>
      ${uploaded && url ? `<a target="_blank" rel="noreferrer" href="${escapeAttribute(url)}">Open</a>` : `<em>${uploaded ? "Stored" : "Missing"}</em>`}
    </article>
  `;
}

async function lookupCarrier(dot) {
  const response = await fetch(`${API_BASE_URL}/carrier-lookup/${dot}`, { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || "Carrier lookup failed.");
  return data;
}

function isVerificationComplete(verification) {
  return Boolean(verification.emailVerified && verification.phoneVerified && verification.licenseUploaded && verification.w9Uploaded && verification.coiUploaded);
}

function getInsuranceLabel(carrier) {
  const filings = carrier.insurance?.currentFilings || [];
  const dates = filings.map((filing) => parseDate(filing.cancellationDate)).filter(Boolean).sort((left, right) => left - right);
  if (!dates.length) return "No end date listed";
  const today = startOfDay(new Date());
  const target = dates.find((date) => startOfDay(date) >= today) || dates[dates.length - 1];
  const days = Math.ceil((startOfDay(target) - today) / 86400000);
  const dateLabel = target.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (days < 0) return `Expired ${dateLabel}`;
  if (days === 0) return `Expires today`;
  return `${dateLabel} · ${days}d left`;
}

function getInsuranceTone(carrier) {
  const label = getInsuranceLabel(carrier);
  if (label.startsWith("Expired")) return "bad";
  if (label.includes("today") || label.match(/· ([1-9]|1[0-4])d left/)) return "warn";
  return "good";
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function money(value) {
  return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatLookupError(error) {
  const message = error?.message || String(error);
  if (/failed to fetch|network/i.test(message)) {
    return "Unable to reach carrier lookup. Please try again in a moment.";
  }
  return message;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function relativeAge(value) {
  if (!value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return value || "-";
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

function authHeaders() {
  return state.session?.access_token ? { Authorization: `Bearer ${state.session.access_token}` } : {};
}
