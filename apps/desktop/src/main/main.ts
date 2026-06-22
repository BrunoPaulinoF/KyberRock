import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import type * as ElectronUpdater from "electron-updater";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

import { DesktopRuntime, type FiscalDocumentPrinter } from "../services/runtime.js";
import type { ActivateDesktopInput } from "../services/desktop-activation.js";
import type { CacheQueryOptions } from "../services/cache-store.js";
import type { CreateCustomerInput, UpdateCustomerInput } from "../services/customers.js";
import type {
  AddPriceTableItemInput,
  CreatePriceTableInput,
  LinkCustomerToPriceTableInput,
  UpdatePriceTableItemInput
} from "../services/price-tables.js";
import type { CreateVehicleInput, UpdateVehicleInput } from "../services/vehicles.js";
import type { CreateDriverInput, UpdateDriverInput } from "../services/drivers.js";
import type { CreateCarrierInput, UpdateCarrierInput } from "../services/carriers.js";
import type { ToledoTcpConfig } from "@kyberrock/scale-adapters";
import type { ScaleConfigurationInput } from "../services/scale-configs.js";
import type {
  ConfigureReceiptPrintProfileInput,
  ReceiptPrintPayload,
  ReceiptPrinter,
  WindowsPrinterSummary
} from "../services/printing.js";
import { createInitialUpdateState, type UpdateState } from "../services/update-flow.js";
import type { OperationType } from "../services/weighing-operations.js";

const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater") as typeof ElectronUpdater;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const appIconPath = path.join(currentDirectory, "../../midia/logo.png");
let mainWindow: BrowserWindow | null = null;
let runtime: DesktopRuntime | null = null;
let updateState: UpdateState = createInitialUpdateState();
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos

async function createMainWindow(): Promise<void> {
  writeStartupLog("createMainWindow:start");
  runtime = DesktopRuntime.initialize();
  writeStartupLog("runtime:initialized");
  runtime.startAutomaticBackupScheduler();
  writeStartupLog("backupScheduler:started");
  runtime.startOmiePullScheduler();
  writeStartupLog("omieScheduler:started");
  runtime.startCloudSyncScheduler();
  writeStartupLog("cloudScheduler:started");

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: "KyberRock Desktop",
    icon: appIconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(currentDirectory, "../preload/preload.js")
    }
  });
  Menu.setApplicationMenu(null);
  writeStartupLog("browserWindow:created");
  mainWindow.maximize();
  mainWindow.webContents.on("did-finish-load", () => {
    writeStartupLog("renderer:did-finish-load", mainWindow?.webContents.getURL());
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      writeStartupLog("renderer:did-fail-load", { errorCode, errorDescription, validatedURL });
    }
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeStartupLog("renderer:process-gone", details);
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    writeStartupLog("renderer:console-message", { level, message, line, sourceId });
  });
  runtime.setReceiptPrinter(createElectronReceiptPrinter(mainWindow));
  runtime.setFiscalDocumentPrinter(createElectronFiscalDocumentPrinter(mainWindow));

  const devServerUrl = process.env.KYBERROCK_DESKTOP_DEV_SERVER_URL;

  if (devServerUrl) {
    writeStartupLog("browserWindow:loadURL", devServerUrl);
    await mainWindow.loadURL(devServerUrl);
  } else {
    const rendererPath = path.join(currentDirectory, "../renderer/index.html");
    writeStartupLog("browserWindow:loadFile", rendererPath);
    await mainWindow.loadFile(rendererPath);
  }

  writeStartupLog("createMainWindow:done");
  startAutomaticUpdateChecks();
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

  ipcMain.handle("desktop:get-access-status", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.getDesktopAccessStatus();
  });

  ipcMain.handle("desktop:validate-access", (_event, internetOnline?: boolean, force?: boolean) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.validateDesktopAccess(internetOnline, force);
  });

  ipcMain.handle("desktop:activate", (_event, input: ActivateDesktopInput) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.activateDesktop(input);
  });

  ipcMain.handle("desktop:logout", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    runtime.logoutDesktop();
  });

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
    try {
      const result = await autoUpdater.checkForUpdates();
      updateState = result?.updateInfo
        ? { status: "available", availableVersion: result.updateInfo.version, errorMessage: null }
        : createInitialUpdateState();
    } catch (err) {
      updateState = {
        status: "error",
        availableVersion: null,
        errorMessage: err instanceof Error ? err.message : "Falha ao verificar atualizacoes."
      };
    }

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

    try {
      if (updateState.status === "available") {
        updateState = { ...updateState, status: "downloading" };
        await autoUpdater.downloadUpdate();
      }
      autoUpdater.quitAndInstall(false, true);
    } catch (err) {
      updateState = {
        status: "error",
        availableVersion: null,
        errorMessage: err instanceof Error ? err.message : "Falha ao baixar atualizacao."
      };
    }

    return updateState;
  });

  ipcMain.handle("desktop:list-open-weighing-operations", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.listOpenWeighingOperations();
  });

  ipcMain.handle("desktop:list-canceled-weighing-operations", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.listCanceledWeighingOperations();
  });

  ipcMain.handle("desktop:list-closed-weighing-operations", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.listClosedWeighingOperations();
  });

  ipcMain.handle("desktop:clear-canceled-weighing-operations", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.clearCanceledWeighingOperations();
  });

  ipcMain.handle("desktop:start-weighing", async (_event, input: unknown) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.startWeighing(input as Parameters<DesktopRuntime["startWeighing"]>[0]);
  });

  ipcMain.handle(
    "desktop:close-weighing",
    async (_event, operationId: string, operationType?: string) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }

      return runtime.closeWeighing(operationId, operationType as OperationType | undefined);
    }
  );

  ipcMain.handle("desktop:cancel-weighing", (_event, operationId: string, reason: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.cancelWeighing(operationId, reason);
  });

  ipcMain.handle("desktop:list-windows-printers", async () => {
    if (!mainWindow) {
      throw new Error("Desktop window is not ready.");
    }

    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(
      (printer): WindowsPrinterSummary => ({
        name: printer.name,
        isDefault: Boolean((printer as { isDefault?: boolean }).isDefault)
      })
    );
  });

  ipcMain.handle(
    "desktop:configure-receipt-print-profile",
    (_event, input: Omit<ConfigureReceiptPrintProfileInput, "identity">) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }

      return runtime.configureReceiptPrintProfile(input);
    }
  );

  ipcMain.handle("desktop:list-print-profiles", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.listPrintProfiles();
  });

  ipcMain.handle("desktop:list-print-receipts", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.listPrintReceipts();
  });

  ipcMain.handle("desktop:print-receipt", (_event, operationId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.printReceipt(operationId);
  });

  ipcMain.handle("desktop:reprint-receipt", (_event, receiptId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.reprintReceipt(receiptId);
  });

  ipcMain.handle("desktop:print-test-receipt", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.printTestReceipt();
  });

  ipcMain.handle("desktop:bill-fiscal-operation", async (_event, operationId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.processFiscalBilling(operationId);
  });

  ipcMain.handle("desktop:sync-to-cloud", async () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.syncToCloud();
  });

  ipcMain.handle("desktop:get-cloud-status", async () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.getCloudStatus();
  });

  ipcMain.handle("desktop:is-cloud-connected", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.isCloudConnected();
  });

  ipcMain.handle("desktop:query-cache", (_event, options: CacheQueryOptions) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.queryCache(options);
  });

  ipcMain.handle("desktop:get-daily-report", (_event, date: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getDailyReport(date);
  });

  ipcMain.handle("desktop:get-monthly-report", (_event, year: number, month: number) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getMonthlyReport(year, month);
  });

  ipcMain.handle(
    "desktop:get-report-by-product",
    (_event, startDate: string, endDate: string, limit?: number) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.getReportByProduct(startDate, endDate, limit);
    }
  );

  ipcMain.handle(
    "desktop:get-report-by-customer",
    (_event, startDate: string, endDate: string, limit?: number) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.getReportByCustomer(startDate, endDate, limit);
    }
  );

  ipcMain.handle("desktop:get-daily-series", (_event, startDate: string, endDate: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getDailySeries(startDate, endDate);
  });

  ipcMain.handle("desktop:get-operation-mix", (_event, startDate: string, endDate: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getOperationMix(startDate, endDate);
  });

  ipcMain.handle("desktop:get-report-html", (_event, startDate: string, endDate: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getReportHtml(startDate, endDate);
  });

  ipcMain.handle(
    "desktop:export-report-pdf",
    async (_event, startDate: string, endDate: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      if (!mainWindow) throw new Error("Janela principal nao disponivel.");
      runtime.getReportHtml(startDate, endDate);
      const target = mainWindow.webContents;
      const data = await target.printToPDF({
        pageSize: "A4",
        printBackground: true,
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
      });
      const filePath = await pickReportFilePath(`relatorio-${startDate}-a-${endDate}.pdf`, ["pdf"]);
      if (!filePath) return null;
      const fs = await import("node:fs/promises");
      await fs.writeFile(filePath, data);
      return { path: filePath };
    }
  );

  ipcMain.handle(
    "desktop:export-report-excel",
    async (_event, startDate: string, endDate: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      const html = runtime.getReportHtml(startDate, endDate);
      const filePath = await pickReportFilePath(
        `relatorio-${startDate}-a-${endDate}.xls`,
        ["xls"]
      );
      if (!filePath) return null;
      const fs = await import("node:fs/promises");
      await fs.writeFile(filePath, html, "utf8");
      return { path: filePath };
    }
  );

  ipcMain.handle("desktop:list-report-recipients", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listReportRecipients();
  });

  ipcMain.handle(
    "desktop:create-report-recipient",
    (_event, input: { email: string; displayName?: string | null; isActive?: boolean }) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.createReportRecipient(input);
    }
  );

  ipcMain.handle(
    "desktop:update-report-recipient",
    (
      _event,
      id: string,
      input: { email?: string; displayName?: string | null; isActive?: boolean }
    ) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.updateReportRecipient(id, input);
    }
  );

  ipcMain.handle("desktop:delete-report-recipient", (_event, id: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    runtime.deleteReportRecipient(id);
  });

  ipcMain.handle("desktop:get-price", (_event, customerId: string, productId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.getPriceForCustomerProduct(customerId, productId);
  });

  ipcMain.handle("desktop:get-price-details", (_event, customerId: string, productId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.getPriceDetailsForCustomerProduct(customerId, productId);
  });

  ipcMain.handle(
    "desktop:customers-create",
    (_event, input: Omit<CreateCustomerInput, "companyId">) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }

      return runtime.createCustomer(input);
    }
  );

  ipcMain.handle("desktop:customers-update", (_event, id: string, input: UpdateCustomerInput) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.updateCustomer(id, input);
  });

  ipcMain.handle("desktop:customers-delete", (_event, id: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    runtime.deleteCustomer(id);
  });

  ipcMain.handle(
    "desktop:price-tables-create",
    (_event, input: Omit<CreatePriceTableInput, "companyId">) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.createPriceTable(input);
    }
  );

  ipcMain.handle("desktop:price-tables-update-name", (_event, id: string, name: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.updatePriceTableName(id, name);
  });

  ipcMain.handle("desktop:price-tables-delete", (_event, id: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    runtime.deletePriceTable(id);
  });

  ipcMain.handle("desktop:price-tables-add-item", (_event, input: AddPriceTableItemInput) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.addPriceTableItem(input);
  });

  ipcMain.handle(
    "desktop:price-tables-update-item",
    (_event, id: string, input: UpdatePriceTableItemInput) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.updatePriceTableItem(id, input);
    }
  );

  ipcMain.handle("desktop:price-tables-remove-item", (_event, id: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    runtime.removePriceTableItem(id);
  });

  ipcMain.handle(
    "desktop:price-tables-link-customer",
    (_event, input: LinkCustomerToPriceTableInput) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.linkCustomerToPriceTable(input);
    }
  );

  ipcMain.handle("desktop:price-tables-unlink-customer", (_event, linkId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    runtime.unlinkCustomerFromPriceTable(linkId);
  });

  ipcMain.handle("desktop:price-tables-list", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listPriceTables();
  });

  ipcMain.handle("desktop:price-tables-list-items", (_event, priceTableId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listPriceTableItems(priceTableId);
  });

  ipcMain.handle("desktop:price-tables-list-customer-links", (_event, priceTableId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listCustomerLinks(priceTableId);
  });

  ipcMain.handle(
    "desktop:vehicles-create",
    (_event, input: Omit<CreateVehicleInput, "companyId">) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.createVehicle(input);
    }
  );

  ipcMain.handle("desktop:vehicles-update", (_event, id: string, input: UpdateVehicleInput) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.updateVehicle(id, input);
  });

  ipcMain.handle("desktop:vehicles-delete", (_event, id: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    runtime.deleteVehicle(id);
  });

  ipcMain.handle("desktop:vehicles-find-or-create", (_event, plate: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.findOrCreateVehicle(plate);
  });

  ipcMain.handle("desktop:vehicles-get-carriers", (_event, vehicleId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getVehicleCarriers(vehicleId);
  });

  ipcMain.handle(
    "desktop:vehicles-link-carrier",
    (_event, vehicleId: string, carrierId: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.linkVehicleToCarrier(vehicleId, carrierId);
    }
  );

  ipcMain.handle("desktop:customers-by-carrier", (_event, carrierId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getCustomersByCarrier(carrierId);
  });

  ipcMain.handle(
    "desktop:drivers-create",
    (_event, input: Omit<CreateDriverInput, "companyId">) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.createDriver(input);
    }
  );

  ipcMain.handle("desktop:drivers-update", (_event, id: string, input: UpdateDriverInput) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.updateDriver(id, input);
  });

  ipcMain.handle("desktop:drivers-delete", (_event, id: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    runtime.deleteDriver(id);
  });

  ipcMain.handle("desktop:drivers-find-or-create", (_event, name: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.findOrCreateDriver(name);
  });

  ipcMain.handle("desktop:plate-scanned", (_event, plate: string) => {
    if (mainWindow) {
      mainWindow.webContents.send("desktop:plate-scanned", plate);
    }
  });

  ipcMain.handle(
    "desktop:carriers-create",
    (_event, input: Omit<CreateCarrierInput, "companyId">) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.createCarrier(input);
    }
  );

  ipcMain.handle("desktop:carriers-update", (_event, id: string, input: UpdateCarrierInput) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.updateCarrier(id, input);
  });

  ipcMain.handle("desktop:carriers-delete", (_event, id: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    runtime.deleteCarrier(id);
  });

  ipcMain.handle("desktop:carriers-list", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listCarriers();
  });

  ipcMain.handle("desktop:carriers-get-vehicles", (_event, carrierId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getCarrierVehicles(carrierId);
  });

  ipcMain.handle("desktop:get-omie-status", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getOmieSyncStatus();
  });

  ipcMain.handle("desktop:scale-connect", async (_event, config: ToledoTcpConfig) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    await runtime.connectScale(config);
    // Register live stream forwarding to renderer
    runtime.onScaleReading((reading) => {
      mainWindow?.webContents.send("desktop:scale-reading", reading);
    });
  });

  ipcMain.handle("desktop:scale-disconnect", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    runtime.disconnectScale();
  });

  ipcMain.handle("desktop:scale-read", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.readScale();
  });

  ipcMain.handle("desktop:scale-read-sampled", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.readScaleSampled();
  });

  ipcMain.handle("desktop:scale-get-status", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getScaleStatus();
  });

  ipcMain.handle("desktop:scale-get-config", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getScaleConfiguration();
  });

  ipcMain.handle("desktop:scale-save-config", (_event, input: ScaleConfigurationInput) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.saveScaleConfiguration(input);
  });

  ipcMain.handle("desktop:omie-config", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getOmieConfig();
  });

  ipcMain.handle("desktop:lookup-cep", async (_event, cep: string) => {
    const digits = String(cep ?? "").replace(/\D/g, "").slice(0, 8);
    if (digits.length !== 8) {
      throw new Error("CEP invalido. Informe 8 digitos.");
    }
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`Falha ao consultar CEP (HTTP ${response.status}).`);
    }
    const payload = (await response.json()) as {
      cep?: string;
      logradouro?: string;
      complemento?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
      erro?: boolean;
    };
    if (payload.erro) {
      throw new Error("CEP nao encontrado.");
    }
    return {
      zipcode: digits,
      street: String(payload.logradouro ?? "").trim(),
      complement: String(payload.complemento ?? "").trim(),
      neighborhood: String(payload.bairro ?? "").trim(),
      city: String(payload.localidade ?? "").trim(),
      state: String(payload.uf ?? "").trim().toUpperCase()
    };
  });

  ipcMain.handle("desktop:omie-sync", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.syncOmieAll();
  });

  ipcMain.handle("desktop:omie-data-entry-loop", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.runOmieDataEntryLoop();
  });

  ipcMain.handle("desktop:omie-loop-status", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getOmieLoopStatus();
  });

  ipcMain.handle("desktop:omie-scheduler-status", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getOmieSchedulerStatus();
  });

  ipcMain.handle(
    "desktop:omie-scheduler-config",
    (_event, config: { enabled?: boolean; intervalMinutes?: number }) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.setOmieSchedulerConfig(config);
    }
  );

  ipcMain.handle("desktop:cloud-sync-now", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.syncCloudNow();
  });

  ipcMain.handle("desktop:cloud-scheduler-status", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getCloudSyncSchedulerStatus();
  });

  ipcMain.handle(
    "desktop:cloud-scheduler-config",
    (_event, config: { enabled?: boolean; intervalMinutes?: number }) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.setCloudSyncConfig(config);
    }
  );

  ipcMain.handle("desktop:probe-connectivity", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.probeCloudConnectivity();
  });
}

