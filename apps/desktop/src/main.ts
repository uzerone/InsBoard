import { createServer } from "node:net";
import { join } from "node:path";
import { app, BrowserWindow, Menu, nativeImage, nativeTheme, shell } from "electron";

const APP_NAME = "InsBoard";
const HOST = "127.0.0.1";

let mainWindow: BrowserWindow | null = null;
let apiServer: { close(callback?: (error?: Error) => void): void } | null = null;
let shutdownApiResources: (() => void) | null = null;

app.setName(APP_NAME);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Unable to reserve a local port."));
        return;
      }
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startApi(): Promise<string> {
  const port = await reservePort();
  process.env.HOST = HOST;
  process.env.PORT = String(port);
  process.env.DATA_DIR = join(app.getPath("userData"), "workspace");
  process.env.WEB_DIST_DIR = join(app.getAppPath(), "apps", "web", "dist");

  const [{ serve }, api] = await Promise.all([
    import("@hono/node-server"),
    import("@insboard/api")
  ]);
  shutdownApiResources = api.shutdownApiResources;

  await new Promise<void>((resolve, reject) => {
    const server = serve(
      {
        fetch: api.app.fetch,
        websocket: { server: api.workflowWebSocketServer },
        hostname: HOST,
        port
      },
      () => resolve()
    );
    server.once("error", reject);
    apiServer = server;
  });

  return `http://${HOST}:${port}`;
}

function installMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "toggleDevTools" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" }
      ]
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function updateDockIcon(): void {
  if (process.platform !== "darwin") return;
  const filename = nativeTheme.shouldUseDarkColors ? "app-icon-dark.png" : "app-icon-light.png";
  const icon = nativeImage.createFromPath(join(app.getAppPath(), "apps", "web", "dist", filename));
  if (!icon.isEmpty()) app.dock?.setIcon(icon);
}

async function createMainWindow(): Promise<void> {
  const baseUrl = await startApi();
  installMenu();

  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1480,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#1c1d1f",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.session.on("will-download", (_event, item) => {
    if (!item.getFilename().toLowerCase().endsWith(".idb")) return;
    item.setSaveDialogOptions({
      title: "Save InsBoard Project",
      defaultPath: join(app.getPath("documents"), item.getFilename()),
      filters: [{ name: "InsBoard Project", extensions: ["idb"] }]
    });
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadURL(`${baseUrl}/canvas`);
}

function stopApi(): void {
  shutdownApiResources?.();
  shutdownApiResources = null;
  apiServer?.close();
  apiServer = null;
}

app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";
  updateDockIcon();
  nativeTheme.on("updated", updateDockIcon);
  return createMainWindow();
}).catch((error: unknown) => {
  console.error(`Failed to launch ${APP_NAME}:`, error);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});
app.on("before-quit", stopApi);
app.on("window-all-closed", () => app.quit());
