//! Desktop sync helper: runs a sync node and serves it to Electron over stdio.
//!
//! Protocol: one JSON object per line.
//! - Request (stdin):  `{"id": 1, "method": "createNote", "params": {...}}`
//! - Response (stdout): `{"id": 1, "result": ...}` or `{"id": 1, "error": "message"}`
//! - Event (stdout):    `{"event": "notesChanged" | "statusChanged"}`
//! - `{"event": "ready", "status": {...}}` is written once the node is running.
//!
//! The helper exits after closing stdin; logs go to stderr.

use std::path::PathBuf;

use anyhow::{Context, Result};
use bits_sync::{Node, NodeConfig};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::mpsc,
};

const DEFAULT_PORT: u16 = 47100;

#[derive(Deserialize)]
struct Request {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

fn usage() -> ! {
    eprintln!("usage: bits-sync-helper --data-dir DIR [--name NAME] [--port PORT] [--no-mdns] [--parent-pid PID]");
    std::process::exit(2);
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_env("BITS_SYNC_LOG").unwrap_or_else(|_| "bits_sync=info".into()))
        .init();

    let mut data_dir = None;
    let mut name = None;
    let mut port = DEFAULT_PORT;
    let mut mdns = true;
    let mut parent_pid = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--data-dir" => data_dir = Some(PathBuf::from(args.next().unwrap_or_else(|| usage()))),
            "--name" => name = args.next(),
            "--port" => port = args.next().and_then(|p| p.parse().ok()).unwrap_or_else(|| usage()),
            "--no-mdns" => mdns = false,
            "--parent-pid" => parent_pid = Some(args.next().and_then(|p| p.parse::<u32>().ok()).unwrap_or_else(|| usage())),
            _ => usage(),
        }
    }
    let data_dir = data_dir.unwrap_or_else(|| usage());
    let node = Node::open(NodeConfig {
        data_dir,
        device_name: name.unwrap_or_else(default_name),
        platform: std::env::consts::OS.into(),
        port,
        mdns,
    })
    .await
    .context("starting sync")?;

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();
    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(msg) = out_rx.recv().await {
            let mut line = serde_json::to_vec(&msg).expect("json");
            line.push(b'\n');
            if stdout.write_all(&line).await.is_err() || stdout.flush().await.is_err() {
                break;
            }
        }
    });

    let _ = out_tx.send(json!({ "event": "ready", "status": node.status() }));
    let mut events = node.subscribe();
    let event_tx = out_tx.clone();
    tokio::spawn(async move {
        use tokio::sync::broadcast::error::RecvError;
        loop {
            match events.recv().await {
                Ok(event) => {
                    let _ = event_tx.send(json!({ "event": event }));
                }
                // Missed events only mean the UI should refresh everything.
                Err(RecvError::Lagged(_)) => {
                    let _ = event_tx.send(json!({ "event": "notesChanged" }));
                    let _ = event_tx.send(json!({ "event": "statusChanged" }));
                }
                Err(RecvError::Closed) => break,
            }
        }
    });

    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let parent_gone = parent_exited(parent_pid);
    tokio::pin!(parent_gone);
    loop {
        let line = tokio::select! {
            line = lines.next_line() => match line? {
                Some(line) => line,
                None => break,
            },
            _ = &mut parent_gone => {
                tracing::info!("parent process exited; shutting down");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let request: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let _ = out_tx.send(json!({ "id": null, "error": format!("malformed request: {e}") }));
                continue;
            }
        };
        // Requests run concurrently so a slow pairing attempt doesn't block edits.
        let node = node.clone();
        let out_tx = out_tx.clone();
        tokio::spawn(async move {
            let reply = match bits_sync::rpc::dispatch(&node, &request.method, request.params).await {
                Ok(result) => json!({ "id": request.id, "result": result }),
                Err(e) => json!({ "id": request.id, "error": format!("{e:#}") }),
            };
            let _ = out_tx.send(reply);
        });
    }

    let started = std::time::Instant::now();
    node.shutdown().await;
    tracing::info!("shut down in {} ms", started.elapsed().as_millis());
    // Give queued replies a moment to flush, then exit without waiting on the event relay
    // (it lives as long as the node) or on blocking watcher threads.
    drop(out_tx);
    let _ = tokio::time::timeout(std::time::Duration::from_secs(1), writer).await;
    std::process::exit(0);
}

/// Resolves when the launching process has exited. Closing stdin is the normal way to stop
/// the helper, but if Electron's main process dies abruptly its surviving child processes
/// can keep the pipe open, which would leave an orphaned helper holding the library lock.
async fn parent_exited(parent_pid: Option<u32>) {
    #[cfg(unix)]
    {
        let _ = parent_pid;
        // An orphaned process is re-parented, so its parent id changes.
        let original = std::os::unix::process::parent_id();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            if std::os::unix::process::parent_id() != original {
                return;
            }
        }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::Threading::{INFINITE, OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
        };
        let Some(pid) = parent_pid else { return std::future::pending().await };
        // SAFETY: plain Win32 calls on a handle this function owns and closes.
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        if handle.is_null() {
            return; // Already gone.
        }
        let handle = handle as usize;
        let _ = tokio::task::spawn_blocking(move || unsafe {
            WaitForSingleObject(handle as _, INFINITE);
            CloseHandle(handle as _);
        })
        .await;
    }
}

fn default_name() -> String {
    let host = std::fs::read_to_string("/etc/hostname")
        .ok()
        .map(|h| h.trim().to_owned())
        .filter(|h| !h.is_empty())
        .or_else(|| std::env::var("COMPUTERNAME").ok());
    let os = match std::env::consts::OS {
        "linux" => "Linux",
        "windows" => "Windows",
        "macos" => "Mac",
        other => other,
    };
    match host {
        Some(h) => format!("{h} ({os})"),
        None => os.to_owned(),
    }
}
