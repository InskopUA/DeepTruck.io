const MOTUS_BASE = "https://motus.dot.gov/api";
const DEFAULT_API_BASE_URL = "https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/carrier-verify";
const SUPABASE_URL = "https://yqpeebgmqtqoxumzfrsq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GaoXNE-0hGpMDv3cMy3QDA_UfQuvvIM";

const DEMO_DELAY_MS = 450;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  routeMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function routeMessage(message) {
  switch (message?.type) {
    case "carrier.lookup":
      return lookupCarrier(message.dot, message.pageContact || {});
    case "verification.create":
      return createVerification(message.carrier);
    case "verification.get":
      return getVerification(message.verificationId);
    case "auth.login":
      return login(message.email, message.password);
    case "auth.logout":
      return logout();
    case "account.open":
      await chrome.runtime.openOptionsPage();
      return {};
    case "auth.get":
      return getAuthState();
    case "settings.get":
      return getSettings();
    case "settings.save":
      return saveSettings(message.settings);
    default:
      throw new Error("Unsupported DeepTruck action.");
  }
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("MOTUS returned a non-JSON response.");
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return data;
}

async function lookupCarrier(dot, pageContact = {}) {
  const cleanDot = String(dot || "").replace(/\D/g, "");
  if (!/^\d{5,8}$/.test(cleanDot)) {
    throw new Error("A valid USDOT number was not found on this page.");
  }

  const carrier = await getJson(`${MOTUS_BASE}/carriers/${cleanDot}`);
  const auth = getAuthorities(carrier)[0] || null;

  let authorityView = null;
  let minimumInsurance = null;
  if (auth?.entityOperatingAuthorityId) {
    const authorityId = auth.entityOperatingAuthorityId;
    const [oaResult, minResult] = await Promise.allSettled([
      getJson(`${MOTUS_BASE}/regulatedEntity/oa/${authorityId}/getOAPublicView`),
      getJson(`${MOTUS_BASE}/filings/minimum-bipd/${authorityId}`)
    ]);
    authorityView = oaResult.status === "fulfilled" ? oaResult.value : null;
    minimumInsurance = minResult.status === "fulfilled" ? minResult.value : null;
  }

  const normalized = normalizeCarrier(cleanDot, carrier, auth, authorityView, minimumInsurance, pageContact);
  await upsertCarrier(normalized);
  return normalized;
}

function getAuthorities(carrier) {
  const out = [];
  for (const registration of carrier?.entityRegistrations || []) {
    for (const link of registration.entityRegistrationOperatingAuthorities || []) {
      const authority = link.entityOperatingAuthority || {};
      if (authority.entityOperatingAuthorityId) out.push(authority);
    }
  }
  return [...new Map(out.map((item) => [item.entityOperatingAuthorityId, item])).values()];
}

function normalizeCarrier(dot, carrier, authority, authorityView, minimumInsurance, pageContact = {}) {
  const address = getMainAddress(carrier);
  const detail = carrier?.carrierEntityDetail || {};
  const filings = authorityView?.insuranceFilings || [];
  const boc = authorityView?.blanketFilings || authority?.blanketFilings || [];
  const statusName =
    carrier?.entityDotNumber?.dotNumberStatus?.dotNumberStatusName ||
    carrier?.entityDotNumber?.dotNumberStatus?.dotNumberStatus ||
    (carrier?.outOfService ? "Out of service" : "Active");

  return {
    dot,
    name: getCarrierName(carrier),
    mc: authority?.docketNumber || "",
    dotStatus: statusName,
    authorityStatus: authority?.operatingAuthorityStatus?.operatingAuthorityStatusName || "",
    authorityType: authority?.operatingAuthorityType?.operatingAuthorityType || "",
    outOfService: Boolean(carrier?.outOfService),
    activeSince: carrier?.createDate || carrier?.entityDotNumber?.createDate || pageContact.yearEstablished || null,
    fmcsaUpdatedAt: detail.mcs150Date || carrier?.updateDate || detail.updateDate || pageContact.lastUpdated || null,
    email: cleanEmail(getPrimaryEmail(carrier)) || cleanEmail(pageContact.email),
    phone: cleanPhone(getPrimaryPhone(carrier)) || cleanPhone(pageContact.phone),
    address: [address.addressLine1, address.addressLine2, address.city, address.state, address.zipCode]
      .filter(Boolean)
      .join(", "),
    fleet: {
      powerUnits: detail.powerUnitTotal ?? detail.powerUnitsTotal ?? detail.powerUnits ?? null,
      drivers: detail.driverTotal ?? null,
      mcs150Date: detail.mcs150Date || null
    },
    insurance: {
      minimumBipdAmount: minimumInsurance?.minimumBipdAmount ?? minimumInsurance?.bipdAmount ?? null,
      currentFilings: filings.map((filing) => ({
        form: filing.insuranceForm?.insuranceForm || "Insurance filing",
        provider:
          filing.legacyFilerNumber?.companyName ||
          filing.legacyFilerNumber?.entity?.entityName ||
          filing.insuranceEntity?.entityName ||
          "",
        maxCoverage: filing.maxCovAmount ?? null,
        status: filing.status?.filingStatusDesc || filing.status?.filingStatus || "",
        effectiveDate: filing.effectiveDate || null,
        cancellationDate: filing.cancellationDate || null
      })),
      bocFiled: boc.length > 0
    },
    raw: { carrier, authorityView, minimumInsurance },
    updatedAt: new Date().toISOString()
  };
}

