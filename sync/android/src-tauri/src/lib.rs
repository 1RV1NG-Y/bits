//! Android host for the sync prototype: the Rust core runs inside the app process and
//! the shared UI reaches it through one `call` command plus `sync-event` events.

use bits_sync::{Event, Node, NodeConfig};
use serde_json::Value;
use tauri::{Emitter, Manager, State};

/// Fixed so a desktop firewall rule and remembered addresses keep working across launches.
const PORT: u16 = 47100;

/// The node, or why it couldn't start (shown by the UI instead of crashing the app).
struct AppNode(Result<Node, String>);

/// One node per process. Android can recreate the activity (and rerun setup) inside a
/// live process; a second node on the same files and port must never be opened.
static NODE: std::sync::OnceLock<Node> = std::sync::OnceLock::new();

#[tauri::command]
async fn call(node: State<'_, AppNode>, method: String, params: Option<Value>) -> Result<Value, String> {
    let node = node.0.as_ref().map_err(Clone::clone)?;
    bits_sync::rpc::dispatch(node, &method, params.unwrap_or(Value::Null)).await.map_err(|e| format!("{e:#}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();
    let builder = tauri::Builder::default();
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    builder
        .setup(|app| {
            let node = match NODE.get() {
                Some(node) => Ok(node.clone()),
                None => {
                    let data_dir = app.path().app_data_dir()?.join("sync");
                    tauri::async_runtime::block_on(Node::open(NodeConfig {
                        data_dir,
                        device_name: device_name(),
                        platform: std::env::consts::OS.into(),
                        port: PORT,
                        mdns: true,
                    }))
                    .map(|node| NODE.get_or_init(|| node).clone())
                    .map_err(|e| {
                        tracing::error!("sync could not start: {e:#}");
                        format!("{e:#}")
                    })
                }
            };
            if let Ok(node) = &node {
                let handle = app.handle().clone();
                let mut events = node.subscribe();
                tauri::async_runtime::spawn(async move {
                    use tokio::sync::broadcast::error::RecvError;
                    loop {
                        match events.recv().await {
                            Ok(event) => {
                                let _ = handle.emit("sync-event", event);
                            }
                            // Missed events only mean the UI should refresh everything.
                            Err(RecvError::Lagged(_)) => {
                                let _ = handle.emit("sync-event", Event::NotesChanged);
                                let _ = handle.emit("sync-event", Event::StatusChanged);
                            }
                            Err(RecvError::Closed) => break,
                        }
                    }
                });
            }
            app.manage(AppNode(node));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![call])
        .run(tauri::generate_context!())
        .expect("error while running the bits sync prototype");
}

fn init_logging() {
    use tracing_subscriber::{EnvFilter, prelude::*};
    let filter = EnvFilter::new("bits_sync=debug,iroh=info");
    #[cfg(target_os = "android")]
    let layer = tracing_android::layer("bits-sync").ok();
    #[cfg(not(target_os = "android"))]
    let layer = Some(tracing_subscriber::fmt::layer());
    let _ = tracing_subscriber::registry().with(filter).with(layer).try_init();
}

#[cfg(target_os = "android")]
fn device_name() -> String {
    fn prop(name: &str) -> Option<String> {
        let name = std::ffi::CString::new(name).ok()?;
        let mut buf = [0 as libc::c_char; 92]; // PROP_VALUE_MAX
        // SAFETY: `buf` is PROP_VALUE_MAX bytes, the documented maximum for this call.
        let len = unsafe { libc::__system_property_get(name.as_ptr(), buf.as_mut_ptr()) };
        if len <= 0 {
            return None;
        }
        let bytes: Vec<u8> = buf[..len as usize].iter().map(|&c| c as u8).collect();
        String::from_utf8(bytes).ok().filter(|s| !s.trim().is_empty())
    }
    prop("ro.product.marketname").or_else(|| prop("ro.product.model")).unwrap_or_else(|| "Android phone".into())
}

#[cfg(not(target_os = "android"))]
fn device_name() -> String {
    format!("{} (Tauri)", std::env::consts::OS)
}
