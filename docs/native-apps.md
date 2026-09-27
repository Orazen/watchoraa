# Native apps (desktop + mobile)

Watchora ships as one codebase in three shapes. The website, the installed
PWA, and the native desktop/mobile app all load the **same** Vite bundle from
`dist/`. There is no second implementation, so a fix to the app is a fix to the
website and the two cannot drift.

| Target | What it is | Status |
| --- | --- | --- |
| Website | Vite SPA served by the API's own origin | Live |
| Installed PWA | The same bundle, with `display_override` and three shortcuts | Live |
| Desktop | Tauri v2 shell wrapping the same bundle | Builds in CI |
| Android | The same Tauri crate, built as an APK | Debug APK in CI |
| iOS | The same Tauri crate, built as an IPA | Needs a signing identity |

## Why Tauri and not Capacitor

Both wrap the same web bundle. Tauri was chosen because:

- **One codebase for desktop and mobile.** The Rust crate in `src-tauri/` backs
  the macOS/Windows/Linux binary *and* the Android and iOS apps. Capacitor
  needs a separate native project per platform.
- **The shell is nearly empty.** Everything a blind user touches — the mascot,
  the cadence, the guidance — stays in TypeScript where the unit tests and the
  production E2E already reach it. A native layer in that path would mean two
  implementations of the same behaviour and only one of them tested.
- **Small binaries.** Tauri uses the OS webview instead of shipping Chromium
  per app.

## The one thing that must be set: `VITE_API_BASE_URL`

The website resolves `/api/...` against its own origin, which is correct. The
native app cannot, and this is the single most important thing to understand
about the build:

> Inside a Tauri webview the page origin is an **asset origin** —
> `tauri://localhost` on macOS and Linux, `https://tauri.localhost` on Windows
> and Android. It is *never* the API's origin. A relative `/api/auth/login`
> resolves against the bundled app files and fails.

So every native build must name the API host explicitly:

```bash
VITE_API_BASE_URL=https://watchora.ramagiritharun.in npm run native:build
```

`scripts/build-native.mjs` runs first and refuses to build if the value is
missing, is a path rather than a URL, uses a scheme other than http/https,
points at loopback, or is plain http to a remote host. Each of those produces an
app that installs, opens, signs the user in, and then fails every request —
which is a miserable bug to diagnose from a user's report and a five-line check
to prevent at build time.

The value is put in the environment for **both** the Vite bundle and the Rust
compile (`option_env!` in `src-tauri/src/lib.rs`), so the shell and the web
layer can never disagree about which server they are talking to.

The same rules live in `src/runtimeEnv.ts` (`apiBaseProblem`) and are covered by
`src/__tests__/runtimeEnv.test.ts`. CI runs the preflight against five bad
values and fails if any is accepted.

## Build commands

```bash
npm run native:check          # validate the API base, build nothing
npm run native:dev            # dev build with hot reload in a native window
npm run native:build          # desktop bundle (.dmg / .msi / .AppImage)
npm run native:android init   # first time only: generate the Android project
npm run native:android        # build the APK
npm run native:ios init       # first time only: generate the iOS project
npm run native:ios            # build the IPA
```

Android and iOS projects are generated from `tauri.conf.json` and `Cargo.toml`
and are **not committed** — a second source of truth that drifts after the
first config change is worse than a two-command setup.

## Permissions

Camera, microphone and speech all go through standard `getUserMedia` in the web
layer. That is deliberate: the permission onboarding UI in
`src/permissions/PermissionOnboarding.tsx` already explains each permission in
plain words before the OS prompt appears, and a native prompt behind that would
be a second, unlabelled ask — exactly the kind of thing that makes blind users
deny permissions.

The one capability with a native plugin is **geolocation**
(`tauri-plugin-geolocation`), because the navigation coach needs position
updates and a backgrounded webview is unreliable for that. The allowlist is in
`src-tauri/capabilities/`: `core:default`, `set-title`, geolocation, and on
desktop only a devtools toggle. Nothing else is exposed to the web layer.

### Haptics, and an honest limitation

The mascot's vibration signature is a first-class channel, so it is worth being
precise about what the shell can actually do:

- **Android** — `navigator.vibrate` works in the webview. Tauri declares
  `android.permission.VIBRATE` in the generated manifest.
- **Desktop** — there is no vibration hardware. The haptic signature is a no-op
  and the spoken label carries the message.
- **iOS** — the WebKit webview has **no vibration API at all**, and Apple's Core
  Haptics is not reachable from a `WKWebView`. The mascot's vibration is silent
  on iOS, permanently.