function getCarrierName(carrier) {
  return (
    carrier?.entityName ||
    carrier?.entityNames?.find((entry) => entry.nameType === "Legal")?.entityName ||
    carrier?.entityNames?.[0]?.entityName ||
    "Unknown carrier"
  );
}

function getMainAddress(carrier) {
  const locations = carrier?.locations || [];
  return locations.find((entry) => entry.primaryAddressFlag) || locations[0] || {};
}

function getPrimaryEmail(carrier) {
  return (
    carrier?.emailAddresses?.find((entry) => entry.primaryAddressFlag)?.emailAddress ||
    carrier?.emailAddresses?.[0]?.emailAddress ||
    ""
  );
}

function getPrimaryPhone(carrier) {
  return carrier?.phoneNumbers?.[0]?.phoneNumber || "";
}

function cleanEmail(value) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return "";
}

async function upsertCarrier(carrier) {
  const { carriers = {} } = await chrome.storage.local.get("carriers");
  carriers[carrier.dot] = carrier;
  await chrome.storage.local.set({ carriers });
}

async function createVerification(carrier) {
  const settings = await getSettings();
  const authHeaders = await getApiAuthHeaders(settings);
  const payload = {
    dot: carrier.dot,
    carrierName: carrier.name,
    email: carrier.email,
    phone: carrier.phone,
    mc: carrier.mc,
    createdAt: new Date().toISOString()
  };

  if (settings.apiBaseUrl) {
    const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, "")}/verification-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Verification API request failed.");
    return persistVerification(data);
  }

  await sleep(DEMO_DELAY_MS);
  return persistVerification({
    id: `demo-${carrier.dot}-${Date.now()}`,
    dot: carrier.dot,
    carrierName: carrier.name,
    email: carrier.email,
    phone: carrier.phone,
    status: "pending",
    emailVerified: false,
    phoneVerified: false,
    licenseUploaded: false,
    w9Uploaded: false,
    coiUploaded: false,
    verificationUrl: `https://carrierverify.local/verify/demo-${carrier.dot}`,
    demoMode: true,
    createdAt: new Date().toISOString()
  });
}

