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
const { createStorage } = require("./storage.cjs");

app.setName("bits");
if (process.env.BITS_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.BITS_DATA_DIR));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let win;
let store;
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
    store = createStorage(app.getPath("userData"), validateLibrary);
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
    handle("library:load", () => store.load());
    handle("library:save", (data) => store.save(data));
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
      win.on("close", (event) => {
        if (quitting) return;
        event.preventDefault();
        store
          .flush()
          .then(() => {
            quitting = true;
            win.close();
          })
          .catch(async () => {
            const result = await dialog.showMessageBox(win, {
              type: "warning",
              message: "Your latest changes could not be saved.",
              detail:
                "Keep bits open to export your library, or close without saving.",
              buttons: ["Keep open", "Close without saving"],
              defaultId: 0,
              cancelId: 0,
            });
            if (result.response === 1) {
              quitting = true;
              win.close();
            }
          });
      });
      if (isDev) win.loadURL(trusted);
      else win.loadFile(appFile);
    }
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) {
        quitting = false;
        createWindow();
      }
    });
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => ocr?.cancel());
