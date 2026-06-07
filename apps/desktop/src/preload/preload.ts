import { contextBridge, ipcRenderer } from "electron";

import type { BackupResult } from "../services/backup";
import type {
  ConfigureReceiptPrintProfileInput,
  PrintProfileSummary,
  PrintReceiptSummary,
  WindowsPrinterSummary
} from "../services/printing";
import type { StartSimulatedWeighingInput } from "../services/runtime";
import type { DesktopStatusSnapshot } from "../services/status";
import type { UpdateState } from "../services/update-flow";
import type { WeighingOperationSummary } from "../services/weighing-operations";

export interface KyberRockDesktopApi {
  getStatus: (internetOnline?: boolean) => Promise<DesktopStatusSnapshot>;
  exportBackup: () => Promise<BackupResult | null>;
  restoreBackup: () => Promise<boolean>;
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdates: () => Promise<UpdateState>;
  downloadAndInstallUpdate: () => Promise<UpdateState>;
  listOpenWeighingOperations: () => Promise<WeighingOperationSummary[]>;
  startSimulatedWeighing: (input: StartSimulatedWeighingInput) => Promise<WeighingOperationSummary>;
  closeSimulatedWeighing: (operationId: string) => Promise<WeighingOperationSummary>;
  cancelWeighing: (operationId: string, reason: string) => Promise<WeighingOperationSummary>;
  listWindowsPrinters: () => Promise<WindowsPrinterSummary[]>;
  configureReceiptPrintProfile: (
    input: Omit<ConfigureReceiptPrintProfileInput, "identity">
  ) => Promise<PrintProfileSummary>;
  listPrintProfiles: () => Promise<PrintProfileSummary[]>;
  listPrintReceipts: () => Promise<PrintReceiptSummary[]>;
  printReceipt: (operationId: string) => Promise<PrintReceiptSummary>;
  reprintReceipt: (receiptId: string) => Promise<PrintReceiptSummary>;
}

const desktopApi: KyberRockDesktopApi = {
  getStatus: (internetOnline) =>
    ipcRenderer.invoke("desktop:get-status", internetOnline) as Promise<DesktopStatusSnapshot>,
  exportBackup: () => ipcRenderer.invoke("desktop:export-backup") as Promise<BackupResult | null>,
  restoreBackup: () => ipcRenderer.invoke("desktop:restore-backup") as Promise<boolean>,
  getUpdateState: () => ipcRenderer.invoke("desktop:get-update-state") as Promise<UpdateState>,
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates") as Promise<UpdateState>,
  downloadAndInstallUpdate: () =>
    ipcRenderer.invoke("desktop:download-and-install-update") as Promise<UpdateState>,
  listOpenWeighingOperations: () =>
    ipcRenderer.invoke("desktop:list-open-weighing-operations") as Promise<
      WeighingOperationSummary[]
    >,
  startSimulatedWeighing: (input) =>
    ipcRenderer.invoke(
      "desktop:start-simulated-weighing",
      input
    ) as Promise<WeighingOperationSummary>,
  closeSimulatedWeighing: (operationId) =>
    ipcRenderer.invoke(
      "desktop:close-simulated-weighing",
      operationId
    ) as Promise<WeighingOperationSummary>,
  cancelWeighing: (operationId, reason) =>
    ipcRenderer.invoke(
      "desktop:cancel-weighing",
      operationId,
      reason
    ) as Promise<WeighingOperationSummary>,
  listWindowsPrinters: () =>
    ipcRenderer.invoke("desktop:list-windows-printers") as Promise<WindowsPrinterSummary[]>,
  configureReceiptPrintProfile: (input) =>
    ipcRenderer.invoke(
      "desktop:configure-receipt-print-profile",
      input
    ) as Promise<PrintProfileSummary>,
  listPrintProfiles: () =>
    ipcRenderer.invoke("desktop:list-print-profiles") as Promise<PrintProfileSummary[]>,
  listPrintReceipts: () =>
    ipcRenderer.invoke("desktop:list-print-receipts") as Promise<PrintReceiptSummary[]>,
  printReceipt: (operationId) =>
    ipcRenderer.invoke("desktop:print-receipt", operationId) as Promise<PrintReceiptSummary>,
  reprintReceipt: (receiptId) =>
    ipcRenderer.invoke("desktop:reprint-receipt", receiptId) as Promise<PrintReceiptSummary>
};

contextBridge.exposeInMainWorld("kyberrockDesktop", desktopApi);
