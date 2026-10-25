// Electron host for the sync prototype. It launches the bundled Rust helper, which owns
// storage and networking, and relays calls from the shared UI. It uses its own data
// directory and never touches the main bits library.
//
//   electron sync/desktop/main.cjs [--profile=NAME] [--dev]
//
// --profile runs an independent device on the same machine (own data and port) for testing.
const { app, BrowserWindow, ipcMain, clipboard, nativeTheme, Menu, dialog } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { startHelper } = require("./helper-client.cjs");

const profile = (process.argv.find((a) => a.startsWith("--profile=")) || "").slice(10).replace(/[^\w-]/g, "");
const isDev = process.argv.includes("--dev");
app.setName(profile ? `bits-sync-prototype-${profile}` : "bits-sync-prototype");
if (process.env.BITS_SYNC_DATA_DIR) app.setPath("userData", path.resolve(process.env.BITS_SYNC_DATA_DIR));
const port = Number(process.env.BITS_SYNC_PORT) || (profile ? 47100 + 1 + ([...profile].reduce((h, c) => h + c.charCodeAt(0), 0) % 50) : 47100);

if (!app.requestSingleInstanceLock()) app.quit();
let win;
let helper;
let quitting = false;

app.whenReady().then(async () => {
  nativeTheme.themeSource = "dark";
  Menu.setApplicationMenu(null);
  const uiFile = path.join(__dirname, "../ui/dist/index.html");
  const trusted = isDev ? "http://127.0.0.1:5175/" : pathToFileURL(uiFile).href;

  helper = startHelper({ dataDir: path.join(app.getPath("userData"), "sync"), name: process.env.BITS_SYNC_NAME, port });
  // The helper keeps emitting while it shuts down (sessions closing), after the window is
  // gone; only forward events to a live window.
  const send = (name) => { if (win && !win.isDestroyed()) win.webContents.send("sync:event", name); };
  helper.events.on("exit", () => { if (!quitting) send("helperStopped"); });
  for (const name of ["notesChanged", "statusChanged"]) helper.events.on(name, () => send(name));
  try {
    await helper.ready;
  } catch (error) {
    dialog.showErrorBox("Sync couldn’t start", `${error.message}\n\nBuild the helper with: npm run sync:helper`);
    app.exit(1);
    return;
  }

  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
    if (!win || event.sender !== win.webContents || event.senderFrame?.url !== trusted) throw new Error("Untrusted request");
    return fn(...args);
  });
  handle("sync:call", (method, params) => helper.request(method, params));
  handle("sync:copy", (text) => clipboard.writeText(String(text)));

  win = new BrowserWindow({
    width: 900, height: 820, minWidth: 380, minHeight: 520,
    title: profile ? `bits sync prototype (${profile})` : "bits sync prototype",
    backgroundColor: "#212423",
    icon: path.join(__dirname, "../../build/icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.on("closed", () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  if (isDev) win.loadURL(trusted); else win.loadFile(uiFile);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting || !helper) return;
  // Let the helper finish in-flight writes and close connections before exiting.
  event.preventDefault();
  quitting = true;
  helper.stop().finally(() => app.quit());
});
