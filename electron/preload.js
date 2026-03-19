const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  versao: "1.0.0"
});