async function getVerification(verificationId) {
  const { verifications = {} } = await chrome.storage.local.get("verifications");
  const record = verifications[verificationId];
  if (!record) throw new Error("Verification request was not found.");

  const settings = await getSettings();
  if (settings.apiBaseUrl && !record.demoMode) {
    const authHeaders = await getApiAuthHeaders(settings);
    const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, "")}/verification-requests/${verificationId}`, {
      headers: {
        Accept: "application/json",
        ...authHeaders
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Verification API status request failed.");
    return persistVerification(data);
  }

  if (record.demoMode && record.status !== "verified") {
    const advanced = advanceDemoVerification(record);
    return persistVerification(advanced);
  }

  return record;
}

async function persistVerification(record) {
  const normalized = {
    id: record.id || record.verificationId,
    dot: record.dot,
    carrierName: record.carrierName,
    email: record.email,
    phone: record.phone,
    status: record.status || "pending",
    emailVerified: Boolean(record.emailVerified),
    phoneVerified: Boolean(record.phoneVerified),
    licenseUploaded: Boolean(record.licenseUploaded),
    w9Uploaded: Boolean(record.w9Uploaded),
    coiUploaded: Boolean(record.coiUploaded),
    licenseFileName: record.licenseFileName || "",
    w9FileName: record.w9FileName || "",
    coiFileName: record.coiFileName || "",
    documents: record.documents || {},
    verificationUrl: record.verificationUrl || "",
    demoMode: Boolean(record.demoMode),
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!normalized.id) throw new Error("Verification API did not return an id.");

  const { verifications = {}, dotVerificationMap = {} } = await chrome.storage.local.get([
    "verifications",
    "dotVerificationMap"
  ]);
  verifications[normalized.id] = normalized;
  dotVerificationMap[normalized.dot] = normalized.id;
  await chrome.storage.local.set({ verifications, dotVerificationMap });
  return normalized;
}

async function getSettings() {
  const { settings = {} } = await chrome.storage.sync.get("settings");
  return {
    apiBaseUrl: settings.apiBaseUrl || DEFAULT_API_BASE_URL,
    apiKey: settings.apiKey || ""
  };
}

async function saveSettings(settings) {
  const clean = {
    apiBaseUrl: String(settings?.apiBaseUrl || "").trim().replace(/\/$/, ""),
    apiKey: String(settings?.apiKey || "").trim()
  };
  await chrome.storage.sync.set({ settings: clean });
  return clean;
}

async function login(email, password) {
  const cleanEmail = String(email || "").trim();
  const cleanPassword = String(password || "");
  if (!cleanEmail || !cleanPassword) throw new Error("Email and password are required.");

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email: cleanEmail, password: cleanPassword })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.msg || data.error || "Login failed.");

  const session = normalizeSession(data);
  await chrome.storage.local.set({ authSession: session });
  return getAuthState();
}

async function logout() {
  await chrome.storage.local.remove("authSession");
  return { user: null };
}

async function getAuthState() {
  const session = await getValidSession(true);
  const settings = await getSettings();
  return {
    user: session?.user ? { id: session.user.id, email: session.user.email, user_metadata: session.user.user_metadata || {} } : null,
    canVerify: Boolean(session?.access_token || settings.apiKey)
  };
}

async function getApiAuthHeaders(settings) {
  if (settings.apiKey) return { Authorization: `Bearer ${settings.apiKey}` };
  const session = await getValidSession(true);
  if (!session?.access_token) throw new Error("Sign in to DeepTruck Verify before sending verification requests.");
  return { Authorization: `Bearer ${session.access_token}` };
}

async function getValidSession(allowRefresh) {
  const { authSession } = await chrome.storage.local.get("authSession");
  if (!authSession?.access_token) return null;
  if (!allowRefresh || !isSessionExpired(authSession)) return authSession;
  if (!authSession.refresh_token) return null;
  return refreshSession(authSession.refresh_token);
}

function isSessionExpired(session) {
  const expiresAt = Number(session.expires_at || 0);
  return expiresAt && Date.now() > (expiresAt - 60) * 1000;
}

async function refreshSession(refreshToken) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await chrome.storage.local.remove("authSession");
    throw new Error("Your session expired. Sign in again in extension settings.");
  }
  const session = normalizeSession(data);
  await chrome.storage.local.set({ authSession: session });
  return session;
}

function normalizeSession(data) {
  const expiresIn = Number(data.expires_in || 3600);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type || "bearer",
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + expiresIn,
    user: data.user || null
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function advanceDemoVerification(record) {
  if (!record.emailVerified) {
    return { ...record, emailVerified: true, status: "email_verified" };
  }
  if (!record.phoneVerified) {
    return { ...record, phoneVerified: true, status: "phone_verified" };
  }
  if (!record.licenseUploaded) {
    return { ...record, licenseUploaded: true, licenseFileName: "driver-license.pdf", status: "license_uploaded" };
  }
  if (!record.w9Uploaded) {
    return { ...record, w9Uploaded: true, w9FileName: "w9.pdf", status: "w9_uploaded" };
  }
  if (!record.coiUploaded) {
    return { ...record, coiUploaded: true, coiFileName: "coi.pdf", status: "verified" };
  }
  return { ...record, status: "verified" };
}
