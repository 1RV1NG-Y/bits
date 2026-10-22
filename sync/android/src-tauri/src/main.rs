// Desktop entry point, useful for quick UI checks; the prototype targets Android.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bits_sync_android_lib::run()
}
