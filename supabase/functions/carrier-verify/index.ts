import { createClient } from "npm:@supabase/supabase-js@2";

type VerificationRecord = {
  id: string;
  shipper_user_id: string | null;
  dot: string;
  carrier_name: string;
  email: string;
  phone: string;
  mc: string | null;
  status: string;
  email_verified: boolean;
  phone_verified: boolean;
  license_uploaded: boolean;
  w9_uploaded: boolean;
  coi_uploaded: boolean;
  license_bucket: string | null;
  license_path: string | null;
  license_file_name: string | null;
  w9_bucket: string | null;
  w9_path: string | null;
  w9_file_name: string | null;
  coi_bucket: string | null;
  coi_path: string | null;
  coi_file_name: string | null;
  verification_url: string | null;
  created_at: string;
  updated_at: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default;
const PUBLIC_BASE_URL = Deno.env.get("PUBLIC_BASE_URL") || `${SUPABASE_URL}/functions/v1/carrier-verify`;
const RESEND_API_KEY = mustEnv("RESEND_API_KEY");
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "CarrierVerify <verify@yourdomain.com>";
const VERIFY_APP_URL = Deno.env.get("VERIFY_APP_URL") || "http://localhost:5173";
const MOTUS_BASE_URL = Deno.env.get("MOTUS_BASE_URL") || "https://motus.dot.gov/api";
const TWILIO_ACCOUNT_SID = mustEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = mustEnv("TWILIO_AUTH_TOKEN");
const TWILIO_FROM_NUMBER = mustEnv("TWILIO_FROM_NUMBER");
const DEV_SMS_OVERRIDE_PHONE = Deno.env.get("DEV_SMS_OVERRIDE_PHONE") || "";
const DEV_EMAIL_OVERRIDE = Deno.env.get("DEV_EMAIL_OVERRIDE") || "";
const TWILIO_TRIAL_TEMPLATE_MODE = Deno.env.get("TWILIO_TRIAL_TEMPLATE_MODE") === "true";
const TWILIO_VERIFY_SERVICE_SID = Deno.env.get("TWILIO_VERIFY_SERVICE_SID") || "";
const OTP_HASH_SECRET = mustEnv("OTP_HASH_SECRET");
const LICENSE_BUCKET = Deno.env.get("LICENSE_BUCKET") || "driver-licenses";

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS.default is required.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const path = stripFunctionPrefix(url.pathname);

    if (req.method === "POST" && path === "/verification-requests") {
      return json(await createVerificationRequest(req, await req.json()));
    }

    if (req.method === "GET" && path === "/verification-requests") {
      return json(await listVerificationRequests(req, url));
    }

    const carrierLookupMatch = path.match(/^\/carrier-lookup\/(\d+)$/);
    if (req.method === "GET" && carrierLookupMatch) {
      return json(await lookupCarrier(carrierLookupMatch[1]));
    }

    const publicStatusMatch = path.match(/^\/public\/verification-requests\/([^/]+)$/);
    if (req.method === "GET" && publicStatusMatch) {
      return json(await toPublicRecord(await getRecord(publicStatusMatch[1]), false));
    }

    const statusMatch = path.match(/^\/verification-requests\/([^/]+)$/);
    if (req.method === "GET" && statusMatch) {
      return json(await toPublicRecord(await getRecordForUser(req, statusMatch[1]), true));
    }

    const verifyMatch = path.match(/^\/verify\/([^/]+)$/);
    if (req.method === "GET" && verifyMatch) {
      return html(await renderVerifyPage(await getRecord(verifyMatch[1])));
    }

    const actionMatch = path.match(/^\/verify\/([^/]+)\/(email|phone|license|w9|coi)$/);
    if (req.method === "POST" && actionMatch) {
      const [, id, action] = actionMatch;
      const body = await req.json().catch(() => ({}));
      return json(await applyCarrierAction(id, action, body));
    }

    return json({ error: "Not found." }, 404);
  } catch (error) {
    const err = error as Error & { statusCode?: number };
    return json({ error: err.message || "Server error." }, err.statusCode || 500);
  }
});

