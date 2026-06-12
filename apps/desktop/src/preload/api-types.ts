import type { BackupResult } from "../services/backup";
import type {
  ConfigureReceiptPrintProfileInput,
  PrintProfileSummary,
  PrintReceiptSummary,
  WindowsPrinterSummary
} from "../services/printing";
import type { DesktopStatusSnapshot } from "../services/status";
import type { UpdateState } from "../services/update-flow";
import type { OperationType, WeighingOperationSummary } from "../services/weighing-operations";
import type { SyncResult } from "../services/supabase-sync";
import type { ActivateDesktopInput, DesktopAccessStatus } from "../services/desktop-activation";
import type { CacheQueryOptions, CacheQueryResult } from "../services/cache-store";
import type {
  CreateCustomerInput,
  UpdateCustomerInput
} from "../services/customers";
import type {
  AddPriceTableItemInput,
  CreatePriceTableInput,
  LinkCustomerToPriceTableInput,
  UpdatePriceTableItemInput
} from "../services/price-tables";
import type {
  CreateVehicleInput,
  UpdateVehicleInput
} from "../services/vehicles";
import type {
  CreateDriverInput,
  UpdateDriverInput
} from "../services/drivers";
import type {
  CreateCarrierInput,
  UpdateCarrierInput
} from "../services/carriers";
import type {
  ToledoTcpConfig,
  ToledoTcpAdapterStatus,
  ParsedToledoReading
} from "@kyberrock/scale-adapters";

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
  startWeighing: (input: {
    customerId: string;
    vehicleId: string;
    carrierId?: string;
    driverId: string;
    productId: string;
    paymentTermId?: string;
    unitPriceCents?: number;
  }) => Promise<WeighingOperationSummary>;
  closeWeighing: (operationId: string, operationType?: OperationType) => Promise<WeighingOperationSummary>;
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
  queryCache: (options: CacheQueryOptions) => Promise<CacheQueryResult<unknown>>;
  getPriceForCustomerProduct: (customerId: string, productId: string) => Promise<number | null>;
  customersCreate: (input: Omit<CreateCustomerInput, "companyId">) => Promise<unknown>;
  customersUpdate: (id: string, input: UpdateCustomerInput) => Promise<unknown>;
  customersDelete: (id: string) => Promise<void>;
  priceTablesCreate: (input: Omit<CreatePriceTableInput, "companyId">) => Promise<unknown>;
  priceTablesUpdateName: (id: string, name: string) => Promise<unknown>;
  priceTablesDelete: (id: string) => Promise<void>;
  priceTablesAddItem: (input: AddPriceTableItemInput) => Promise<unknown>;
  priceTablesUpdateItem: (id: string, input: UpdatePriceTableItemInput) => Promise<unknown>;
  priceTablesRemoveItem: (id: string) => Promise<void>;
  priceTablesLinkCustomer: (input: LinkCustomerToPriceTableInput) => Promise<unknown>;
  priceTablesUnlinkCustomer: (linkId: string) => Promise<void>;
  priceTablesList: () => Promise<unknown[]>;
  priceTablesListItems: (priceTableId: string) => Promise<unknown[]>;
  priceTablesListCustomerLinks: (priceTableId: string) => Promise<unknown[]>;
  vehiclesCreate: (input: Omit<CreateVehicleInput, "companyId">) => Promise<unknown>;
  vehiclesUpdate: (id: string, input: UpdateVehicleInput) => Promise<unknown>;
  vehiclesDelete: (id: string) => Promise<void>;
  vehiclesFindOrCreate: (plate: string) => Promise<unknown>;
  vehiclesGetCarriers: (vehicleId: string) => Promise<Array<{ carrierId: string; carrierName: string; carrierDocument: string | null }>>;
  vehiclesLinkCarrier: (vehicleId: string, carrierId: string) => Promise<unknown>;
  customersByCarrier: (carrierId: string) => Promise<unknown[]>;
  driversCreate: (input: Omit<CreateDriverInput, "companyId">) => Promise<unknown>;
  driversUpdate: (id: string, input: UpdateDriverInput) => Promise<unknown>;
  driversDelete: (id: string) => Promise<void>;
  driversFindOrCreate: (name: string) => Promise<unknown>;
  carriersCreate: (input: Omit<CreateCarrierInput, "companyId">) => Promise<unknown>;
  carriersUpdate: (id: string, input: UpdateCarrierInput) => Promise<unknown>;
  carriersDelete: (id: string) => Promise<void>;
  carriersList: () => Promise<unknown[]>;
  carriersGetVehicles: (carrierId: string) => Promise<Array<{ id: string; plate: string; description: string | null }>>;
  getOmieStatus: () => Promise<{
    configured: boolean;
    appKeyMasked: string | null;
    hasSyncedData: boolean;
    totalCustomers: number;
    totalProducts: number;
    totalPaymentTerms: number;
    pendingPushCustomers: number;
    lastSyncAt: string | null;
  }>;
  scaleConnect: (config: ToledoTcpConfig) => Promise<void>;
  scaleDisconnect: () => Promise<void>;
  scaleRead: () => Promise<{ weightKg: number; stable: boolean }>;
  scaleGetStatus: () => Promise<ToledoTcpAdapterStatus>;
  omieConfig: () => Promise<{ configured: boolean; appKeyMasked: string | null }>;
  omieSync: () => Promise<{
    customersPulled: number;
    customersPushed: number;
    productsSynced: number;
    paymentTermsSynced: number;
    ordersProcessed: number;
    ordersFailed: number;
    errors: string[];
  }>;
  onUpdateAvailable: (callback: (event: unknown, version: string) => void) => void;
  offUpdateAvailable: (callback: (event: unknown, version: string) => void) => void;
  onPlateScanned: (callback: (plate: string) => void) => void;
  onScaleReading: (callback: (reading: ParsedToledoReading) => void) => void;
  offScaleReading: (callback: (reading: ParsedToledoReading) => void) => void;
}
