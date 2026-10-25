const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  nativeTheme,
  Menu,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { createOcrService } = require("./ocr.cjs");
const { startHelper } = require("./sync-helper.cjs");
const { migrateLegacyLibrary, markMigrated } = require("./migrate.cjs");

app.setName("bits");
if (process.env.BITS_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.BITS_DATA_DIR));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let win;
let helper;
let migrationError = null;
let ocr;
let quitting = false;
const isDev = process.argv.includes("--dev");
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

if (gotLock)
  app.whenReady().then(async () => {
    const { validateLibrary, webUrl } = await import("../src/model.mjs");
    // The library lives in the sync helper (sync/), which saves every change durably
    // before confirming it and syncs with paired devices.
    helper = startHelper({ dataDir: path.join(app.getPath("userData"), "sync"), port: Number(process.env.BITS_SYNC_PORT) || 47100 });
    const send = (name) => { if (win && !win.isDestroyed()) win.webContents.send("sync:event", name); };
    helper.events.on("exit", () => { if (!quitting) send("helperStopped"); });
    for (const name of ["notesChanged", "statusChanged"]) helper.events.on(name, () => send(name));
    try {
      await helper.ready;
    } catch (error) {
      dialog.showErrorBox("bits couldn’t open your library", error.message);
      app.exit(1);
      return;
    }
    try {
      await migrateLegacyLibrary({ userData: app.getPath("userData"), helper, validate: validateLibrary });
    } catch (error) {
      migrationError = error.message;
    }
    const dataHome = process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : path.join(app.getPath("home"), ".local/share");
    const resourceRoot = app.isPackaged ? path.join(process.resourcesPath, "ocr-support") : path.join(__dirname, "..");
    ocr = createOcrService({
      home: process.env.BITS_OCR_HOME || path.join(dataHome, "bits/ocr"),
      worker: path.join(resourceRoot, "ocr/worker.py"),
      setupScript: path.join(resourceRoot, "scripts/setup-ocr.mjs"),
    });
    nativeTheme.themeSource = "dark";
    Menu.setApplicationMenu(null);
    const appFile = path.join(__dirname, "../dist/index.html");
    const trusted = isDev
      ? "http://127.0.0.1:5174/"
      : pathToFileURL(appFile).href;
    const handle = (name, handler) =>
      ipcMain.handle(name, (event, ...args) => {
        if (
          !win ||
          event.sender !== win.webContents ||
          event.senderFrame !== win.webContents.mainFrame ||
          event.senderFrame.url !== trusted
        )
          throw new Error("Untrusted request");
        return handler(...args);
      });
    handle("ocr:status", () => ocr.status());
    handle("ocr:setup", () => ocr.setup());
    handle("ocr:cancel", () => ocr.cancel());
    handle("ocr:import", async () => {
      const selected = await dialog.showOpenDialog(win, {
        title: "Import text from an image", properties: ["openFile"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"] }],
      });
      if (selected.canceled || !selected.filePaths.length) return null;
      return ocr.extract(selected.filePaths[0]);
    });
    handle("sync:call", (method, params) => helper.request(method, params));
    handle("library:migrationError", () => migrationError);
    // After restoring a backup in place of an unreadable old library.
    handle("library:migrationResolved", async () => {
      await markMigrated(app.getPath("userData"), { restoredFromBackup: true });
      migrationError = null;
    });
    handle("link:open", (value) => {
      const url = webUrl(value);
      if (!url) throw new Error("Only HTTP and HTTPS links can be opened.");
      return shell.openExternal(url);
    });
    handle("window:minimize", () => win.minimize());
    handle("window:maximize", () =>
      win.isMaximized() ? win.unmaximize() : win.maximize(),
    );
    handle("window:close", () => win.close());
    handle("library:export", async (data) => {
      const valid = validateLibrary(data);
      const result = await dialog.showSaveDialog(win, {
        title: "Export your library",
        defaultPath: `bits-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "bits library", extensions: ["json"] }],
      });
      if (result.canceled) return false;
      await fs.writeFile(result.filePath, JSON.stringify(valid, null, 2), {
        mode: 0o600,
      });
      return true;
    });
    handle("library:import", async () => {
      const result = await dialog.showOpenDialog(win, {
        title: "Import a bits library",
        properties: ["openFile"],
        filters: [{ name: "bits library", extensions: ["json"] }],
      });
      if (result.canceled) return null;
      if ((await fs.stat(result.filePaths[0])).size > 25 * 1024 * 1024)
        throw new Error("Backup files must be smaller than 25 MB.");
      return validateLibrary(
        JSON.parse(await fs.readFile(result.filePaths[0], "utf8")),
      );
    });
    function createWindow() {
      win = new BrowserWindow({
        width: 1100,
        height: 820,
        minWidth: 520,
        minHeight: 560,
        frame: false,
        titleBarStyle:
          process.platform === "darwin" ? "hiddenInset" : undefined,
        backgroundColor: "#212423",
        show: false,
        autoHideMenuBar: true,
        icon: path.join(__dirname, "../build/icon.png"),
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.session.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false),
      );
      win.webContents.session.setPermissionCheckHandler(() => false);
      win.once("ready-to-show", () => win.show());
      win.on("closed", () => ocr.cancel());
      win.on("closed", () => { win = null; });
      if (isDev) win.loadURL(trusted);
      else win.loadFile(appFile);
    }
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  ocr?.cancel();
  if (quitting || !helper) return;
  // Every save is already on disk; let the helper close its connections cleanly.
  event.preventDefault();
  quitting = true;
  helper.stop().finally(() => app.quit());
});
