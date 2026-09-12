const http = require("http");
const { randomUUID } = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const records = new Map();

const server = http.createServer(async (req, res) => {
  try {
    setCors(req, res);
    if (req.method === "OPTIONS") return send(res, 204, "");

    const url = new URL(req.url, BASE_URL);

    if (req.method === "POST" && url.pathname === "/verification-requests") {
      const body = await readJson(req);
      const id = `vr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const smsCode = String(Math.floor(100000 + Math.random() * 900000));
      const record = {
        id,
        dot: body.dot,
        carrierName: body.carrierName,
        email: body.email,
        phone: body.phone,
        mc: body.mc || "",
        status: "pending",
        emailVerified: false,
        phoneVerified: false,
        licenseUploaded: false,
        verificationUrl: `${BASE_URL}/verify/${id}`,
        smsCode,
        licenseFileName: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      records.set(id, record);
      console.log(`CarrierVerify email link for ${record.email}: ${record.verificationUrl}`);
      console.log(`CarrierVerify SMS code for ${record.phone}: ${record.smsCode}`);
      return json(res, publicRecord(record));
    }

    const requestMatch = url.pathname.match(/^\/verification-requests\/([^/]+)$/);
    if (req.method === "GET" && requestMatch) {
      const record = getRecord(requestMatch[1]);
      return json(res, publicRecord(record));
    }

    const verifyMatch = url.pathname.match(/^\/verify\/([^/]+)$/);
    if (req.method === "GET" && verifyMatch) {
      const record = getRecord(verifyMatch[1]);
      return html(res, renderVerifyPage(record));
    }

    const actionMatch = url.pathname.match(/^\/verify\/([^/]+)\/(email|phone|license)$/);
    if (req.method === "POST" && actionMatch) {
      const [, id, action] = actionMatch;
      const record = getRecord(id);
      const body = await readJson(req);

      if (action === "email") record.emailVerified = true;
      if (action === "phone") {
        if (String(body.code || "") !== record.smsCode) {
          return json(res, { error: "Invalid SMS code." }, 400);
        }
        record.phoneVerified = true;
      }
      if (action === "license") {
        if (!body.fileName || !body.fileData) {
          return json(res, { error: "Driver license file is required." }, 400);
        }
        record.licenseUploaded = true;
        record.licenseFileName = body.fileName;
      }

      record.status = record.emailVerified && record.phoneVerified && record.licenseUploaded ? "verified" : "pending";
      record.updatedAt = new Date().toISOString();
      return json(res, publicRecord(record));
    }

    return json(res, { error: "Not found." }, 404);
  } catch (error) {
    return json(res, { error: error.message || "Server error." }, error.statusCode || 500);
  }
});

server.listen(PORT, () => {
  console.log(`CarrierVerify backend running at ${BASE_URL}`);
});

function getRecord(id) {
  const record = records.get(id);
  if (!record) {
    const error = new Error("Verification request was not found.");
    error.statusCode = 404;
    throw error;
  }
  return record;
}

function publicRecord(record) {
  return {
    id: record.id,
    dot: record.dot,
    carrierName: record.carrierName,
    email: record.email,
    phone: record.phone,
    mc: record.mc,
    status: record.status,
    emailVerified: record.emailVerified,
    phoneVerified: record.phoneVerified,
    licenseUploaded: record.licenseUploaded,
    verificationUrl: record.verificationUrl,
    licenseFileName: record.licenseFileName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function renderVerifyPage(record) {
  const status = publicRecord(record);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Carrier verification</title>
<style>
body{margin:0;background:#f6f7f9;color:#17202b;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:680px;margin:0 auto;padding:28px 16px}
section{background:#fff;border:1px solid #dfe4ea;border-radius:8px;margin-bottom:12px;padding:18px}
h1{font-size:24px;margin:0 0 6px}h2{font-size:15px;margin:0 0 10px}p{color:#657083;font-size:13px;line-height:1.45;margin:0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.box{border:1px solid #e1e6ed;border-radius:7px;padding:10px}.box span{display:block;color:#778293;font-size:11px;font-weight:800}.box b{display:block;font-size:13px;margin-top:3px;overflow-wrap:anywhere}
button{background:#17202b;border:0;border-radius:7px;color:#fff;cursor:pointer;font-weight:850;min-height:38px;padding:0 14px}button.done{background:#177245}
input{border:1px solid #cbd5e1;border-radius:7px;font:inherit;min-height:38px;padding:0 10px;width:100%}.row{display:flex;gap:8px}.checks{display:grid;gap:8px}.check{color:#657083;font-size:13px;font-weight:800}.check.done{color:#177245}.msg{color:#177245;font-size:12px;font-weight:800;margin-top:10px}
@media(max-width:560px){.grid{grid-template-columns:1fr}.row{display:grid}}
</style>
</head>
<body>
<main>
<section>
<h1>Carrier verification</h1>
<p>${esc(record.carrierName)} · USDOT ${esc(record.dot)}</p>
<div class="grid">
<div class="box"><span>Email</span><b>${esc(record.email)}</b></div>
<div class="box"><span>Phone</span><b>${esc(record.phone)}</b></div>
</div>
</section>
<section>
<h2>Status</h2>
<div class="checks">
<div class="check ${status.emailVerified ? "done" : ""}">${status.emailVerified ? "Done" : "Pending"}: email verified</div>
<div class="check ${status.phoneVerified ? "done" : ""}">${status.phoneVerified ? "Done" : "Pending"}: SMS code verified</div>
<div class="check ${status.licenseUploaded ? "done" : ""}">${status.licenseUploaded ? "Done" : "Pending"}: driver license uploaded</div>
</div>
</section>
<section>
<h2>Email</h2>
<button id="email" class="${status.emailVerified ? "done" : ""}">${status.emailVerified ? "Email verified" : "Verify email"}</button>
<div id="email-msg" class="msg"></div>
</section>
<section>
<h2>Phone</h2>
<div class="row"><input id="code" placeholder="SMS code"><button id="phone" class="${status.phoneVerified ? "done" : ""}">${status.phoneVerified ? "Phone verified" : "Verify phone"}</button></div>
<div id="phone-msg" class="msg"></div>
</section>
<section>
<h2>Driver license</h2>
<div class="row"><input id="license" type="file" accept="image/*,.pdf"><button id="upload" class="${status.licenseUploaded ? "done" : ""}">${status.licenseUploaded ? "License uploaded" : "Upload license"}</button></div>
<div id="license-msg" class="msg">${esc(status.licenseFileName || "")}</div>
</section>
</main>
<script>
const id=${JSON.stringify(record.id)};
const post=(path,body)=>fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"Request failed");return d});
document.getElementById("email").onclick=async()=>{await post("/verify/"+id+"/email");location.reload()};
document.getElementById("phone").onclick=async()=>{try{await post("/verify/"+id+"/phone",{code:document.getElementById("code").value});location.reload()}catch(e){document.getElementById("phone-msg").textContent=e.message}};
document.getElementById("upload").onclick=async()=>{const file=document.getElementById("license").files[0];if(!file){document.getElementById("license-msg").textContent="Choose a file first.";return}const reader=new FileReader();reader.onload=async()=>{await post("/verify/"+id+"/license",{fileName:file.name,fileData:reader.result});location.reload()};reader.readAsDataURL(file)};
</script>
</body>
</html>`;
}

function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) reject(new Error("Request body is too large."));
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function json(res, payload, status = 200) {
  return send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function html(res, body) {
  return send(res, 200, body, "text/html; charset=utf-8");
}

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
