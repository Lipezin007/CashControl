const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { startServer } = require("../backend/server");

let mainWindow;
let server;

const APP_URL = "http://localhost:3000";
const HEALTH_URL = `${APP_URL}/health`;

function resolveAppIcon() {
  const iconPath = path.join(__dirname, "..", "icon.png");
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

async function waitForBackend(timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) return;
    } catch {
      // Backend ainda subindo; tenta novamente.
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error("Backend nao respondeu ao healthcheck no tempo esperado.");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#071225",
    icon: resolveAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(APP_URL);
  mainWindow.removeMenu();
}

app.whenReady().then(async () => {
  server = startServer(3000);

  try {
    await waitForBackend();
  } catch (err) {
    console.error(err.message);
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (server) {
    server.close();
  }
});
