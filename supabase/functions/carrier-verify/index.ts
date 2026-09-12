import { createClient } from "npm:@supabase/supabase-js@2";

type VerificationRecord = {
  id: string;
  dot: string;
  carrier_name: string;
  email: string;
  phone: string;
  mc: string | null;
  status: string;
  email_verified: boolean;
  phone_verified: boolean;
  license_uploaded: boolean;
  license_file_name: string | null;
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
const VERIFY_APP_URL = Deno.env.get("VERIFY_APP_URL") || "https://carrierverify.skopetskyi-serhii-us.chatgpt.site";
const TWILIO_ACCOUNT_SID = mustEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = mustEnv("TWILIO_AUTH_TOKEN");
const TWILIO_FROM_NUMBER = mustEnv("TWILIO_FROM_NUMBER");
const DEV_SMS_OVERRIDE_PHONE = Deno.env.get("DEV_SMS_OVERRIDE_PHONE") || "";
const DEV_EMAIL_OVERRIDE = Deno.env.get("DEV_EMAIL_OVERRIDE") || "";
const TWILIO_TRIAL_TEMPLATE_MODE = Deno.env.get("TWILIO_TRIAL_TEMPLATE_MODE") === "true";
const OTP_HASH_SECRET = mustEnv("OTP_HASH_SECRET");
const LICENSE_BUCKET = Deno.env.get("LICENSE_BUCKET") || "driver-licenses";

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS.default is required.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return response("", 204);

  try {
    const url = new URL(req.url);
    const path = stripFunctionPrefix(url.pathname);

    if (req.method === "POST" && path === "/verification-requests") {
      return json(await createVerificationRequest(await req.json()));
    }

    const statusMatch = path.match(/^\/verification-requests\/([^/]+)$/);
    if (req.method === "GET" && statusMatch) {
      return json(toPublicRecord(await getRecord(statusMatch[1])));
    }

    const verifyMatch = path.match(/^\/verify\/([^/]+)$/);
    if (req.method === "GET" && verifyMatch) {
      return html(renderVerifyPage(await getRecord(verifyMatch[1])));
    }

    const actionMatch = path.match(/^\/verify\/([^/]+)\/(email|phone|license)$/);
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

async function createVerificationRequest(body: Record<string, unknown>) {
  const dot = requiredString(body.dot, "dot");
  const carrierName = requiredString(body.carrierName, "carrierName");
  const email = requiredString(body.email, "email");
  const phone = requiredString(body.phone, "phone");
  const smsCode = String(Math.floor(100000 + Math.random() * 900000));
  const smsCodeHash = await hashOtp(smsCode);

  const { data, error } = await supabase
    .from("carrier_verification_requests")
    .insert({
      dot,
      carrier_name: carrierName,
      email,
      phone,
      mc: String(body.mc || ""),
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
    sendEmail(email, carrierName, verificationUrl, TWILIO_TRIAL_TEMPLATE_MODE ? smsCode : ""),
    sendSms(phone, `DeepTruck Verify code: ${smsCode}. Complete verification: ${verificationUrl}`)
  ]);

  return toPublicRecord(updated);
}

async function applyCarrierAction(id: string, action: string, body: Record<string, unknown>) {
  const record = await getRecord(id);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (action === "email") {
    patch.email_verified = true;
  }

  if (action === "phone") {
    const code = requiredString(body.code, "code");
    if ((await hashOtp(code)) !== record.sms_code_hash) {
      return { error: "Invalid SMS code." };
    }
    patch.phone_verified = true;
  }

  if (action === "license") {
    const fileName = requiredString(body.fileName, "fileName");
    const fileData = requiredString(body.fileData, "fileData");
    const upload = parseDataUrl(fileData);
    const path = `${id}/${Date.now()}-${safeFileName(fileName)}`;
    const { error } = await supabase.storage.from(LICENSE_BUCKET).upload(path, upload.bytes, {
      contentType: upload.contentType,
      upsert: true
    });
    if (error) throw new Error(error.message);
    patch.license_uploaded = true;
    patch.license_bucket = LICENSE_BUCKET;
    patch.license_path = path;
    patch.license_file_name = fileName;
  }

  const next = {
    email_verified: Boolean(action === "email" ? true : record.email_verified),
    phone_verified: Boolean(action === "phone" ? true : record.phone_verified),
    license_uploaded: Boolean(action === "license" ? true : record.license_uploaded)
  };
  patch.status = next.email_verified && next.phone_verified && next.license_uploaded ? "verified" : "pending";

  const { data, error } = await supabase
    .from("carrier_verification_requests")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return toPublicRecord(data);
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

async function sendEmail(to: string, carrierName: string, verificationUrl: string, devSmsCode = "") {
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
      html: renderEmail(carrierName, verificationUrl, devSmsCode)
    })
  });
  if (!res.ok) throw new Error(`Resend failed: ${await res.text()}`);
}

