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
  printTestReceipt: () => Promise<PrintReceiptSummary>;
  syncToCloud: () => Promise<SyncResult>;
  getCloudStatus: () => Promise<{ totalOperations: number; lastSync: string | null }>;
  isCloudConnected: () => Promise<boolean>;
}