async function createVerificationRequest(req: Request, body: Record<string, unknown>) {
  const user = await requireUser(req);
  const dot = requiredString(body.dot, "dot");
  const carrierName = requiredString(body.carrierName, "carrierName");
  const email = requiredString(body.email, "email");
  const phone = requiredString(body.phone, "phone");
  const smsCode = TWILIO_VERIFY_SERVICE_SID ? "twilio-verify" : String(Math.floor(100000 + Math.random() * 900000));
  const smsCodeHash = await hashOtp(smsCode);

  const { data, error } = await supabase
    .from("carrier_verification_requests")
    .insert({
      dot,
      carrier_name: carrierName,
      email,
      phone,
      mc: String(body.mc || ""),
      shipper_user_id: user.id,
      sms_code_hash: smsCodeHash,
      status: "pending"
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  const verificationUrl = `${VERIFY_APP_URL}/verify.html?id=${data.id}`;
  const { data: updated, error: updateError } = await supabase
    .from("carrier_verification_requests")
    .update({ verification_url: verificationUrl, updated_at: new Date().toISOString() })
    .eq("id", data.id)
    .select()
    .single();

  if (updateError) throw new Error(updateError.message);

  await Promise.all([
    sendEmail(email, carrierName, verificationUrl),
    sendOtp(phone, `DeepTruck Verify code: ${smsCode}. Complete verification: ${verificationUrl}`)
  ]);

  return await toPublicRecord(updated);
}

async function applyCarrierAction(id: string, action: string, body: Record<string, unknown>) {
  const record = await getRecord(id);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (action === "email") {
    patch.email_verified = true;
  }

  if (action === "phone") {
    const code = String(body.code || "").trim();
    const valid = TWILIO_TRIAL_TEMPLATE_MODE && !TWILIO_VERIFY_SERVICE_SID
      ? true
      : TWILIO_VERIFY_SERVICE_SID
        ? await checkVerifyOtp(record.phone, requiredString(code, "code"))
        : (await hashOtp(requiredString(code, "code"))) === record.sms_code_hash;
    if (!valid) {
      return { error: "Invalid SMS code." };
    }
    patch.phone_verified = true;
  }

  if (["license", "w9", "coi"].includes(action)) {
    const uploaded = await uploadDocument(id, action, body);
    patch[`${action}_uploaded`] = true;
    patch[`${action}_bucket`] = uploaded.bucket;
    patch[`${action}_path`] = uploaded.path;
    patch[`${action}_file_name`] = uploaded.fileName;
  }

  const next = {
    email_verified: Boolean(action === "email" ? true : record.email_verified),
    phone_verified: Boolean(action === "phone" ? true : record.phone_verified),
    license_uploaded: Boolean(action === "license" ? true : record.license_uploaded),
    w9_uploaded: Boolean(action === "w9" ? true : record.w9_uploaded),
    coi_uploaded: Boolean(action === "coi" ? true : record.coi_uploaded)
  };
  patch.status = next.email_verified && next.phone_verified && next.license_uploaded && next.w9_uploaded && next.coi_uploaded
    ? "verified"
    : "pending";

  const { data, error } = await supabase
    .from("carrier_verification_requests")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return await toPublicRecord(data);
}

async function getRecord(id: string) {
  const { data, error } = await supabase
    .from("carrier_verification_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    const notFound = new Error("Verification request was not found.") as Error & { statusCode?: number };
    notFound.statusCode = 404;
    throw notFound;
  }
  return data;
}

async function getRecordForUser(req: Request, id: string) {
  const user = await requireUser(req);
  const { data, error } = await supabase
    .from("carrier_verification_requests")
    .select("*")
    .eq("id", id)
    .eq("shipper_user_id", user.id)
    .single();

  if (error || !data) {
    const notFound = new Error("Verification request was not found for this account.") as Error & { statusCode?: number };
    notFound.statusCode = 404;
    throw notFound;
  }
  return data;
}

async function listVerificationRequests(req: Request, url: URL) {
  const user = await requireUser(req);
  const limit = Math.min(Number(url.searchParams.get("limit") || "50"), 100);
  const { data, error } = await supabase
    .from("carrier_verification_requests")
    .select("*")
    .eq("shipper_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return {
    items: await Promise.all((data || []).map((record) => toPublicRecord(record, true))),
    count: data?.length || 0
  };
}

async function sendEmail(to: string, carrierName: string, verificationUrl: string) {
  const recipient = DEV_EMAIL_OVERRIDE || to;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [recipient],
      subject: "Action required: carrier verification",
      html: renderEmail(carrierName, verificationUrl)
    })
  });
  if (!res.ok) throw new Error(`Resend failed: ${await res.text()}`);
}

