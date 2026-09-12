const API_BASE_URL = "https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/carrier-verify";
const state = { items: [], query: "" };

const views = document.querySelectorAll(".view");
const navButtons = document.querySelectorAll("nav button");
const title = document.getElementById("page-title");
const tbody = document.getElementById("history-body");
const details = document.getElementById("details");
const detailsContent = document.getElementById("details-content");

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    navButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    views.forEach((view) => view.classList.toggle("active", view.id === button.dataset.view));
    title.textContent = button.textContent;
  });
});

document.getElementById("search").addEventListener("input", (event) => {
  state.query = event.target.value.toLowerCase();
  renderTable();
});

document.getElementById("close-details").addEventListener("click", () => {
  details.classList.remove("open");
});

load();

async function load() {
  try {
    const response = await fetch(`${API_BASE_URL}/verification-requests?limit=100`);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Failed to load history.");
    state.items = data.items || [];
    renderMetrics();
    renderTable();
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderMetrics() {
  const verified = state.items.filter((item) => item.status === "verified").length;
  const pending = state.items.filter((item) => item.status !== "verified").length;
  document.getElementById("metric-total").textContent = state.items.length;
  document.getElementById("metric-verified").textContent = verified;
  document.getElementById("metric-pending").textContent = pending;
}

function renderTable() {
  const items = state.items.filter((item) => {
    const haystack = `${item.carrierName} ${item.dot} ${item.mc} ${item.email} ${item.phone}`.toLowerCase();
    return haystack.includes(state.query);
  });

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No verification requests found.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map((item) => `
    <tr data-id="${escapeHtml(item.id)}">
      <td class="carrier"><b>${escapeHtml(item.carrierName)}</b><span>${escapeHtml(item.id.slice(0, 8))}</span></td>
      <td><b>${escapeHtml(item.dot)}</b><div class="sub">${escapeHtml(item.mc || "-")}</div></td>
      <td>${escapeHtml(item.email)}<div class="sub">${formatPhone(item.phone)}</div></td>
      <td><span class="badge ${item.status === "verified" ? "verified" : "pending"}">${escapeHtml(item.status)}</span></td>
      <td>${formatDate(item.createdAt)}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", () => openDetails(row.dataset.id));
  });
}

function openDetails(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  detailsContent.innerHTML = `
    <div class="detail-title">
      <h2>${escapeHtml(item.carrierName)}</h2>
      <p class="muted">USDOT ${escapeHtml(item.dot)} · ${escapeHtml(item.mc || "No MC")}</p>
    </div>
    <div class="checks">
      <div>Email verified <b class="${item.emailVerified ? "done" : ""}">${item.emailVerified ? "Done" : "Pending"}</b></div>
      <div>SMS verified <b class="${item.phoneVerified ? "done" : ""}">${item.phoneVerified ? "Done" : "Pending"}</b></div>
      <div>License uploaded <b class="${item.licenseUploaded ? "done" : ""}">${item.licenseUploaded ? "Done" : "Pending"}</b></div>
    </div>
    <div class="detail-title">
      <p class="muted">Email</p><h2>${escapeHtml(item.email)}</h2>
      <p class="muted" style="margin-top:12px">Phone</p><h2>${formatPhone(item.phone)}</h2>
      <p class="muted" style="margin-top:12px">Started</p><h2>${formatDate(item.createdAt)}</h2>
    </div>
  `;
  details.classList.add("open");
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
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
