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
import type { UpdatePaymentMethodInput } from "../services/payment-methods.js";
import type { UpdateAccountInput } from "../services/accounts.js";
import type {
  CreatePaymentTermInput,
  UpdatePaymentTermInput
} from "../services/payment-terms.js";
import type {
  AddPriceTableItemInput,
  CreatePriceTableInput,
  LinkCustomerToPriceTableInput,
  UpdatePriceTableItemInput
} from "../services/price-tables.js";
import type { CreateVehicleInput, UpdateVehicleInput } from "../services/vehicles.js";
import type { CreateDriverInput, UpdateDriverInput } from "../services/drivers.js";
import type { CreateCarrierInput, UpdateCarrierInput } from "../services/carriers.js";
import type { ScaleConfigurationInput } from "../services/scale-configs.js";
import type { CreateQuotationInput } from "../services/quotations.js";
import type {
  ConfigureReceiptPrintProfileInput,
  ReceiptPrintPayload,
  ReceiptPrinter,
  WindowsPrinterSummary
} from "../services/printing.js";
import { NetworkEscPosPrinter } from "../services/network-printer.js";
import {
  AUTO_DOWNLOAD_UPDATES,
  AUTO_INSTALL_ON_QUIT,
  createInitialUpdateState,
  type UpdateState
} from "../services/update-flow.js";
import { GITHUB_UPDATER_TOKEN } from "./updater-config.js";
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
  startReportDispatchScheduler();
  writeStartupLog("reportDispatchScheduler:started");

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

  // Defesa em profundidade (recomendacao de seguranca do Electron): o conteudo carregado e local
  // e confiavel, mas bloqueamos qualquer abertura de nova janela e qualquer navegacao para fora
  // do documento atual do app, contendo navegacao acidental/induzida no renderer (window.open,
  // location=, links). A navegacao interna do SPA usa estado React e nao dispara will-navigate.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
    }
  });
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

  // Auto-connect scale on startup if configured
  try {
    const connected = await runtime.tryAutoConnectScale();
    if (connected) {
      runtime.onScaleReading((reading) => {
        mainWindow?.webContents.send("desktop:scale-reading", reading);
      });
      writeStartupLog("scale:auto-connected");
    }
  } catch {
    writeStartupLog("scale:auto-connect:skipped");
  }

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

    if (
      updateState.status !== "available" &&
      updateState.status !== "downloading" &&
      updateState.status !== "downloaded"
    ) {
      return updateState;
    }

    try {
      if (updateState.status !== "downloaded") {
        updateState = { ...updateState, status: "downloading" };
        // Se o autoDownload ja iniciou o download, esta chamada apenas aguarda
        // o mesmo download em andamento concluir antes de instalar.
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

  ipcMain.handle("desktop:pull-loader-completions", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.pullLoaderCompletions();
  });

  ipcMain.handle("desktop:list-unit-devices", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.listUnitDevices();
  });

  ipcMain.handle("desktop:pull-cloud-now", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.pullCloudNow();
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

  ipcMain.handle("desktop:delete-closed-weighing-operation", (_event, operationId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.deleteClosedWeighingOperation(operationId);
  });

  ipcMain.handle("desktop:start-weighing", async (_event, input: unknown) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.startWeighing(input as Parameters<DesktopRuntime["startWeighing"]>[0]);
  });

  ipcMain.handle(
    "desktop:close-weighing",
    async (_event, operationId: string, operationType?: string, scaleCaptureId?: string) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }

      return runtime.closeWeighing(
        operationId,
        operationType as OperationType | undefined,
        scaleCaptureId
      );
    }
  );

  ipcMain.handle("desktop:cancel-weighing", (_event, operationId: string, reason: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.cancelWeighing(operationId, reason);
  });

  ipcMain.handle(
    "desktop:update-weighing-product",
    (_event, operationId: string, newProductId: string) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }

      return runtime.updateWeighingProduct({ operationId, newProductId });
    }
  );

  ipcMain.handle(
    "desktop:update-weighing-customer",
    (_event, operationId: string, newCustomerId: string) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }

      return runtime.updateWeighingCustomer({ operationId, newCustomerId });
    }
  );

  ipcMain.handle(
    "desktop:update-weighing-carrier",
    (_event, operationId: string, newCarrierId: string | null) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }

      return runtime.updateWeighingCarrier({ operationId, newCarrierId });
    }
  );

  ipcMain.handle("desktop:get-customer-freight-rules", (_event, customerId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }
    return runtime.getCustomerFreightRules(customerId);
  });

  ipcMain.handle(
    "desktop:get-customer-freight-for-product",
    (_event, customerId: string, productId: string) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }
      return runtime.getCustomerFreightForProduct(customerId, productId);
    }
  );

  ipcMain.handle("desktop:set-customer-freight-rule", (_event, input: unknown) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }
    return runtime.setCustomerFreightRule(
      input as Parameters<typeof runtime.setCustomerFreightRule>[0]
    );
  });

  ipcMain.handle("desktop:remove-customer-freight-rule", (_event, ruleId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }
    return runtime.removeCustomerFreightRule(ruleId);
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

  ipcMain.handle("desktop:bootstrap-cloud-data", async () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.bootstrapCloudData();
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

  ipcMain.handle("desktop:get-truck-control", (_event, startDate: string, endDate: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getTruckControlReport(startDate, endDate);
  });

  ipcMain.handle(
    "desktop:export-truck-control-pdf",
    async (_event, startDate: string, endDate: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      const html = runtime.getTruckControlHtml(startDate, endDate);
      const filePath = await pickReportFilePath(
        `controle-caminhoes-${startDate}-a-${endDate}.pdf`,
        ["pdf"]
      );
      if (!filePath) return null;
      const data = await renderHtmlToPdf(html);
      const fs = await import("node:fs/promises");
      await fs.writeFile(filePath, data);
      return { path: filePath };
    }
  );

  ipcMain.handle(
    "desktop:export-report-pdf",
    async (_event, startDate: string, endDate: string, periodLabel?: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      // Gera um PDF A4 estruturado com os dados dos Insights (KPIs, mix, top produtos,
      // serie diaria) via BrowserWindow oculta — nao mais uma captura da tela visivel.
      const html = runtime.getInsightsHtml(startDate, endDate, periodLabel);
      const filePath = await pickReportFilePath(`insights-${startDate}-a-${endDate}.pdf`, ["pdf"]);
      if (!filePath) return null;
      const data = await renderHtmlToPdf(html);
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
      const filePath = await pickReportFilePath(`relatorio-${startDate}-a-${endDate}.xls`, ["xls"]);
      if (!filePath) return null;
      const fs = await import("node:fs/promises");
      await fs.writeFile(filePath, html, "utf8");
      return { path: filePath };
    }
  );

  ipcMain.handle(
    "desktop:get-sales-pivot",
    (
      _event,
      startDate: string,
      endDate: string,
      groupBy: "customer" | "product" | "customer_product" | "day",
      filters?: { customerId?: string | null; productId?: string | null }
    ) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.getSalesPivot(startDate, endDate, groupBy, filters);
    }
  );

  ipcMain.handle("desktop:report-dispatch-get-config", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getReportDispatchConfig();
  });

  ipcMain.handle(
    "desktop:report-dispatch-save-config",
    (
      _event,
      patch: {
        enabled?: boolean;
        sendHour?: number;
        daily?: boolean;
        weekly?: boolean;
        monthly?: boolean;
      }
    ) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.saveReportDispatchConfig(patch);
    }
  );

  ipcMain.handle("desktop:report-dispatch-send-now", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.sendReportsNow(renderHtmlToPdf);
  });

  ipcMain.handle("desktop:list-report-recipients", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listReportRecipients();
  });

  ipcMain.handle(
    "desktop:create-report-recipient",
    (
      _event,
      input: {
        email?: string | null;
        whatsappPhone?: string | null;
        sendEmail?: boolean;
        sendWhatsapp?: boolean;
        scheduleFrequency?: string;
        scheduleTime?: string;
        reportTypes?: string;
        sendFinancial?: boolean;
        financialScheduleTime?: string | null;
        displayName?: string | null;
        isActive?: boolean;
      }
    ) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.createReportRecipient({
        email: input.email,
        whatsappPhone: input.whatsappPhone,
        sendEmail: input.sendEmail,
        sendWhatsapp: input.sendWhatsapp,
        scheduleFrequency: input.scheduleFrequency as "daily" | "weekly" | "monthly" | undefined,
        scheduleTime: input.scheduleTime,
        reportTypes: input.reportTypes as "sales" | "trucks" | "both" | undefined,
        sendFinancial: input.sendFinancial,
        financialScheduleTime: input.financialScheduleTime,
        displayName: input.displayName,
        isActive: input.isActive
      });
    }
  );

  ipcMain.handle(
    "desktop:update-report-recipient",
    (
      _event,
      id: string,
      input: {
        email?: string | null;
        whatsappPhone?: string | null;
        sendEmail?: boolean;
        sendWhatsapp?: boolean;
        scheduleFrequency?: string;
        scheduleTime?: string;
        reportTypes?: string;
        sendFinancial?: boolean;
        financialScheduleTime?: string | null;
        displayName?: string | null;
        isActive?: boolean;
      }
    ) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.updateReportRecipient(id, {
        email: input.email,
        whatsappPhone: input.whatsappPhone,
        sendEmail: input.sendEmail,
        sendWhatsapp: input.sendWhatsapp,
        scheduleFrequency: input.scheduleFrequency as "daily" | "weekly" | "monthly" | undefined,
        scheduleTime: input.scheduleTime,
        reportTypes: input.reportTypes as "sales" | "trucks" | "both" | undefined,
        sendFinancial: input.sendFinancial,
        financialScheduleTime: input.financialScheduleTime,
        displayName: input.displayName,
        isActive: input.isActive
      });
    }
  );

  ipcMain.handle("desktop:delete-report-recipient", (_event, id: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    runtime.deleteReportRecipient(id);
  });

  ipcMain.handle("desktop:send-test-email", async (_event, to: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.sendTestEmail(to);
  });

  ipcMain.handle("desktop:send-daily-report-email", async (_event, email: string, date: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.sendDailyReportEmail(email, date);
  });

  ipcMain.handle(
    "desktop:send-range-report-email",
    async (_event, email: string, startDate: string, endDate: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.sendRangeReportEmail(email, startDate, endDate);
    }
  );

  ipcMain.handle("desktop:verify-smtp-config", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.verifySmtpConfig();
  });

  ipcMain.handle("desktop:report-channels-get", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getReportChannelSettings();
  });

  ipcMain.handle(
    "desktop:report-channels-save",
    async (_event, input: Record<string, unknown>) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.saveReportChannelSettings(input);
    }
  );

  ipcMain.handle("desktop:whatsapp-connect", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.whatsappConnect();
  });

  ipcMain.handle("desktop:whatsapp-status", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.whatsappStatus();
  });

  ipcMain.handle("desktop:whatsapp-disconnect", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.whatsappDisconnect();
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

  ipcMain.handle("desktop:product-default-prices-list", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listProductDefaultPrices();
  });

  ipcMain.handle(
    "desktop:product-default-prices-upsert",
    (_event, input: { productId: string; unitPriceCents: number; unit?: string }) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.upsertProductDefaultPrice(input);
    }
  );

  ipcMain.handle("desktop:product-default-prices-remove", (_event, productId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    runtime.removeProductDefaultPrice(productId);
  });

  ipcMain.handle("desktop:customer-special-prices-list", (_event, customerId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listCustomerSpecialPrices(customerId);
  });

  ipcMain.handle(
    "desktop:customer-special-prices-set",
    (
      _event,
      input: { customerId: string; productId: string; unitPriceCents: number; unit?: string }
    ) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.setCustomerSpecialPrice(input);
    }
  );

  ipcMain.handle(
    "desktop:customer-special-prices-remove",
    (_event, customerId: string, productId: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      runtime.removeCustomerSpecialPrice(customerId, productId);
    }
  );

  ipcMain.handle("desktop:customer-credit-balance", (_event, customerId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getCustomerCreditBalance(customerId);
  });

  ipcMain.handle(
    "desktop:customer-credit-movements",
    (_event, customerId: string, limit?: number) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.listCustomerCreditMovements(customerId, limit);
    }
  );

  ipcMain.handle(
    "desktop:quotations-create",
    (_event, input: Omit<CreateQuotationInput, "companyId">) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.createQuotation(input);
    }
  );

  ipcMain.handle("desktop:quotations-cancel", (_event, id: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    runtime.cancelQuotation(id);
  });

  ipcMain.handle("desktop:quotations-list-open-for-customer", (_event, customerId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listOpenQuotationsForCustomer(customerId);
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

  ipcMain.handle(
    "desktop:customers-update",
    (
      _event,
      id: string,
      input: UpdateCustomerInput,
      options?: { overrideOmieFields?: boolean }
    ) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }

      return runtime.updateCustomer(id, input, options);
    }
  );

  ipcMain.handle("desktop:get-default-nfe-email", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getDefaultNfeEmail();
  });

  ipcMain.handle("desktop:set-default-nfe-email", (_event, email: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.setDefaultNfeEmail(email);
  });

  ipcMain.handle("desktop:apply-default-nfe-email-to-all", (_event, email: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.applyDefaultNfeEmailToAll(email);
  });

  ipcMain.handle("desktop:enrich-all-customers-cnpj", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.enrichAllCustomersFromCnpj();
  });

  ipcMain.handle("desktop:enrich-all-carriers-cnpj", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.enrichAllCarriersFromCnpj();
  });

  ipcMain.handle("desktop:customers-delete", (_event, id: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    runtime.deleteCustomer(id);
  });

  // Meios de pagamento e contas vem do OMIE (sincronizacao) — nao ha handlers de
  // criacao/exclusao no desktop, apenas atualizacao restrita.
  ipcMain.handle(
    "desktop:payment-methods-update",
    (_event, id: string, input: UpdatePaymentMethodInput) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.updatePaymentMethod(id, input);
    }
  );

  ipcMain.handle("desktop:accounts-list", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listAccounts();
  });

  ipcMain.handle("desktop:accounts-update", (_event, id: string, input: UpdateAccountInput) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.updateAccount(id, input);
  });

  ipcMain.handle(
    "desktop:payment-terms-create",
    (_event, input: Omit<CreatePaymentTermInput, "companyId">) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.createPaymentTerm(input);
    }
  );

  ipcMain.handle(
    "desktop:payment-terms-update",
    (_event, id: string, input: UpdatePaymentTermInput) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.updatePaymentTerm(id, input);
    }
  );

  ipcMain.handle("desktop:payment-terms-delete", (_event, id: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    runtime.deletePaymentTerm(id);
  });

  ipcMain.handle("desktop:payment-terms-list-omie", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listOmiePaymentTerms();
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

  ipcMain.handle(
    "desktop:link-customer-carrier",
    (_event, customerId: string, carrierId: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.linkCustomerCarrier(customerId, carrierId);
    }
  );

  ipcMain.handle(
    "desktop:unlink-customer-carrier",
    (_event, customerId: string, carrierId: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.unlinkCustomerCarrier(customerId, carrierId);
    }
  );

  ipcMain.handle("desktop:list-carriers-by-customer", (_event, customerId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listCarriersByCustomer(customerId);
  });

  ipcMain.handle("desktop:list-customers-by-carrier", (_event, carrierId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listCustomersByCarrier(carrierId);
  });

  ipcMain.handle("desktop:link-driver-carrier", (_event, driverId: string, carrierId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.linkDriverCarrier(driverId, carrierId);
  });

  ipcMain.handle("desktop:unlink-driver-carrier", (_event, driverId: string, carrierId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.unlinkDriverCarrier(driverId, carrierId);
  });

  ipcMain.handle("desktop:list-carriers-by-driver", (_event, driverId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listCarriersByDriver(driverId);
  });

  ipcMain.handle("desktop:list-drivers-by-carrier", (_event, carrierId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listDriversByCarrier(carrierId);
  });

  ipcMain.handle("desktop:list-independent-drivers", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listIndependentDrivers();
  });

  ipcMain.handle("desktop:verify-price-password", (_event, password: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.verifyPriceChangePassword(password);
  });

  ipcMain.handle("desktop:get-omie-status", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getOmieSyncStatus();
  });

  ipcMain.handle("desktop:scale-connect", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    // Conecta usando a configuracao salva (TCP, serial COM/USB ou virtual)
    await runtime.connectScale();
    // Register live stream forwarding to renderer
    runtime.onScaleReading((reading) => {
      mainWindow?.webContents.send("desktop:scale-reading", reading);
    });
  });

  ipcMain.handle("desktop:scale-list-serial-ports", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listScaleSerialPorts();
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

  ipcMain.handle("desktop:scale-capture-stable", async (_event, options: unknown) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    const input = options as { operationType?: "entry" | "exit"; timeoutMs?: number } | undefined;
    return runtime.captureStableScaleWeight({
      operationType: input?.operationType === "exit" ? "exit" : "entry",
      timeoutMs: input?.timeoutMs
    });
  });

  ipcMain.handle("desktop:scale-discover", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.discoverScale();
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

  ipcMain.handle("desktop:virtual-scale-set-weight", (_event, weightKg: number) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.virtualScaleSetWeight(weightKg);
  });

  ipcMain.handle("desktop:virtual-scale-connect", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    const config = runtime.getScaleConfiguration();
    if (config.adapterType !== "virtual") {
      throw new Error("Modo virtual nao esta configurado. Altere em Configuracoes > Balanca.");
    }
    await runtime.connectScale();
    runtime.onScaleReading((reading) => {
      mainWindow?.webContents.send("desktop:scale-reading", reading);
    });
  });

  ipcMain.handle("desktop:omie-config", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getOmieConfig();
  });

  ipcMain.handle("desktop:lookup-cep", async (_event, cep: string) => {
    const digits = String(cep ?? "")
      .replace(/\D/g, "")
      .slice(0, 8);
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
      state: String(payload.uf ?? "")
        .trim()
        .toUpperCase()
    };
  });

  ipcMain.handle("desktop:lookup-cnpj", async (_event, cnpj: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.lookupCnpj(cnpj);
  });

  ipcMain.handle("desktop:omie-sync", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.syncOmieAll();
  });

  ipcMain.handle("desktop:omie-queue-list", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listOmieQueue();
  });

  ipcMain.handle("desktop:omie-queue-delete", (_event, jobId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.deleteOmieQueueItem(jobId);
  });

  ipcMain.handle("desktop:omie-queue-send-now", async (_event, jobId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.sendOmieQueueItemNow(jobId);
  });

  ipcMain.handle("desktop:sync-omie-direct", async (_event, appKey: string, appSecret: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.syncOmieDirect(appKey, appSecret);
  });

  ipcMain.handle("desktop:sync-omie-master", async (_event, options: unknown) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.syncOmieMasterData(
      options as {
        mode?: "full" | "incremental";
        triggeredBy?: "manual" | "automatic" | "startup";
        appKey?: string;
        appSecret?: string;
      }
    );
  });

  ipcMain.handle("desktop:get-last-omie-sync-run", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getLastOmieSyncRun();
  });

  ipcMain.handle("desktop:omie-list-document-types", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listOmieDocumentTypes();
  });

  ipcMain.handle("desktop:get-omie-sync-entities", (_event, runId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getOmieSyncEntitiesByRun(runId);
  });

  ipcMain.handle("desktop:omie-data-entry-loop", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.runOmieDataEntryLoop();
  });

  ipcMain.handle("desktop:reset-omie-master", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.resetOmieMasterData();
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
      if (payload.printerType === "network") {
        if (!payload.networkHost) {
          throw new Error("Host da impressora de rede nao configurado.");
        }

        await new NetworkEscPosPrinter({
          host: payload.networkHost,
          port: payload.networkPort ?? 9100
        }).printReceipt(payload);
        return;
      }

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
  const snapshot = payload.snapshot;
  const logo = snapshot.receiptLogo;
  const logoMarkup = logo.dataUrl
    ? `<img src="${escapeHtml(logo.dataUrl)}" alt="Logo" />`
    : `<div class="logo-fallback">${escapeHtml(snapshot.unitName)}</div>`;
  const bodyLines = snapshot.lines.slice(6).join("\n");

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: ${payload.paperWidthMm}mm auto; margin: 4mm; }
      body { margin: 0; font-family: Consolas, "Courier New", monospace; font-size: 11px; color: #000; }
      .receipt { width: 100%; }
      .top-company { font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .rule { border-top: 1px solid #000; margin: 4px 0 8px; }
      .header { text-align: center; }
      .logo-slot { width: ${logo.widthMm}mm; height: ${logo.heightMm}mm; margin: 0 auto 4px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .logo-slot img { max-width: 100%; max-height: 100%; object-fit: ${logo.fit}; }
      .logo-fallback { font-size: 18px; font-weight: 800; text-align: center; line-height: 1.05; }
      .datetime { text-align: center; font-size: 14px; font-weight: 700; line-height: 1.35; }
      .copy { margin: 8px 0 2px; text-align: center; font-size: 17px; font-weight: 900; letter-spacing: 0.04em; }
      .via { text-align: center; font-weight: 800; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font: inherit; line-height: 1.28; }
    </style>
  </head>
  <body>
    <div class="receipt">
      <div class="top-company">${escapeHtml(snapshot.companyName)}</div>
      <div class="rule"></div>
      <div class="header">
        <div class="logo-slot">${logoMarkup}</div>
        <div class="datetime">
          <div>DATA: ${escapeHtml(formatReceiptDate(snapshot.printedAt))}</div>
          <div>HORA: ${escapeHtml(formatReceiptTime(snapshot.printedAt))}</div>
        </div>
      </div>
      <div class="copy">COPIA NRO ${snapshot.receiptNumber.toString().padStart(9, "0")}</div>
      <div class="via">${snapshot.copyNumber > 1 ? `${snapshot.copyNumber}a VIA` : "1a VIA"}</div>
      <pre>${escapeHtml(bodyLines)}</pre>
    </div>
  </body>
</html>`;
}

function formatReceiptDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function formatReceiptTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
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
  // Atualizacao automatica: assim que uma versao nova e detectada, o app baixa
  // em segundo plano e instala na proxima vez que o operador fechar o app. Nao
  // interrompe a operacao em andamento. O operador ainda pode forcar o download
  // e a reinstalacao pelos botoes de update.
  autoUpdater.autoDownload = AUTO_DOWNLOAD_UPDATES;
  autoUpdater.autoInstallOnAppQuit = AUTO_INSTALL_ON_QUIT;

  // Repo privado no GitHub Releases: o electron-updater usa GH_TOKEN para ler e
  // baixar os assets do release. O token (somente leitura) e embutido no build
  // pelo CI; em dev fica vazio e o updater nem roda (so quando app.isPackaged).
  if (GITHUB_UPDATER_TOKEN) {
    process.env.GH_TOKEN = GITHUB_UPDATER_TOKEN;
  }

  autoUpdater.on("update-available", (info) => {
    // autoDownload esta ligado, entao o download comeca automaticamente aqui.
    updateState = { status: "downloading", availableVersion: info.version, errorMessage: null };
    mainWindow?.webContents.send("desktop:update-available", info.version);
  });
  autoUpdater.on("update-not-available", () => {
    updateState = createInitialUpdateState();
  });
  autoUpdater.on("download-progress", (progress) => {
    if (updateState.status !== "downloaded") {
      updateState = {
        status: "downloading",
        availableVersion: updateState.availableVersion,
        errorMessage: null
      };
    }
    mainWindow?.webContents.send("desktop:update-download-progress", progress.percent);
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateState = { status: "downloaded", availableVersion: info.version, errorMessage: null };
    mainWindow?.webContents.send("desktop:update-downloaded", info.version);
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

// Agendador dos envios automaticos de relatorios (config na tela de Relatorios):
// checa a cada 5 minutos se algum pacote (diario/semanal/mensal) venceu e envia
// com os PDFs/Excel anexados. O tick e serializado para nunca sobrepor envios.
const REPORT_DISPATCH_TICK_MS = 5 * 60 * 1000;
let reportDispatchRunning = false;

function startReportDispatchScheduler(): void {
  const tick = async (): Promise<void> => {
    if (!runtime || reportDispatchRunning) return;
    reportDispatchRunning = true;
    try {
      const result = await runtime.runReportDispatchTick(renderHtmlToPdf);
      if (result) {
        writeStartupLog("reportDispatch:sent", result);
      }
    } catch (error) {
      writeStartupLog("reportDispatch:error", error);
    } finally {
      reportDispatchRunning = false;
    }
  };
  // Primeiro tick 1 minuto apos abrir (recupera envios perdidos com o app fechado).
  setTimeout(() => void tick(), 60 * 1000);
  setInterval(() => void tick(), REPORT_DISPATCH_TICK_MS);
}

// Renderiza um HTML de relatorio em uma janela oculta e exporta como PDF A4.
async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmpFile = path.join(os.tmpdir(), `kyberrock-report-${Date.now()}.html`);
  await fs.writeFile(tmpFile, html, "utf8");
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadFile(tmpFile);
    return await win.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    });
  } finally {
    win.destroy();
    await fs.unlink(tmpFile).catch(() => {});
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
