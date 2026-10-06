const API_BASE_URL = "https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/carrier-verify";
const POLL_INTERVAL_MS = 5000;
const authClient = window.deepTruckAuth?.client;
const state = {
  items: [], query: "", filter: "all", manualCarrier: null, manualVerification: null,
  manualMessage: "", page: 0, sort: "updated", isSending: false, pollTimer: 0, isLookupLoading: false, session: null, user: null
};
const adminApp = document.getElementById("admin-app");
const accountEmail = document.getElementById("account-email");
const logoutButton = document.getElementById("logout-button");
const settingsCompany = document.getElementById("settings-company");
const settingsEmail = document.getElementById("settings-email");
const saveAccountButton = document.getElementById("save-account-button");
const settingsMessage = document.getElementById("settings-message");
const views = document.querySelectorAll(".view");
const navButtons = document.querySelectorAll("[data-view]");
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
let lookupSequence = 0;

const pageCopy = {
  verifications: "Verifications",
  history: "Verifications",
  tracking: "Tracking",
  billing: "Plans",
  settings: "Settings", help: "Help & resources"
};
function setView(view, updateAddress = true) {
  const selected = view === "history" ? "verifications" : pageCopy[view] ? view : "verifications";
  document.getElementById("mobile-more").open = false;
  navButtons.forEach(button => {
    const active = button.dataset.view === selected;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  views.forEach(section => section.classList.toggle("active", section.id === selected));
  title.textContent = pageCopy[selected];
  document.getElementById("new-verification-button").hidden = selected !== "verifications";
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

}));
window.addEventListener("popstate", () => setView(location.hash.slice(1), false));
window.addEventListener("hashchange", () => setView(location.hash.slice(1), false));

document.getElementById("search").addEventListener("input", event => {
  state.query = event.target.value.toLowerCase(); state.page = 0; renderTable();
});
document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
  state.filter = button.dataset.filter; state.page = 0;
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
  if (action === "open-existing") { const item = state.manualVerification; document.getElementById("verification-dialog").close(); if (!state.items.some(v => v.id === item.id)) state.items.unshift(item); openDetails(item.id); }
  if (action === "track-existing") { document.getElementById("verification-dialog").close(); window.deepTruckTracking.openCreate(state.manualVerification.id); }
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
  adminApp.inert = false;
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
  settingsEmail.textContent = state.user?.email || "";
  settingsCompany.value = metadata.company_name || metadata.dealership_name || "";
  document.getElementById("settings-name").textContent = name;
}
let toastTimer;
window.workspaceToast = function(text) {
  const toast = document.getElementById("toast"); toast.textContent = text; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.hidden = true, 4500);
};
function openLookup() {
  resetManualVerification(); manualResult.innerHTML = ""; dotForm.reset();
  document.getElementById("verification-dialog").showModal(); dotInput.focus();
}
document.getElementById("new-verification-button").addEventListener("click", openLookup);
document.getElementById("close-lookup").addEventListener("click", () => { if (!state.isSending) document.getElementById("verification-dialog").close(); });
document.getElementById("verification-dialog").addEventListener("close", stopPolling);
document.getElementById("verification-dialog").addEventListener("cancel", event => { if (state.isSending) event.preventDefault(); });
document.getElementById("mobile-logout").addEventListener("click", () => logoutButton.click());
document.getElementById("verification-sort").addEventListener("change", event => { state.sort = event.target.value; state.page = 0; renderTable(); });
document.getElementById("previous-page").addEventListener("click", () => { state.page--; renderTable(); });
document.getElementById("next-page").addEventListener("click", () => { state.page++; renderTable(); });
document.addEventListener("click", async event => {
  const button = event.target.closest("[data-open], [data-copy], [data-load], [data-new-verification]");
  if (!button) return;
  if (button.hasAttribute("data-new-verification")) { openLookup(); return; }
  if (button.dataset.open) openDetails(button.dataset.open);
  if (button.dataset.load) window.deepTruckTracking.openCreate(button.dataset.load);
  if (button.dataset.copy) {
    const item = state.items.find(item => item.id === button.dataset.copy);
    try { await navigator.clipboard.writeText(item.verificationUrl); window.workspaceToast("Carrier link copied."); }
    catch { window.workspaceToast("Could not copy. Open the carrier link from its lookup instead."); }
  }
});

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
    document.getElementById("verification-list-message").textContent = "";
    renderMetrics();
    renderTable();
    window.deepTruckTracking?.updateCarriers();
  } catch (error) {
    const message = document.getElementById("verification-list-message");
    message.textContent = error.message || "Could not load verifications. Refresh to retry.";
    message.classList.add("error");
    if (!state.items.length) tbody.innerHTML = '<tr><td colspan="5" class="empty">Unable to load your verifications. Use Refresh to try again.</td></tr>';
  }
}