That is a platform limit, not a missing permission, and no amount of
configuration changes it. The consequence to remember: **on iOS the mascot can
never be the only channel for a hazard.** It already isn't — `alert` speaks at
priority 1 and the canvas orb is decorative — but any future haptic-only feature
would strand iOS users. The E2E suite asserts the spoken channel carries the
hazard for this reason.

## Signing and store distribution

CI builds and verifies an **unsigned debug APK**. That is deliberate:

- Store builds need a keystore (Android) or a distribution certificate and
  provisioning profile (iOS). Those must not be in a pull request, and must not
  be in this repository.
- An unsigned artifact cannot be installed by a real user, so verifying one
  proves the build works and little else.

To produce distributable builds, set the signing material in the CI secrets and
add the release steps:

| Target | Secrets needed | Produces |
| --- | --- | --- |
| Android release | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Signed AAB for Play |
| iOS | `APPLE_CERTIFICATE_BASE64`, `APPLE_PROVISIONING_PROFILE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_TEAM_ID` | IPA for TestFlight |
| macOS | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Signed, notarised `.dmg` |

Until that is in place, treat the desktop app as internal-distribution only.

## Verification status

| Check | Where it runs | Result |
| --- | --- | --- |
| `cargo check --all-targets` on 3 OSes | `.github/workflows/native.yml` | Compiles |
| `cargo clippy -D warnings` | same | Clean |
| **Launch smoke test** (xvfb, 15s) | same | Launches, no panic |
| macOS `Info.plist` usage strings | same | Camera + mic present |
| Android debug APK + `aapt` label/permission dump | same | Built, labelled `Watchora` |
| The 44-check production E2E | `scripts/watch-e2e.mjs` | The web layer, which the app loads unchanged |

The web E2E is the meaningful test of the app's behaviour, because the app *is*
the web layer. What CI adds is proof that the shell compiles, that it survives
startup, and that the permissions and label are right — the parts a web test
cannot see.

## Four bugs that only a real build could find

Every one of these passed `tsc`, passed the unit tests, and would have shipped
from a codebase that only ever ran `npm run build`. They are recorded here
because the pattern matters more than the individual fixes.

1. **`protocol-asset` feature missing.** `assetProtocol` is enabled in
   `tauri.conf.json` so the webview can load the local `.wasm` and `.onnx`
   models, but the `tauri` crate needs the matching `protocol-asset` feature.
   `cargo check` fails with *"does not match the allowlist defined under
   tauri.conf.json"*. The config and `Cargo.toml` must change together.

2. **Two invented geolocation permissions.** `geolocation:allow-request-location`
   and `geolocation:allow-is-location-authorized` do not exist. The correct
   names are `allow-get-current-position`, `allow-watch-position` and
   `allow-check-permissions`. The compiler prints the full list of valid
   permissions when it rejects one — read it rather than guessing again.

3. **`category: "Accessibility"` is not a category.** There are 40 valid values
   and that is not one of them; `Medical` is the conventional store category
   for assistive technology. The failure is at *bundle* time, long after a
   successful compile.

4. **A plugin that only panics at launch.** `"plugins": { "geolocation": {} }`
   compiles cleanly, passes clippy, produces a `.app` — and then dies on the
   first line of `run()` with `PluginInitialization: invalid type: map,
   expected unit`. The geolocation plugin takes no configuration, so the key
   must be **absent**, not empty. This is the reason for the xvfb launch smoke
   test: it is the only check in the pipeline that can see this class of bug.

A fifth one is macOS-specific and just as severe: a bundle with no
`NSCameraUsageDescription` / `NSMicrophoneUsageDescription` is **terminated by
the OS** the first time it touches the camera or microphone — no prompt, no
denial, the process just disappears. `src-tauri/Info.plist` supplies them, and
CI asserts they are present.

## Troubleshooting


**Every request fails, sign-in does nothing.** `VITE_API_BASE_URL` was unset or
mistyped. Run `npm run native:check`.

**Blank white window.** A CSP block. The strict CSP in `tauri.conf.json` is
deliberate; widen the specific directive rather than removing the policy.

**The app dies the moment it starts.** Read the log. A `PluginInitialization`
error means a plugin was given a config block it does not accept — geolocation
takes none. The launch smoke test in CI exists to catch exactly this.

**macOS kills the app on first camera or mic use, with no prompt.** A missing
`NSCameraUsageDescription` or `NSMicrophoneUsageDescription` in
`src-tauri/Info.plist`. The OS terminates the process; there is no error to
read.

**`cargo` not found.** Install Rust from <https://rustup.rs>. It is not
installed by default on macOS.

**Android build fails at `webkit2gtk-sys` (Linux only).** Install
`libwebkit2gtk-4.1-dev`; the error does not mention a package to install.
