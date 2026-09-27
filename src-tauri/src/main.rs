// Prevents an extra console window on Windows in release. On macOS and Linux
// the console does not exist, so this is compiled out.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    watchora_lib::run();
}