async function lookupManualCarrier(dot) {
  if (state.isLookupLoading) return;
  const cleanDot = String(dot || "").replace(/\D/g, "");
  if (!/^\d{5,8}$/.test(cleanDot)) {
    setManualMessage("Enter a valid USDOT number.", true);
    return;
  }

  const sequence = ++lookupSequence;
  state.isLookupLoading = true;
  renderSearchButton();
  setManualMessage("Searching carrier...");
  manualResult.innerHTML = renderManualLoading("Reading MOTUS/FMCSA carrier profile...");
  state.manualCarrier = null;
  state.manualVerification = null;
  stopPolling();

  try {
    const carrier = await lookupCarrier(cleanDot);
    await load();
    const existing = await fetch(`${API_BASE_URL}/verification-requests?dot=${encodeURIComponent(cleanDot)}&limit=1`, { headers: authHeaders() });
    const records = await existing.json();
    if (!existing.ok || records.error) throw new Error(records.error || "Could not check existing verifications. Please retry.");
    if (sequence !== lookupSequence) return;
    state.manualCarrier = carrier;
    state.manualVerification = records.items?.find(item => String(item.dot) === cleanDot) || findLatestVerification(cleanDot);
    updatePolling();
    setManualMessage(state.manualVerification ? isVerificationComplete(state.manualVerification) ? "This carrier already has a completed verification." : "An existing request is in progress. Continue it below." : "");
    renderManualResult();
  } catch (error) {
    if (sequence !== lookupSequence) return;
    const message = formatLookupError(error);
    setManualMessage(message, true);
    manualResult.innerHTML = renderManualEmpty("Carrier lookup failed", message);
  } finally {
    if (sequence === lookupSequence) { state.isLookupLoading = false; renderSearchButton(); }
  }
}

function renderSearchButton() {
  dotSearchButton.disabled = state.isLookupLoading;
  dotSearchButton.textContent = state.isLookupLoading ? "Searching..." : "Search";
}

async function createManualVerification() {
  const carrier = state.manualCarrier;
  if (!carrier || state.isSending || state.manualVerification) return;
  if (!carrier.email || !carrier.phone) {
    setManualMessage("Carrier must have both email and phone before verification can be sent.", true);
    return;
  }

  state.isSending = true;
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
  } finally { state.isSending = false; }
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
  lookupSequence++; state.isLookupLoading = false; renderSearchButton();
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
  if (verification?.id && !complete && document.getElementById("verification-dialog").open) {
    startPolling();
    return;
  }
  stopPolling();
}