function createElectronReceiptPrinter(parentWindow: BrowserWindow): ReceiptPrinter {
  return {
    async printReceipt(payload) {
      const printWindow = new BrowserWindow({
        show: false,
        parent: parentWindow,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });

      try {
        await printWindow.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(buildReceiptHtml(payload))}`
        );
        await new Promise<void>((resolve, reject) => {
          printWindow.webContents.print(
            {
              silent: true,
              printBackground: false,
              deviceName: payload.printerName
            },
            (success, failureReason) => {
              if (success) {
                resolve();
                return;
              }

              reject(new Error(failureReason || "Falha ao imprimir cupom."));
            }
          );
        });
      } finally {
        printWindow.close();
      }
    }
  };
}

function createElectronFiscalDocumentPrinter(parentWindow: BrowserWindow): FiscalDocumentPrinter {
  return {
    async printDocument(documentUrl) {
      const printWindow = new BrowserWindow({
        show: false,
        parent: parentWindow,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });

      try {
        await printWindow.loadURL(documentUrl);
        await new Promise<void>((resolve, reject) => {
          printWindow.webContents.print(
            {
              silent: true,
              printBackground: true
            },
            (success, failureReason) => {
              if (success) {
                resolve();
                return;
              }

              reject(new Error(failureReason || "Falha ao imprimir documento fiscal."));
            }
          );
        });
        return { printed: true, error: null };
      } catch (error) {
        return {
          printed: false,
          error: error instanceof Error ? error.message : "Falha ao imprimir documento fiscal."
        };
      } finally {
        printWindow.close();
      }
    }
  };
}

function buildReceiptHtml(payload: ReceiptPrintPayload): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: ${payload.paperWidthMm}mm auto; margin: 4mm; }
      body { margin: 0; font-family: Consolas, monospace; font-size: 11px; color: #000; }
      pre { white-space: pre-wrap; margin: 0; }
    </style>
  </head>
  <body><pre>${escapeHtml(payload.contentText)}</pre></body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function configureAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-available", (info) => {
    updateState = { status: "available", availableVersion: info.version, errorMessage: null };
    mainWindow?.webContents.send("desktop:update-available", info.version);
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

function startAutomaticUpdateChecks(): void {
  if (!app.isPackaged) {
    return;
  }

  void autoUpdater.checkForUpdates();
  setInterval(() => {
    if (updateState.status === "idle" || updateState.status === "error") {
      void autoUpdater.checkForUpdates();
    }
  }, UPDATE_CHECK_INTERVAL_MS);
}

function getStartupLogPath(): string {
  const baseDirectory =
    process.env.LOCALAPPDATA ?? process.env.TEMP ?? process.env.TMP ?? process.cwd();
  return path.join(baseDirectory, "KyberRock Desktop", "startup.log");
}

function writeStartupLog(step: string, detail?: unknown): void {
  try {
    const logPath = getStartupLogPath();
    mkdirSync(path.dirname(logPath), { recursive: true });
    const serializedDetail = detail === undefined ? "" : ` ${inspect(detail, { depth: 4 })}`;
    appendFileSync(logPath, `[${new Date().toISOString()}] ${step}${serializedDetail}\n`);
  } catch {
    // Startup logging must never prevent the app from opening.
  }
}

async function pickReportFilePath(
  defaultName: string,
  allowedExtensions: string[]
): Promise<string | null> {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Salvar relatorio",
    defaultPath: defaultName,
    filters: [{ name: defaultName, extensions: allowedExtensions }]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

process.on("uncaughtException", (error) => {
  writeStartupLog("process:uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  writeStartupLog("process:unhandledRejection", reason);
});

configureAutoUpdater();
registerIpcHandlers();

async function bootstrap(): Promise<void> {
  writeStartupLog("app:waitingReady", {
    isPackaged: app.isPackaged,
    currentDirectory,
    argv: process.argv
  });
  await app.whenReady();
  writeStartupLog("app:ready", { userData: app.getPath("userData") });
  await createMainWindow();
}

void bootstrap().catch((error: unknown) => {
  writeStartupLog("bootstrap:error", error);
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  dialog.showErrorBox("KyberRock Desktop", `Falha ao abrir o aplicativo.\n\n${message}`);
  app.quit();
});

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
