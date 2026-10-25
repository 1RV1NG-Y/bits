// Starts the bits-sync-helper process and speaks its JSON-lines protocol.
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const readline = require("node:readline");

function helperPath() {
  if (process.env.BITS_SYNC_HELPER) return process.env.BITS_SYNC_HELPER;
  const exe = process.platform === "win32" ? "bits-sync-helper.exe" : "bits-sync-helper";
  // Packaged apps ship the helper in resources/; development uses the cargo build.
  if (process.resourcesPath && !process.defaultApp && require("node:fs").existsSync(path.join(process.resourcesPath, exe)))
    return path.join(process.resourcesPath, exe);
  return path.join(__dirname, "../sync/target/release", exe);
}

function startHelper({ dataDir, name, port, mdns = true, log = process.stderr } = {}) {
  // --parent-pid lets the helper exit if this process dies without closing its stdin.
  const args = ["--data-dir", dataDir, "--parent-pid", String(process.pid)];
  if (name) args.push("--name", name);
  if (port !== undefined) args.push("--port", String(port));
  if (!mdns) args.push("--no-mdns");
  const child = spawn(helperPath(), args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const events = new EventEmitter();
  const pending = new Map();
  let nextId = 1;
  let exited = false;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

  child.stderr.on("data", (chunk) => log && log.write(chunk));
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.event === "ready") readyResolve(msg.status);
    else if (msg.event) events.emit(msg.event);
    else if (pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if ("error" in msg) reject(new Error(msg.error)); else resolve(msg.result);
    }
  });
  child.on("error", (error) => readyReject(error));
  child.on("exit", (code, signal) => {
    exited = true;
    const error = new Error(`Sync helper stopped (${signal || code}).`);
    readyReject(error);
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    events.emit("exit", code, signal);
  });

  function request(method, params) {
    if (exited) return Promise.reject(new Error("Sync helper is not running."));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  // Closing stdin asks the helper to shut down cleanly; force it after a grace period.
  function stop(graceMs = 3000) {
    if (exited) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), graceMs);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  }

  return { ready, request, events, stop, process: child };
}

module.exports = { startHelper, helperPath };
