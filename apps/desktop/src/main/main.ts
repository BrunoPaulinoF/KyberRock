import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DesktopRuntime, type StartSimulatedWeighingInput } from "../services/runtime.js";
import { createInitialUpdateState, type UpdateState } from "../services/update-flow.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let runtime: DesktopRuntime | null = null;
let updateState: UpdateState = createInitialUpdateState();

async function createMainWindow(): Promise<void> {
  runtime = DesktopRuntime.initialize();
  runtime.startAutomaticBackupScheduler();

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: "KyberRock Desktop",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(currentDirectory, "../preload/preload.js")
    }
  });

  const devServerUrl = process.env.KYBERROCK_DESKTOP_DEV_SERVER_URL;

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(currentDirectory, "../renderer/index.html"));
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("desktop:get-status", (_event, internetOnline?: boolean) =>
    runtime?.getStatus(internetOnline)
  );

  ipcMain.handle("desktop:export-backup", async () => {
    if (!runtime || !mainWindow) {
      throw new Error("Desktop runtime is not ready.");
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Exportar backup KyberRock",
      defaultPath: "kyberrock-backup.sqlite3",
      filters: [{ name: "SQLite", extensions: ["sqlite3"] }]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    return runtime.exportBackup(result.filePath);
  });

  ipcMain.handle("desktop:restore-backup", async () => {
    if (!runtime || !mainWindow) {
      throw new Error("Desktop runtime is not ready.");
    }

    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Cancelar", "Restaurar"],
      defaultId: 0,
      cancelId: 0,
      title: "Restaurar backup",
      message: "Restaurar um backup substitui o banco local atual.",
      detail: "Confirme somente se o aplicativo estiver parado operacionalmente."
    });

    if (confirmation.response !== 1) {
      return false;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Selecionar backup KyberRock",
      properties: ["openFile"],
      filters: [{ name: "SQLite", extensions: ["sqlite3"] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return false;
    }

    runtime.restoreFromBackup(result.filePaths[0]);
    return true;
  });

  ipcMain.handle("desktop:get-update-state", () => updateState);

  ipcMain.handle("desktop:check-for-updates", async () => {
    if (!app.isPackaged) {
      updateState = {
        status: "error",
        availableVersion: null,
        errorMessage: "Atualizacoes so funcionam no aplicativo instalado."
      };
      return updateState;
    }

    updateState = { status: "checking", availableVersion: null, errorMessage: null };
    const result = await autoUpdater.checkForUpdates();
    updateState = result?.updateInfo
      ? { status: "available", availableVersion: result.updateInfo.version, errorMessage: null }
      : createInitialUpdateState();

    return updateState;
  });

  ipcMain.handle("desktop:download-and-install-update", async () => {
    if (!app.isPackaged) {
      updateState = {
        status: "error",
        availableVersion: null,
        errorMessage: "Instalacao de update so funciona no aplicativo instalado."
      };
      return updateState;
    }

    if (updateState.status !== "available" && updateState.status !== "downloaded") {
      return updateState;
    }

    if (updateState.status === "available") {
      updateState = { ...updateState, status: "downloading" };
      await autoUpdater.downloadUpdate();
    }

    autoUpdater.quitAndInstall(false, true);
    return updateState;
  });

  ipcMain.handle("desktop:list-open-weighing-operations", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.listOpenWeighingOperations();
  });

  ipcMain.handle(
    "desktop:start-simulated-weighing",
    async (_event, input: StartSimulatedWeighingInput) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }

      return runtime.startSimulatedWeighing(input);
    }
  );

  ipcMain.handle("desktop:close-simulated-weighing", async (_event, operationId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.closeSimulatedWeighing(operationId);
  });

  ipcMain.handle("desktop:cancel-weighing", (_event, operationId: string, reason: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.cancelWeighing(operationId, reason);
  });
}

function configureAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-available", (info) => {
    updateState = { status: "available", availableVersion: info.version, errorMessage: null };
  });
  autoUpdater.on("update-not-available", () => {
    updateState = createInitialUpdateState();
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateState = { status: "downloaded", availableVersion: info.version, errorMessage: null };
  });
  autoUpdater.on("error", (error) => {
    updateState = { status: "error", availableVersion: null, errorMessage: error.message };
  });
}

configureAutoUpdater();
registerIpcHandlers();

await app.whenReady();
await createMainWindow();

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  runtime?.close();
  runtime = null;
});