function renderEmail(carrierName: string, verificationUrl: string) {
  return `<!doctype html>
<html>
<body style="margin:0;background:#f7f8fa;font-family:Inter,Arial,Helvetica,sans-serif;color:#161a20">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f8fa;padding:28px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e7ec;border-radius:12px;overflow:hidden;box-shadow:0 16px 40px rgba(31,42,56,.08)">
          <tr>
            <td style="height:3px;background:linear-gradient(90deg,#18202b,#315efb,#b7c6ff);font-size:0;line-height:0">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:22px 24px 18px;border-bottom:1px solid #e3e7ec">
              <div style="font-family:Consolas,Menlo,monospace;font-size:11px;font-weight:800;color:#315efb;text-transform:uppercase;letter-spacing:.08em">&gt;_ DeepTruck Verify</div>
              <div style="font-size:26px;line-height:1.08;font-weight:850;margin-top:8px;color:#161a20">Carrier verification required</div>
              <div style="display:inline-block;margin-top:12px;border:1px solid #d6e0ff;background:#eef3ff;color:#315efb;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:800">Pre-load identity check</div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 24px 24px">
              <p style="font-size:16px;line-height:1.5;margin:0 0 10px;color:#161a20">Hi ${esc(carrierName)},</p>
              <p style="font-size:14px;line-height:1.65;margin:0 0 18px;color:#68717d">A shipper needs to verify your carrier identity before assigning a vehicle load. Please complete the checklist below.</p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #edf0f3;border-radius:9px;overflow:hidden;margin:0 0 20px;background:#fbfcfd">
                <tr>
                  <td style="padding:11px 12px;border-bottom:1px solid #edf0f3;font-size:13px;font-weight:800;color:#161a20">Email confirmation</td>
                  <td align="right" style="padding:11px 12px;border-bottom:1px solid #edf0f3;font-family:Consolas,Menlo,monospace;font-size:10px;color:#315efb;font-weight:800">AUTO</td>
                </tr>
                <tr>
                  <td style="padding:11px 12px;border-bottom:1px solid #edf0f3;font-size:13px;font-weight:800;color:#161a20">SMS code verification</td>
                  <td align="right" style="padding:11px 12px;border-bottom:1px solid #edf0f3;font-family:Consolas,Menlo,monospace;font-size:10px;color:#8b650e;font-weight:800">REQUIRED</td>
                </tr>
                <tr>
                  <td style="padding:11px 12px;border-bottom:1px solid #edf0f3;font-size:13px;font-weight:800;color:#161a20">Driver license upload</td>
                  <td align="right" style="padding:11px 12px;border-bottom:1px solid #edf0f3;font-family:Consolas,Menlo,monospace;font-size:10px;color:#8b650e;font-weight:800">REQUIRED</td>
                </tr>
                <tr>
                  <td style="padding:11px 12px;border-bottom:1px solid #edf0f3;font-size:13px;font-weight:800;color:#161a20">W-9 upload</td>
                  <td align="right" style="padding:11px 12px;border-bottom:1px solid #edf0f3;font-family:Consolas,Menlo,monospace;font-size:10px;color:#8b650e;font-weight:800">REQUIRED</td>
                </tr>
                <tr>
                  <td style="padding:11px 12px;font-size:13px;font-weight:800;color:#161a20">COI upload</td>
                  <td align="right" style="padding:11px 12px;font-family:Consolas,Menlo,monospace;font-size:10px;color:#8b650e;font-weight:800">REQUIRED</td>
                </tr>
              </table>

              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 18px">
                <tr>
                  <td>
                    <a href="${esc(verificationUrl)}" style="display:inline-block;background:#18202b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:850;border-radius:7px;padding:12px 15px">Open verification</a>
                  </td>
                </tr>
              </table>
              <p style="font-size:11px;line-height:1.5;margin:0;color:#68717d">This request is required before the shipper releases load details. If you did not expect this request, you can ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendOtp(to: string, body: string) {
  if (TWILIO_VERIFY_SERVICE_SID) {
    await startVerifyOtp(to);
    return;
  }
  await sendSms(to, body);
}

async function startVerifyOtp(to: string) {
  const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const recipient = normalizeSmsPhone(DEV_SMS_OVERRIDE_PHONE || to);
  const params = new URLSearchParams({ To: recipient, Channel: "sms" });
  const res = await fetch(`https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  if (!res.ok) throw new Error(`Twilio Verify failed: ${await res.text()}`);
}