function renderEmail(carrierName: string, verificationUrl: string, devSmsCode: string) {
  return `<!doctype html>
<html>
<body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#17202b">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:28px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dbe2eb;border-radius:10px;overflow:hidden">
          <tr>
            <td style="padding:22px 24px;border-bottom:1px solid #edf1f6">
              <div style="font-size:12px;font-weight:800;color:#195bd7;text-transform:uppercase;letter-spacing:.04em">DeepTruck Verify</div>
              <div style="font-size:24px;font-weight:800;margin-top:5px;color:#141c2b">Carrier verification required</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px">
              <p style="font-size:16px;line-height:1.55;margin:0 0 14px">Hi ${esc(carrierName)},</p>
              <p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#475467">A dealer has requested verification before assigning a vehicle load. Please confirm your email, enter the SMS code, and upload the driver's license for the driver transporting the vehicle.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0">
                <tr>
                  <td>
                    <a href="${esc(verificationUrl)}" style="display:inline-block;background:#141c2b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;border-radius:8px;padding:13px 18px">Open verification</a>
                  </td>
                </tr>
              </table>
              ${devSmsCode ? `<div style="background:#fff8e7;border:1px solid #efd98d;border-radius:8px;padding:12px 14px;margin-top:16px"><div style="font-size:12px;font-weight:800;color:#8a5d08;text-transform:uppercase">Development SMS code</div><div style="font-size:24px;font-weight:800;color:#141c2b;margin-top:4px">${esc(devSmsCode)}</div><div style="font-size:12px;color:#8a5d08;margin-top:4px">Twilio trial SMS uses its own template code. Use this code for the app until Twilio is upgraded.</div></div>` : ""}
              <p style="font-size:12px;line-height:1.5;margin:22px 0 0;color:#667085">If you did not expect this request, you can ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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

function toPublicRecord(record: VerificationRecord) {
  return {
    id: record.id,
    dot: record.dot,
    carrierName: record.carrier_name,
    email: record.email,
    phone: record.phone,
    mc: record.mc || "",
    status: record.status,
    emailVerified: record.email_verified,
    phoneVerified: record.phone_verified,
    licenseUploaded: record.license_uploaded,
    verificationUrl: record.verification_url || "",
    licenseFileName: record.license_file_name || "",
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

function renderVerifyPage(record: VerificationRecord) {
  const status = toPublicRecord(record);
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
<section><h2>Status</h2><div class="checks"><div class="check ${status.emailVerified ? "done" : ""}">${status.emailVerified ? "Done" : "Pending"}: email verified</div><div class="check ${status.phoneVerified ? "done" : ""}">${status.phoneVerified ? "Done" : "Pending"}: SMS code verified</div><div class="check ${status.licenseUploaded ? "done" : ""}">${status.licenseUploaded ? "Done" : "Pending"}: driver license uploaded</div></div></section>
<section><h2>Email</h2><button id="email" class="${status.emailVerified ? "done" : ""}">${status.emailVerified ? "Email verified" : "Verify email"}</button></section>
<section><h2>Phone</h2><div class="row"><input id="code" placeholder="SMS code"><button id="phone" class="${status.phoneVerified ? "done" : ""}">${status.phoneVerified ? "Phone verified" : "Verify phone"}</button></div><div id="phone-msg" class="msg"></div></section>
<section><h2>Driver license</h2><div class="row"><input id="license" type="file" accept="image/*,.pdf"><button id="upload" class="${status.licenseUploaded ? "done" : ""}">${status.licenseUploaded ? "License uploaded" : "Upload license"}</button></div><div id="license-msg" class="msg">${esc(status.licenseFileName || "")}</div></section>
</main>
<script>
const id=${JSON.stringify(status.id)};
const post=(action,body)=>fetch(location.pathname+"/"+action,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})}).then(async r=>{const d=await r.json();if(!r.ok||d.error)throw new Error(d.error||"Request failed");return d});
document.getElementById("email").onclick=async()=>{await post("email");location.reload()};
document.getElementById("phone").onclick=async()=>{try{await post("phone",{code:document.getElementById("code").value});location.reload()}catch(e){document.getElementById("phone-msg").textContent=e.message}};
document.getElementById("upload").onclick=async()=>{const file=document.getElementById("license").files[0];if(!file){document.getElementById("license-msg").textContent="Choose a file first.";return}const reader=new FileReader();reader.onload=async()=>{await post("license",{fileName:file.name,fileData:reader.result});location.reload()};reader.readAsDataURL(file)};
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

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]!);
}
