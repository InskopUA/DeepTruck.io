# DeepTruck Verify

Chrome extension MVP for verifying a carrier before a shipper assigns a load.

## What it does

- Runs on Central Dispatch carrier pages.
- Finds the USDOT number from the page text.
- Pulls carrier profile data from MOTUS/FMCSA public endpoints.
- Shows FMCSA-listed email, phone, authority status, fleet, BOC-3, and insurance summary.
- Starts a verification request for:
  - email verification,
  - SMS code verification,
  - driver license upload.

The extension includes demo mode so the UI can be tested immediately. Real email, SMS, and license upload require a backend because provider secrets must not be stored in a Chrome extension.

## Install locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder: `/Users/milla/Downloads/CarrierVerify`.
5. Open a Central Dispatch carrier profile.

To update an existing installation, open `chrome://extensions`, find **DeepTruck Verify** (formerly CarrierVerify), and click Reload. Refresh the Central Dispatch tab to load the updated panel.

The popup and extension account page use the same DeepTruck account. Once signed in, the popup shows your account and links to Central Dispatch and your workspace. The carrier panel shows five checks: email, SMS, driver license, W-9, and insurance certificate. The shield icons are packaged locally with the extension.

## Local backend demo

Run:

```sh
node backend/server.js
```

Then open extension options and set:

```text
http://localhost:8787
```

When the shipper clicks `Send verification`, the backend prints the verification link and SMS code in the terminal. Open the link, verify email, enter the SMS code, upload a license file, then click `Check status` in Central Dispatch.

## Production recommendation

Use Supabase as the backend, Resend for transactional email, and Twilio Programmable Messaging for SMS.

Supabase handles:

- Edge Function API for the Chrome extension and carrier verification page.
- Postgres status table.
- Private Storage bucket for driver license uploads.
- Secrets for provider API keys.

Resend handles the verification email. Twilio sends the SMS OTP. Telnyx is a good cheaper SMS alternative later, but Twilio is the fastest production path for a first version.

## Supabase deploy

Create the database table and private storage bucket:

```sh
supabase db push
```

Set function secrets:

```sh
supabase secrets set \
  RESEND_API_KEY=re_xxx \
  EMAIL_FROM="CarrierVerify <verify@yourdomain.com>" \
  TWILIO_ACCOUNT_SID=ACxxx \
  TWILIO_AUTH_TOKEN=xxx \
  TWILIO_FROM_NUMBER=+15551234567 \
  TWILIO_VERIFY_SERVICE_SID=VAxxx \
  DEV_SMS_OVERRIDE_PHONE=+15551234567 \
  DEV_EMAIL_OVERRIDE=you@example.com \
  TWILIO_TRIAL_TEMPLATE_MODE=true \
  OTP_HASH_SECRET="$(openssl rand -hex 32)" \
  PUBLIC_BASE_URL="https://PROJECT_REF.supabase.co/functions/v1/carrier-verify"
  VERIFY_APP_URL="http://localhost:5173"
```

For local verification-page testing:

```sh
python3 -m http.server 5173 -d dist
```

Deploy the function:

```sh
supabase functions deploy carrier-verify --no-verify-jwt
```

Then set the extension API base URL to:

```text
https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/carrier-verify
```

## Vercel deploy

Vercel should host only the public web UI:

- `/` public landing page
- `/login` sign-in page
- `/signup` registration page
- `/admin` authenticated shipper workspace
- `/verify.html?id=...` carrier verification page
- `/verify?id=...` same verification page through a clean URL rewrite

Use these Vercel project settings:

```text
Framework preset: Other
Build command: npm run build
Output directory: public
Install command: npm install
```

The build copies `verify-site/` into `public/` and `admin-site/` into `public/admin/`. The Chrome extension is not deployed to Vercel; it stays as the unpacked extension package using `manifest.json` and `src/`.

After the Vercel domain is live, update the Supabase function secret so verification links in emails/SMS open the Vercel page instead of localhost:

```sh
supabase secrets set \
  VERIFY_APP_URL="https://www.deeptruck.io" \
  --project-ref yqpeebgmqtqoxumzfrsq
```

Keep `PUBLIC_BASE_URL` pointed at the Supabase Edge Function:

```text
https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/carrier-verify
```

For shipper account registration, Supabase Auth must allow the admin redirect URL:

```text
https://www.deeptruck.io/admin/
```

Add it in Supabase Dashboard under Authentication URL settings before using email confirmation in production.

## Backend contract

Configure the backend URL in the extension options page.

### `POST /verification-requests`

Request:

```json
{
  "dot": "4132866",
  "carrierName": "Carrier name",
  "email": "carrier@example.com",
  "phone": "5551234567",
  "mc": "MC1582943",
  "createdAt": "2026-09-11T00:00:00.000Z"
}
```

Response:

```json
{
  "id": "vr_123",
  "dot": "4132866",
  "carrierName": "Carrier name",
  "email": "carrier@example.com",
  "phone": "5551234567",
  "status": "pending",
  "emailVerified": false,
  "phoneVerified": false,
  "licenseUploaded": false,
  "verificationUrl": "https://yourdomain.com/verify/vr_123"
}
```

### `GET /verification-requests/:id`

Return the same shape with updated booleans. The shipper screen switches to `Verified` when all three are true.
