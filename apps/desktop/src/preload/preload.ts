import { contextBridge, ipcRenderer } from "electron";

import type { BackupResult } from "../services/backup";
import type { DesktopStatusSnapshot } from "../services/status";

export interface KyberRockDesktopApi {
  getStatus: (internetOnline?: boolean) => Promise<DesktopStatusSnapshot>;
  exportBackup: () => Promise<BackupResult | null>;
  restoreBackup: () => Promise<boolean>;
}

const desktopApi: KyberRockDesktopApi = {
  getStatus: (internetOnline) =>
    ipcRenderer.invoke("desktop:get-status", internetOnline) as Promise<DesktopStatusSnapshot>,
  exportBackup: () => ipcRenderer.invoke("desktop:export-backup") as Promise<BackupResult | null>,
  restoreBackup: () => ipcRenderer.invoke("desktop:restore-backup") as Promise<boolean>
};

contextBridge.exposeInMainWorld("kyberrockDesktop", desktopApi);
