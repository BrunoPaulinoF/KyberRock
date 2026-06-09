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
import type { SyncResult } from "../services/supabase-sync";
import type { ActivateDesktopInput, DesktopAccessStatus } from "../services/desktop-activation";

export interface KyberRockDesktopApi {
  getStatus: (internetOnline?: boolean) => Promise<DesktopStatusSnapshot>;
  exportBackup: () => Promise<BackupResult | null>;
  restoreBackup: () => Promise<boolean>;
  getUpdateState: () => Promise<UpdateState>;
  getAccessStatus: () => Promise<DesktopAccessStatus>;
  validateDesktopAccess: (internetOnline?: boolean, force?: boolean) => Promise<DesktopAccessStatus>;
  activateDesktop: (input: ActivateDesktopInput) => Promise<DesktopAccessStatus>;
  logoutDesktop: () => Promise<void>;
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
  printTestReceipt: () => Promise<PrintReceiptSummary>;
  syncToCloud: () => Promise<SyncResult>;
  getCloudStatus: () => Promise<{ totalOperations: number; lastSync: string | null }>;
  isCloudConnected: () => Promise<boolean>;
  onUpdateAvailable: (callback: (event: unknown, version: string) => void) => void;
  offUpdateAvailable: (callback: (event: unknown, version: string) => void) => void;
}
