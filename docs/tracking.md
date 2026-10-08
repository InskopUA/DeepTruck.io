# Driver tracking MVP

## Flow and access

Tracking belongs to an authenticated dealership account. A load links to
one of that account's completed carrier verifications and stores a snapshot
of its carrier name/USDOT. The driver phone is separate from the carrier's
office phone. Vehicle descriptions, pickup/delivery addresses, planned
pickup and a mandatory expiry are stored with each load.

`pending → accepted → active ↔ paused → completed`

A dealer can cancel an open load. A driver can decline a pending invite.
Expiry closes location access even when the driver app is offline or no
maintenance job runs. Terminal loads cannot be restarted.

Phone OTP establishes control of a phone number; it does not independently
verify the driver's legal identity. Once accepted, a load is bound to the
driver's immutable Auth user ID, so a different account with that phone
number cannot take over an existing accepted load.

Every Start creates a separate access period. A driver's coordinate is
stored once; each dealer can read only coordinates inside that load's
periods, never coordinates from another load's earlier consent. Pause,
completion and cancellation close the relevant period without affecting
the driver's other loads. History recorded during an allowed period remains
available to the load owner after completion. A late/offline upload must
still have a capture time inside an allowed period and be less than 24 hours
old. Client-provided GPS/time are not proof of physical delivery.

All tracking tables have RLS enabled with direct access revoked from anon
and authenticated roles. RPCs are service-role only. The Edge Function
validates each bearer token with `auth.getUser()` and requires a confirmed
phone for driver routes or confirmed email for dealer routes. Creation and
SMS claims are serialized; creation is idempotent by per-dealer request UUID.
SMS limits apply across dealerships to the destination phone as well.

## Backend deployment

Local source and automated tests do not change production. To deploy using
an authorized Supabase CLI login for the existing project:

```sh
npx supabase link --project-ref yqpeebgmqtqoxumzfrsq
npx supabase db push --dry-run
npx supabase db push
npx supabase functions deploy driver-tracking --project-ref yqpeebgmqtqoxumzfrsq --no-verify-jwt
```

Inspect the dry-run for only the new tracking migration. Do not mark older
migrations applied unless their actual schema has been checked. Existing
verification tables are referenced, not rewritten. The new function uses
the project's existing Supabase and Twilio secrets:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or supplied secret key map).
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
- `VERIFY_APP_URL=https://www.deeptruck.io`.
- Optional `DRIVER_IOS_STORE_URL` and `DRIVER_ANDROID_STORE_URL` once listings
  exist. Blank listings show honest pilot installation guidance.

Tracking SMS refuses test overrides/trial template mode. Do not turn those
off project-wide without reviewing their effect on the current verification
function. A missing/failed SMS configuration leaves the saved load visible
with an explicit retry state. No test run sends actual Twilio SMS.

The source now includes `/driver/` for the SMS landing page and app deep link.
`npm run build` copies it and the Tracking workspace into `public/` for
Vercel. Publish the website after the backend and driver builds are ready.
App installation does not depend on carrying a link through an app store;
the verified phone inbox finds pending invitations after sign-in.

## Phone login setup

The public Supabase Auth settings checked on October 5, 2026 have email
enabled and phone login disabled. Carrier verification's existing Twilio
calls do not create mobile login sessions.

Enable Phone under Supabase Authentication providers and configure the same
Twilio account. Prefer a separate Twilio Verify service for driver login,
using the Twilio Verify provider when available. Enter credentials directly
in the provider settings, not in source or chat. Keep carrier verification's
service independent; its existing OTP must not count as driver login.

Keep phone autoconfirm off. Configure OTP expiry, resend/rate limits and
allowed destination countries for the pilot. Use Auth's OTP send/verify
flow so the SDK receives ordinary access/refresh tokens. The app keeps its
session and does not request an SMS for every invitation.