function renderMetrics() {
  const stats = {
    total: state.items.length,
    verified: state.items.filter(isVerificationComplete).length,
    pending: state.items.filter(item => !isVerificationComplete(item)).length,
    ready: state.items.filter(isVerificationComplete).length
  };
  document.querySelectorAll("[data-stat]").forEach(el => el.textContent = stats[el.dataset.stat]);
}
function verificationProgress(item) {
  const checks = [["Email", item.emailVerified], ["SMS", item.phoneVerified], ["License", item.licenseUploaded], ["W-9", item.w9Uploaded], ["Insurance", item.coiUploaded]];
  return { done: checks.filter(([, done]) => done).length, missing: checks.filter(([, done]) => !done).map(([label]) => label) };
}
function verificationRow(item) {
  const progress = verificationProgress(item), complete = progress.done === 5;
  return `<tr data-id="${escapeAttribute(item.id)}"><td class="carrier"><button class="carrier-link" data-open="${escapeAttribute(item.id)}" type="button" aria-haspopup="dialog">${escapeHtml(item.carrierName)}</button><span>USDOT ${escapeHtml(item.dot)} · ${escapeHtml(item.mc || "No MC")}</span></td><td>${escapeHtml(item.email)}<div class="sub">${escapeHtml(formatPhone(item.phone))}</div></td><td><div class="progress-label ${complete ? "complete" : ""}"><span class="progress-track" aria-hidden="true"><i style="width:${progress.done * 20}%"></i></span>${complete ? "Complete" : progress.done + "/5 complete"}</div><p class="missing-checks">${complete ? "All documents received" : "Waiting: " + escapeHtml(progress.missing.join(", "))}</p></td><td class="date-cell">${formatDate(item.updatedAt || item.createdAt)}</td><td><div class="row-actions"><button class="icon-button" data-open="${escapeAttribute(item.id)}" type="button" aria-label="Open ${escapeAttribute(item.carrierName)} documents" title="Open documents"><svg aria-hidden="true"><use href="#icon-doc"></use></svg></button>${item.verificationUrl ? `<button class="icon-button" data-copy="${escapeAttribute(item.id)}" type="button" aria-label="Copy verification link for ${escapeAttribute(item.carrierName)}" title="Copy verification link"><svg aria-hidden="true"><use href="#icon-copy"></use></svg></button>` : ""}${complete ? `<button class="icon-button" data-load="${escapeAttribute(item.id)}" type="button" aria-label="Create tracking for ${escapeAttribute(item.carrierName)}" title="Create tracking"><svg aria-hidden="true"><use href="#icon-tracking"></use></svg></button>` : ""}</div></td></tr>`;
}
function renderTable() {
  const items = state.items.filter(item => {
    const haystack = `${item.carrierName} ${item.dot} ${item.mc} ${item.email} ${item.phone}`.toLowerCase();
    return haystack.includes(state.query) && (state.filter === "all" || (state.filter === "verified" ? isVerificationComplete(item) : !isVerificationComplete(item)));
  }).sort((a, b) => state.sort === "name" ? a.carrierName.localeCompare(b.carrierName) : new Date(state.sort === "created" ? b.createdAt : b.updatedAt || b.createdAt) - new Date(state.sort === "created" ? a.createdAt : a.updatedAt || a.createdAt));
  state.page = Math.min(state.page, Math.max(0, Math.ceil(items.length / 20) - 1));
  const start = state.page * 20, visible = items.slice(start, start + 20);
  document.getElementById("history-count").textContent = items.length ? `${start + 1}–${start + visible.length} of ${items.length} verifications` : "0 verifications";
  document.getElementById("verification-limit-note").textContent = state.items.length >= 100 ? "Showing the latest 100 requests" : "";
  document.getElementById("previous-page").disabled = state.page === 0;
  document.getElementById("next-page").disabled = start + 20 >= items.length;
  document.getElementById("page-number").textContent = items.length ? `Page ${state.page + 1}` : "";
  tbody.innerHTML = visible.length ? visible.map(verificationRow).join("") : `<tr><td colspan="5" class="empty"><h2>${state.items.length ? "No matching carriers" : "Your carrier list starts here"}</h2><p>${state.items.length ? "Try another search or status." : "Look up a USDOT number to start a verification."}</p>${state.items.length ? "" : '<button type="button" class="primary" data-new-verification>New verification</button>'}</td></tr>`;
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
      ? verificationProgress(verification).done + "/5 complete"
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

      <div class="manual-grid">${infoCard("Email", carrier.email || "Not listed")}${infoCard("Phone", formatPhone(carrier.phone))}</div>
      ${carrier.outOfService ? '<p class="inline-message error">FMCSA lists this carrier as out of service.</p>' : ''}
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
          ${verification ? `<button class="secondary" data-action="open-existing">Open existing verification</button>` : ""}
          ${verification && complete ? `<button class="primary" data-action="track-existing">Create tracking</button>` : ""}
          ${verification?.verificationUrl ? `<a class="primary quiet" target="_blank" rel="noreferrer" href="${escapeAttribute(verification.verificationUrl)}">Open carrier link</a>` : ""}
        </div>
        ${canSend || verification ? "" : `<p class="inline-message error">This carrier is missing email or phone.</p>`}
      </section>
      <details class="request-dates lookup-profile"><summary>FMCSA profile · authority, fleet & insurance</summary>      <div class="manual-grid">

        ${infoCard("Authority", carrier.authorityStatus || carrier.dotStatus || "-")}
        ${infoCard("Fleet", `${carrier.fleet?.powerUnits ?? "-"} units / ${carrier.fleet?.drivers ?? "-"} drivers`)}
      </div>

      <div class="risk-grid">
        ${riskCard("Safety", carrier.outOfService ? "Out of service" : "Not out of service", carrier.outOfService ? "bad" : "good")}
        ${riskCard("Insurance", getInsuranceLabel(carrier), getInsuranceTone(carrier))}
        ${riskCard("BOC-3", carrier.insurance?.bocFiled ? "Filed" : "Not found", carrier.insurance?.bocFiled ? "neutral" : "warn")}
        ${riskCard("Coverage", carrier.insurance?.minimumBipdAmount ? money(carrier.insurance?.minimumBipdAmount) + " min BIPD" : "No min BIPD", carrier.insurance?.minimumBipdAmount ? "neutral" : "warn")}
      </div>

</details>
    </section>
  `;
}

function findLatestVerification(dot, status = "") {
  const matches = state.items
    .filter((item) => String(item.dot) === String(dot) && (!status || item.status === status))
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

function openDetails(id, moveFocus = true) {
  if (moveFocus) detailsTrigger = document.activeElement;
  const item = state.items.find(entry => entry.id === id);
  if (!item) return;
  const complete = isVerificationComplete(item), progress = verificationProgress(item);
  const scrollTop = details.querySelector(".details-modal").scrollTop;
  details.dataset.id = id;
  detailsContent.innerHTML = `<header class="detail-hero"><p class="eyebrow">Carrier verification</p><h2 id="carrier-detail-title">${escapeHtml(item.carrierName)}</h2><span>USDOT ${escapeHtml(item.dot)} · ${escapeHtml(item.mc || "No MC")}</span><div class="detail-hero-actions"><span class="badge ${complete ? "verified" : "pending"}">${complete ? "Complete · 5/5" : progress.done + "/5 complete"}</span>${complete ? '<button id="create-tracking-from-verification" class="primary" type="button">Create tracking</button>' : ''}${item.verificationUrl ? `<button class="secondary" data-copy="${escapeAttribute(item.id)}" type="button">Copy carrier link</button>` : ''}<button id="refresh-details" class="icon-button" type="button" aria-label="Refresh verification" title="Refresh verification"><svg aria-hidden="true"><use href="#icon-refresh"></use></svg></button></div></header><div id="detail-message" class="inline-message" role="status"></div><div class="detail-grid">${infoCard("Email", item.email)}${infoCard("Phone", formatPhone(item.phone))}</div><section class="detail-section"><div class="detail-section-title"><h3>Documents</h3><span>Uploaded by carrier</span></div><div class="document-grid">${documentCard("Driver license", item.documents?.license, item.licenseUploaded, item.licenseFileName)}${documentCard("W-9", item.documents?.w9, item.w9Uploaded, item.w9FileName)}${documentCard("Insurance / COI", item.documents?.coi, item.coiUploaded, item.coiFileName)}</div></section><section class="detail-section"><div class="detail-section-title"><h3>Contact verification</h3></div><div class="checks">${checkRow("Email verified", item.emailVerified)}${checkRow("SMS code verified", item.phoneVerified)}</div></section><details class="request-dates"><summary>Request dates</summary><div class="detail-grid">${infoCard("Created", formatDate(item.createdAt))}${infoCard("Last updated", formatDate(item.updatedAt || item.createdAt))}</div></details>`;
  adminApp.inert = true;
  details.classList.add("open");
  document.getElementById("create-tracking-from-verification")?.addEventListener("click", () => { closeDetails(); window.deepTruckTracking.openCreate(item.id); });
  details.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  if (moveFocus) { details.querySelector(".details-modal").scrollTop = 0; document.getElementById("close-details").focus(); }
  else { details.querySelector(".details-modal").scrollTop = scrollTop; document.getElementById("refresh-details").focus({ preventScroll: true }); }
  document.getElementById("refresh-details").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    try {
      const response = await fetch(`${API_BASE_URL}/verification-requests/${id}`, { headers: authHeaders(), signal: AbortSignal.timeout(20000) });
      const record = await response.json(); if (!response.ok || record.error) throw new Error(record.error || "Unable to refresh verification.");
      state.items = state.items.map(item => item.id === id ? record : item);
      renderMetrics(); renderTable(); window.deepTruckTracking.updateCarriers();
      if (details.classList.contains("open") && details.dataset.id === id) openDetails(id, false);
      window.workspaceToast("Verification refreshed.");
    } catch (error) {
      if (details.classList.contains("open") && details.dataset.id === id) {
        const message = document.getElementById("detail-message"); message.textContent = error.message; message.classList.add("error"); document.getElementById("refresh-details").disabled = false;
      }
    }
  });
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
