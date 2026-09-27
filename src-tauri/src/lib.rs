//! Watchora native shell.
//!
//! One crate, three targets: the macOS/Windows/Linux desktop app, the Android
//! app, and the iOS app. The web layer is the same Vite bundle the website
//! serves, so a fix to the app is a fix to the website and cannot drift.
//!
//! The shell deliberately does almost nothing. Everything a blind user actually
//! touches — the cadence, the mascot, the guidance — lives in TypeScript where
//! the tests and the production E2E already reach it. A native layer in the
//! path would mean two implementations of the same behaviour, one of which
//! nothing tests.

use tauri::Manager;

/// Where the API lives, baked in at build time.
///
/// The webview's own origin is an asset origin (`tauri://localhost`,
/// `https://tauri.localhost`), never the API's, so a relative `/api/...` URL
/// would resolve against the bundled files and fail. The client reads this
/// through `resolveApiBase` in `src/runtimeEnv.ts`; `scripts/build-native.mjs`
/// validates the value before a build starts so a typo fails the build rather
/// than shipping an app whose every request 404s.
const API_BASE_ENV: &str = "VITE_API_BASE_URL";

/// Read the API base that the build injected, if any.
///
/// `option_env!` is a compile-time lookup, which is what we want: it puts no
/// secret in the binary and it cannot be changed at runtime by editing a file
/// next to the app.
fn api_base() -> Option<&'static str> {
    option_env!("VITE_API_BASE_URL").filter(|v| !v.trim().is_empty())
}

/// Hand the client its API base.
///
/// A command rather than a build-time constant baked into the JS, so there is
/// exactly one definition of the value in the Rust side and the TypeScript side
/// resolves the same string the shell reports.
#[tauri::command]
fn api_base_url() -> Option<String> {
    api_base().map(str::to_string)
}

/// Whether this build is talking to a hosted API or a dev machine.
///
/// The client uses it only for diagnostics; the app itself never branches on
/// it. Exposed so the About screen can tell a tester which server they are on,
/// which is the kind of thing that otherwise takes an hour to work out from a
/// bug report.
#[tauri::command]
fn runtime_info() -> serde_json::Value {
    serde_json::json!({
        "apiBase": api_base(),
        "apiBaseEnv": API_BASE_ENV,
        "version": env!("CARGO_PKG_VERSION"),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Geolocation is the one capability worth a native plugin here: the
        // navigation coach needs position updates, and asking a backgrounded
        // webview for them is unreliable. Camera, microphone and speech all go
        // through standard getUserMedia in the web layer, which is what the
        // permission onboarding UI already explains to the user — a native
        // prompt behind that would be a second, unlabelled ask.
        .plugin(tauri_plugin_geolocation::init())
        .invoke_handler(tauri::generate_handler![api_base_url, runtime_info])
        .setup(|app| {
            // A blind user is unlikely to find a menu bar or a title bar on
            // their own, so the window must not be the only way out. On mobile
            // this is irrelevant; on desktop, the web layer already renders its
            // own navigation, so the frame stays but stays thin.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Watchora");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Watchora app");
}

// Haptics are a first-class channel for this product, so it is worth being
// precise about what the shell can and cannot do:
//
//  * Android — `navigator.vibrate` works in the webview. Tauri declares
//    android.permission.VIBRATE in the generated manifest.
//  * iOS — the WebKit webview has no vibration API at all, and Apple's own
//    Core Haptics is unavailable to a WKWebView. The mascot's vibration
//    signature is therefore silent on iOS and the spoken label carries the
//    whole message. This is a platform limit, not a missing permission, and no
//    amount of configuration changes it.
//
// A consequence worth remembering: on iOS the mascot must never be the ONLY
// channel for a hazard. It already is not — `alert` speaks at priority 1 and
// the canvas orb is decorative — but any future haptic-only feature would
// strand iOS users.
//
// There is deliberately no `main` here. The desktop entry point is
// `src/main.rs`, which calls `run()`; defining a second one in the lib is dead
// code that `clippy -D warnings` (and therefore CI) rejects.