Reference: [Supabase phone sign-in](https://supabase.com/docs/guides/auth/phone-login).

## API

Base: `/functions/v1/driver-tracking`. Private routes require a Bearer token.

| Route | Purpose |
| --- | --- |
| `GET /config` | Public store links only; no load or driver information |
| `GET /loads` | Dealer's latest 100 loads with individually scoped last points |
| `POST /loads` | Create load from verified carrier; save even if invitation fails |
| `GET /loads/:id` | Owner-only details |
| `GET /loads/:id/points` | Owner-only latest 500 allowed points |
| `POST /loads/:id/resend` | Rate-limited invitation retry |
| `POST /loads/:id/complete` | Complete and close this load |
| `POST /loads/:id/cancel` | Cancel and close this load |
| `GET /driver/loads` | Pending phone invites plus loads already bound to this user |
| `POST /driver/loads/:id/accept` | Accept; no GPS access yet |
| `POST /driver/loads/:id/decline` | Decline pending invite |
| `POST /driver/loads/:id/start` | Open a location access period |
| `POST /driver/loads/:id/pause` | Close this load's current access period |
| `POST /driver/loads/:id/complete` | Complete this load |
| `POST /driver/pause-all` | Close all this driver's access periods |
| `POST /driver/locations` | Idempotent batch of 1–100 points |

## Pickup documents

Tracking creation can include optional PDF, JPG or PNG gate passes and release
forms (up to 20 files, 10 MB each). The workspace confirms an exact pickup
address and map pin before uploading. New loads with files use
`deferInvitation: true`; the invitation is sent only after files finish uploading.
Retrying a failed upload keeps the same load and document IDs.

Files use the private `pickup-documents` bucket. A restrictive Storage policy
denies direct anon/authenticated access even if another bucket has a broad
permissive policy. Document metadata never exposes object paths or file URLs.
Driver load cards and details show the attachment names and locked/ready state.
Opening an available attachment uses the phone's document viewer/browser, which
supports PDF/image zoom; no new native dependency or binary rebuild is required.

The server releases a load's files within **1 mile (1609.344 m)** of its confirmed
pickup point. Arrival requires an active consent period for that load, a GPS fix
captured/received within 90 seconds, and accuracy no worse than 100 m. The
distance plus reported uncertainty must be inside the radius. Coordinates are
device-reported and are not independent proof of driver identity or arrival.
Load reads evaluate arrival; the existing driver/workspace refresh cadence is
15 seconds. Driver's Update location action requests a new fix immediately.

The owning dealer can Unlock documents without a GPS fix. The driver must still
accept the invitation so access binds to their Auth UUID. Arrival/manual release
persists through pauses or GPS loss while the load remains open. Changing the
pickup is denied after release. Cancellation, completion and expiry deny future
driver reads; the owner retains access to their original attachments.

The API issues HMAC-signed viewer tickets valid for two minutes, without storage
URLs. Every viewer request checks the load gate again, including after fetching
the stored file. Responses use `no-store`. Opened records the first driver file
response, not issuing a link or a dealer preview. Any already downloaded file or
screenshot cannot be recalled by the app.

| Route | Purpose |
| --- | --- |
| `POST /loads/:id/pickup` | Owner saves address + confirmed latitude/longitude |
| `POST /loads/:id/documents` | Owner uploads multipart file, kind and stable document UUID |
| `POST /loads/:id/documents/unlock` | Owner manually releases this load's documents |
| `POST /loads/:id/documents/:documentId/open` | Owner requests a short-lived preview ticket |
| `POST /driver/loads/:id/documents/:documentId/open` | Bound driver requests a ticket after release |
| `GET /documents/view?ticket=…` | Verify ticket and current load access, then serve file bytes |

Address search uses deliberate requests to Photon's public geocoder, with a
15-second timeout. The user must confirm the entrance on the map; an address
search result alone never releases documents. Manual map placement remains
available if search fails. OSM map tiles retain attribution.

## Verification and release gates

```sh
npm ci
npm test
npm run build
npm run test:tracking-ui
cd driver-app
npm ci
npm run typecheck
npm run export
```

`npm test` runs real PostgreSQL-compatible SQL with PGlite and the actual
Edge Function in Deno against a local mock of Supabase Auth/PostgREST. It
checks consent, dealer isolation, verified phone checks, multiple loads,
pauses, expiry, idempotency, SMS rate limiting and denied direct DB access.
API tests bind local ports. Browser tests use intercepted synthetic data
and blocked/replaced tile requests; no driver's actual location is used.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed Chromium browser, or
install Playwright Chromium. UI tests cover 320–2048 px and all five menus.

Before enabling a pilot, verify on a real iPhone and Android: OTP delivery,
screen locked for an extended drive, permissions denied/revoked, stationary
vehicle, airplane mode/reconnection, app swipe-away/force termination,
two simultaneous dealerships, completion of one load, all sharing stopped,
expiry with no network, and signing out. Background updates are subject to
OS/battery restrictions; the UI shows the actual last coordinate time.

Only one phone should be used for an account during the MVP pilot. A
multi-device location lease is a follow-up requirement if multiple phones
per account are allowed. Automatic acceptance for trusted dealers, push
notifications, ETA and geofenced document unlocking are outside this MVP.

Dependency audit on October 5, 2026 still reports transitive Expo/Metro/Xcode
tooling issues after a compatible `npm audit fix`: `braces`, `node-forge`
and an older `uuid`. The two high severity advisories currently list no
patched release. Do not use `npm audit fix --force` to downgrade Expo 55
to Expo 44. Review/update this tooling before store release, and do not
expose Metro or process untrusted build inputs. This is not a claim that the
application passed a clean dependency audit.
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv).

Location history currently has no automatic retention cleanup; choose and
configure a retention period before broader rollout. Store review privacy
disclosures must describe background location and load-scoped sharing.