async function checkVerifyOtp(to: string, code: string) {
  const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const recipient = normalizeSmsPhone(DEV_SMS_OVERRIDE_PHONE || to);
  const params = new URLSearchParams({ To: recipient, Code: code });
  const res = await fetch(`https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio Verify check failed: ${JSON.stringify(data)}`);
  return data.status === "approved";
}

async function sendSms(to: string, body: string) {
  const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const recipient = DEV_SMS_OVERRIDE_PHONE || to;
  const params = new URLSearchParams({
    To: normalizeSmsPhone(recipient),
    From: TWILIO_FROM_NUMBER,
    Body: TWILIO_TRIAL_TEMPLATE_MODE ? "sms_2fa" : body
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  if (!res.ok) throw new Error(`Twilio failed: ${await res.text()}`);
}

async function toPublicRecord(record: VerificationRecord, includeDocumentUrls = false) {
  const complete = Boolean(record.email_verified && record.phone_verified && record.license_uploaded && record.w9_uploaded && record.coi_uploaded);
  const documents = {
    license: await toDocument("Driver license", record.license_uploaded, record.license_bucket, record.license_path, record.license_file_name, includeDocumentUrls),
    w9: await toDocument("W-9", record.w9_uploaded, record.w9_bucket, record.w9_path, record.w9_file_name, includeDocumentUrls),
    coi: await toDocument("COI", record.coi_uploaded, record.coi_bucket, record.coi_path, record.coi_file_name, includeDocumentUrls)
  };

  return {
    id: record.id,
    dot: record.dot,
    carrierName: record.carrier_name,
    email: record.email,
    phone: record.phone,
    mc: record.mc || "",
    status: complete ? "verified" : "pending",
    emailVerified: record.email_verified,
    phoneVerified: record.phone_verified,
    licenseUploaded: record.license_uploaded,
    w9Uploaded: record.w9_uploaded,
    coiUploaded: record.coi_uploaded,
    smsTrialMode: TWILIO_TRIAL_TEMPLATE_MODE && !TWILIO_VERIFY_SERVICE_SID,
    verificationUrl: record.verification_url || "",
    licenseFileName: record.license_file_name || "",
    w9FileName: record.w9_file_name || "",
    coiFileName: record.coi_file_name || "",
    documents,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

async function toDocument(label: string, uploaded: boolean, bucket: string | null, path: string | null, fileName: string | null, includeUrl: boolean) {
  let url = "";
  if (includeUrl && uploaded && bucket && path) {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
    url = data?.signedUrl || "";
  }
  return {
    label,
    uploaded: Boolean(uploaded),
    fileName: fileName || "",
    url
  };
}

async function renderVerifyPage(record: VerificationRecord) {
  const status = await toPublicRecord(record);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Carrier verification</title>
<style>
body{margin:0;background:#f6f7f9;color:#17202b;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:680px;margin:0 auto;padding:28px 16px}section{background:#fff;border:1px solid #dfe4ea;border-radius:8px;margin-bottom:12px;padding:18px}
h1{font-size:24px;margin:0 0 6px}h2{font-size:15px;margin:0 0 10px}p{color:#657083;font-size:13px;line-height:1.45;margin:0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.box{border:1px solid #e1e6ed;border-radius:7px;padding:10px}.box span{display:block;color:#778293;font-size:11px;font-weight:800}.box b{display:block;font-size:13px;margin-top:3px;overflow-wrap:anywhere}
button{background:#17202b;border:0;border-radius:7px;color:#fff;cursor:pointer;font-weight:850;min-height:38px;padding:0 14px}button.done{background:#177245}
input{border:1px solid #cbd5e1;border-radius:7px;font:inherit;min-height:38px;padding:0 10px;width:100%}.row{display:flex;gap:8px}.checks{display:grid;gap:8px}.check{color:#657083;font-size:13px;font-weight:800}.check.done{color:#177245}.msg{color:#177245;font-size:12px;font-weight:800;margin-top:10px}
@media(max-width:560px){.grid{grid-template-columns:1fr}.row{display:grid}}
</style>
</head>
<body><main>
<section><h1>Carrier verification</h1><p>${esc(status.carrierName)} · USDOT ${esc(status.dot)}</p><div class="grid"><div class="box"><span>Email</span><b>${esc(status.email)}</b></div><div class="box"><span>Phone</span><b>${esc(status.phone)}</b></div></div></section>
<section><h2>Status</h2><div class="checks"><div class="check ${status.emailVerified ? "done" : ""}">${status.emailVerified ? "Done" : "Pending"}: email verified</div><div class="check ${status.phoneVerified ? "done" : ""}">${status.phoneVerified ? "Done" : "Pending"}: SMS code verified</div><div class="check ${status.licenseUploaded ? "done" : ""}">${status.licenseUploaded ? "Done" : "Pending"}: driver license uploaded</div><div class="check ${status.w9Uploaded ? "done" : ""}">${status.w9Uploaded ? "Done" : "Pending"}: W-9 uploaded</div><div class="check ${status.coiUploaded ? "done" : ""}">${status.coiUploaded ? "Done" : "Pending"}: COI uploaded</div></div></section>
<section><h2>Email</h2><button id="email" class="${status.emailVerified ? "done" : ""}">${status.emailVerified ? "Email verified" : "Verify email"}</button></section>
<section><h2>Phone</h2><div class="row"><input id="code" placeholder="SMS code"><button id="phone" class="${status.phoneVerified ? "done" : ""}">${status.phoneVerified ? "Phone verified" : "Verify phone"}</button></div><div id="phone-msg" class="msg"></div></section>
<section><h2>Driver license</h2><div class="row"><input id="license" type="file" accept="image/*,.pdf"><button id="upload" class="${status.licenseUploaded ? "done" : ""}">${status.licenseUploaded ? "License uploaded" : "Upload license"}</button></div><div id="license-msg" class="msg">${esc(status.licenseFileName || "")}</div></section>
<section><h2>W-9</h2><div class="row"><input id="w9" type="file" accept="image/*,.pdf"><button id="upload-w9" class="${status.w9Uploaded ? "done" : ""}">${status.w9Uploaded ? "W-9 uploaded" : "Upload W-9"}</button></div><div id="w9-msg" class="msg">${esc(status.w9FileName || "")}</div></section>
<section><h2>COI</h2><div class="row"><input id="coi" type="file" accept="image/*,.pdf"><button id="upload-coi" class="${status.coiUploaded ? "done" : ""}">${status.coiUploaded ? "COI uploaded" : "Upload COI"}</button></div><div id="coi-msg" class="msg">${esc(status.coiFileName || "")}</div></section>
</main>
<script>
const id=${JSON.stringify(status.id)};
const post=(action,body)=>fetch(location.pathname+"/"+action,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})}).then(async r=>{const d=await r.json();if(!r.ok||d.error)throw new Error(d.error||"Request failed");return d});
document.getElementById("email").onclick=async()=>{await post("email");location.reload()};
document.getElementById("phone").onclick=async()=>{try{await post("phone",{code:document.getElementById("code").value});location.reload()}catch(e){document.getElementById("phone-msg").textContent=e.message}};
const upload=(action,inputId,msgId)=>{const file=document.getElementById(inputId).files[0];if(!file){document.getElementById(msgId).textContent="Choose a file first.";return}const reader=new FileReader();reader.onload=async()=>{await post(action,{fileName:file.name,fileData:reader.result});location.reload()};reader.readAsDataURL(file)};
document.getElementById("upload").onclick=async()=>upload("license","license","license-msg");
document.getElementById("upload-w9").onclick=async()=>upload("w9","w9","w9-msg");
document.getElementById("upload-coi").onclick=async()=>upload("coi","coi","coi-msg");
</script>
</body></html>`;
}

function stripFunctionPrefix(pathname: string) {
  return pathname.replace(/^\/carrier-verify/, "") || "/";
}

function response(body: string, status = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(body, { status, headers: { ...corsHeaders, "Content-Type": contentType } });
}

function json(payload: unknown, status = 200) {
  return response(JSON.stringify(payload), status, "application/json; charset=utf-8");
}

function html(body: string) {
  return response(body, 200, "text/html; charset=utf-8");
}

function requiredString(value: unknown, name: string) {
  const out = String(value || "").trim();
  if (!out) throw new Error(`${name} is required.`);
  return out;
}

async function requireUser(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token) {
    const error = new Error("Sign in is required.") as Error & { statusCode?: number };
    error.statusCode = 401;
    throw error;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    const authError = new Error("Your session is invalid or expired.") as Error & { statusCode?: number };
    authError.statusCode = 401;
    throw authError;
  }
  return data.user;
}

async function uploadDocument(id: string, type: string, body: Record<string, unknown>) {
  const fileName = requiredString(body.fileName, "fileName");
  const fileData = requiredString(body.fileData, "fileData");
  const upload = parseDataUrl(fileData);
  const path = `${id}/${type}/${Date.now()}-${safeFileName(fileName)}`;
  const { error } = await supabase.storage.from(LICENSE_BUCKET).upload(path, upload.bytes, {
    contentType: upload.contentType,
    upsert: true
  });
  if (error) throw new Error(error.message);
  return {
    bucket: LICENSE_BUCKET,
    path,
    fileName
  };
}

function mustEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function hashOtp(code: string) {
  const bytes = new TextEncoder().encode(`${code}:${OTP_HASH_SECRET}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid license file payload.");
  return {
    contentType: match[1],
    bytes: Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0))
  };
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function normalizeSmsPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.trim().startsWith("+")) return phone.trim();
  return phone;
}

async function lookupCarrier(dot: string) {
  if (!/^\d{5,8}$/.test(dot)) {
    const error = new Error("Enter a valid USDOT number.") as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  const carrier = await getMotusJson(`${MOTUS_BASE_URL}/carriers/${dot}`);
  const auth = getAuthorities(carrier)[0] || null;
  let authorityView = null;
  let minimumInsurance = null;

  if (auth?.entityOperatingAuthorityId) {
    const authorityId = auth.entityOperatingAuthorityId;
    const [oaResult, minResult] = await Promise.allSettled([
      getMotusJson(`${MOTUS_BASE_URL}/regulatedEntity/oa/${authorityId}/getOAPublicView`),
      getMotusJson(`${MOTUS_BASE_URL}/filings/minimum-bipd/${authorityId}`)
    ]);
    authorityView = oaResult.status === "fulfilled" ? oaResult.value : null;
    minimumInsurance = minResult.status === "fulfilled" ? minResult.value : null;
  }

  return normalizeCarrier(dot, carrier, auth, authorityView, minimumInsurance);
}

async function getMotusJson(url: string) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("MOTUS returned a non-JSON response.");
  }
  if (!response.ok) {
    const error = new Error(`MOTUS lookup failed: ${response.status} ${response.statusText}`) as Error & { statusCode?: number };
    error.statusCode = response.status === 404 ? 404 : 502;
    throw error;
  }
  return data;
}

function normalizeCarrier(
  dot: string,
  carrier: Record<string, any>,
  authority: Record<string, any> | null,
  authorityView: Record<string, any> | null,
  minimumInsurance: Record<string, any> | null
) {
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
    outOfService: Boolean(carrier?.outOfService),
    email: cleanEmail(getPrimaryEmail(carrier)),
    phone: cleanPhone(getPrimaryPhone(carrier)),
    fleet: {
      powerUnits: detail.powerUnitTotal ?? detail.powerUnitsTotal ?? detail.powerUnits ?? null,
      drivers: detail.driverTotal ?? null
    },
    insurance: {
      minimumBipdAmount: minimumInsurance?.minimumBipdAmount ?? minimumInsurance?.bipdAmount ?? null,
      currentFilings: filings.map((filing: Record<string, any>) => ({
        cancellationDate: filing.cancellationDate || null,
        effectiveDate: filing.effectiveDate || null,
        status: filing.status?.filingStatusDesc || filing.status?.filingStatus || ""
      })),
      bocFiled: boc.length > 0
    }
  };
}

function getAuthorities(carrier: Record<string, any>) {
  const out = [];
  for (const registration of carrier?.entityRegistrations || []) {
    for (const link of registration.entityRegistrationOperatingAuthorities || []) {
      const authority = link.entityOperatingAuthority || {};
      if (authority.entityOperatingAuthorityId) out.push(authority);
    }
  }
  return [...new Map(out.map((item) => [item.entityOperatingAuthorityId, item])).values()];
}

function getCarrierName(carrier: Record<string, any>) {
  return (
    carrier?.entityName ||
    carrier?.entityNames?.find((entry: Record<string, any>) => entry.nameType === "Legal")?.entityName ||
    carrier?.entityNames?.[0]?.entityName ||
    "Unknown carrier"
  );
}

function getPrimaryEmail(carrier: Record<string, any>) {
  return (
    carrier?.emailAddresses?.find((entry: Record<string, any>) => entry.primaryAddressFlag)?.emailAddress ||
    carrier?.emailAddresses?.[0]?.emailAddress ||
    ""
  );
}

function getPrimaryPhone(carrier: Record<string, any>) {
  return carrier?.phoneNumbers?.[0]?.phoneNumber || "";
}

function cleanEmail(value: unknown) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanPhone(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return "";
}

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]!);
}
