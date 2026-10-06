# DeepTruck Driver

Expo SDK 55 / React Native application for iOS and Android. This is the
driver side of the Tracking workspace, not a browser GPS implementation.

## Implemented

- Phone OTP sign-in through Supabase Auth. Sessions are encrypted in the
  platform Keychain/Keystore, split into small chunks.
- Invitations found by verified phone number, including after installing
  the app without preserving the original SMS link.
- Consent for each load, followed by a separate Start sharing action.
- Multiple simultaneous loads for different dealers; one location task.
- Pause/resume per load, complete per load, emergency stop for all loads.
- Background location on both platforms, visible Android foreground
  notification and iOS location indicator.
- SQLite offline queue capped at 720 points and 24 hours. Stable point IDs
  prevent duplicates when retrying after a lost server response.
- Deep links: `deeptruck-driver://loads?invite=<load UUID>`.
- A custom development client and internal APK build configuration.

## Local setup

```sh
cd driver-app
npm ci
cp .env.example .env
npm run typecheck
npm run export
npm run start
```

Only publishable configuration belongs in `.env`. Twilio secrets and the
Supabase service role key must stay on the server. Change these three
public values when using a staging Supabase project.

Background GPS needs a native development/internal build. Expo Go does not
support this workflow. A Hermes bundle export checks JavaScript packaging;
it is not a signed IPA/APK and does not verify native GPS on a real phone.

## Phone installation

### Own iPhone without paid Apple membership

A free Apple Account can sign a local development app through Xcode's
Personal Team. Apple requires rebuilding/reinstalling after the seven-day
provisioning period. This is suitable for testing on your own phone; it is
different from TestFlight or cloud device distribution.

1. Install full Xcode from the Mac App Store, open it, accept the license
   and install iOS platform support. Command Line Tools alone are insufficient.
2. In Xcode Settings → Accounts, sign in with your Apple Account.
3. Connect the iPhone by USB and trust the Mac. Pair it in Xcode's Devices
   and Simulators window and enable Developer Mode if prompted.
4. On the Mac, open this project and run:

   ```sh
   cd /Users/milla/Downloads/CarrierVerify/driver-app
   npm run ios:device
   ```

5. Select the connected phone. If signing is not configured, open the
   generated workspace in Xcode, select the DeepTruck Driver app target,
   enable Automatically manage signing and choose the Personal Team under
   Signing & Capabilities. A unique bundle identifier may be needed.
6. Keep Metro running and the Mac/phone on the same network during this
   development session. On subsequent sessions use `npm run start`.

The backend and phone OTP provider must also be configured for real sign-in
and loads. Installing the app alone does not deploy the tracking backend.
Expo Go cannot test the background location workflow.

References: [Apple Personal Team](https://developer.apple.com/help/account/basics/about-your-developer-account),
[Expo local device builds](https://docs.expo.dev/guides/local-app-development/).

### Cloud builds and distribution

The app identifiers currently use `io.deeptruck.driver` for both platforms.
Confirm ownership before the first store build; changing them later creates
a different app. Use an authenticated Expo/EAS account for cloud builds:

```sh
npx eas-cli login
npx eas-cli init
npx eas-cli build --profile development --platform android
npx eas-cli build --profile development --platform ios
```

The development profile needs Metro (`npm run start`). For a standalone
pilot build with embedded JavaScript, use the `preview` profile. Android
preview outputs an installable APK without a Play Console account. iOS
device distribution needs Apple signing and device provisioning; production
builds can be distributed through TestFlight with Apple Developer access.
`npm run ios` requires full Xcode; `npm run android` requires the Android SDK.

Production builds use `--profile production`. Store submission requires
the corresponding Apple/Google developer accounts and review materials.
No EAS project or signing credentials are included or automatically created.

See [the tracking deployment guide](../docs/tracking.md) for the backend,
phone authentication, invitation SMS and pilot acceptance steps.

Official references: [Expo background location](https://docs.expo.dev/versions/v55.0.0/sdk/location/),
[EAS builds](https://docs.expo.dev/build/setup/),
[Supabase phone login](https://supabase.com/docs/guides/auth/phone-login).
