import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } from "electron";
import type * as ElectronUpdater from "electron-updater";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

import { isDesktopDataAccessError } from "../database/data-access.js";
import { DesktopRuntime, type FiscalDocumentPrinter } from "../services/runtime.js";
import type { ActivateDesktopInput } from "../services/desktop-activation.js";
import type { CacheQueryOptions } from "../services/cache-store.js";
import type { CreateCustomerInput, UpdateCustomerInput } from "../services/customers.js";
import type { UpdatePaymentMethodInput } from "../services/payment-methods.js";
import type { SettleWalletInput, WalletQuery } from "../services/wallet.js";
import type { UpdateAccountInput } from "../services/accounts.js";
import type { CreatePaymentTermInput, UpdatePaymentTermInput } from "../services/payment-terms.js";
import type {
  AddPriceTableItemInput,
  CreatePriceTableInput,
  LinkCustomerToPriceTableInput,
  UpdatePriceTableItemInput
} from "../services/price-tables.js";
import type { CreateVehicleInput, UpdateVehicleInput } from "../services/vehicles.js";
import type { CreateDriverInput, UpdateDriverInput } from "../services/drivers.js";
import type { CreateCarrierInput, UpdateCarrierInput } from "../services/carriers.js";
import { isFreightModality } from "../services/freight.js";
import type { ScaleConfigurationInput } from "../services/scale-configs.js";
import type { CreateQuotationInput } from "../services/quotations.js";
import type { DocsAssistantRequest, DocsAssistantResult } from "../services/docs-assistant.js";
import type {
  ConfigureReceiptPrintProfileInput,
  ReceiptLogoConfig,
  ReceiptPrinter,
  WindowsPrinterSummary
} from "../services/printing.js";
import { NetworkEscPosPrinter } from "../services/network-printer.js";
import type { ReceiptLogoRasterizer } from "../services/escpos-receipt.js";
import { WindowsRawEscPosPrinter } from "../services/windows-raw-printer.js";
import {
  isRasterBlank,
  packRasterImage,
  rasterToBgraBitmap,
  type EscPosRasterImage
} from "../services/escpos-encoder.js";
import {
  computeLogoRasterLayout,
  dotsToMm,
  maxLogoWidthDots,
  RECEIPT_PRINTER_DOTS_PER_MM
} from "../services/receipt-logo-raster.js";
import { buildReceiptHtml, type PrintReadyReceiptLogo } from "../services/receipt-html.js";
import {
  AUTO_DOWNLOAD_UPDATES,
  AUTO_INSTALL_ON_QUIT,
  createInitialUpdateState,
  type UpdateState
} from "../services/update-flow.js";
import {
  compareUpdateVersions,
  fetchUpdateCandidates,
  resolveUpdatePlan,
  type UpdatePlan,
  type UpdateRing
} from "../services/update-candidates.js";
import { isCustomerReportVariant } from "../services/customer-report.js";
import { isWeighingBillingSituation } from "../services/weighing-billing-situation.js";
import type { WeighingBillingReportOptions } from "../services/weighing-billing-report.js";
import { isInvoiceClosingCycle } from "../services/invoice-closing-cycle.js";
import { isInvoiceClosingBasis, normalizePlateList } from "../services/invoice-closing.js";
import type { InvoiceClosingOptions } from "../services/invoice-closing.js";
import {
  GITHUB_UPDATER_OWNER,
  GITHUB_UPDATER_REPO,
  GITHUB_UPDATER_TOKEN
} from "./updater-config.js";
import {
  DEFAULT_UPDATE_CHANNEL,
  updaterChannelSettings,
  type DesktopUpdateChannel
} from "../services/update-channel.js";
import type { OperationType } from "../services/weighing-operations.js";

const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater") as typeof ElectronUpdater;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const appIconPath = path.join(currentDirectory, "../../midia/logo.png");
let mainWindow: BrowserWindow | null = null;
let runtime: DesktopRuntime | null = null;
let updateState: UpdateState = createInitialUpdateState();
/**
 * O que a ultima aplicacao de canal decidiu: qual anel o updater esta mirando e
 * quais versoes a balanca de TESTE pode escolher. Fica aqui, e nao dentro do
 * `updateState`, porque os eventos do `electron-updater` recriam o estado e
 * perderiam a escolha no meio do caminho.
 */
let updatePlan: UpdatePlan = { autoRing: "latest", options: [] };
let updateChannelInUse: DesktopUpdateChannel = DEFAULT_UPDATE_CHANNEL;
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos

/**
 * Encaminha as leituras da balanca ao renderer. Uma unica funcao, e nao um closure
 * novo por conexao: o runtime indexa os forwarders pela propria funcao, entao cada
 * conexao registrava mais um e o renderer recebia a mesma leitura N vezes.
 */
function forwardScaleReadingToRenderer(reading: unknown): void {
  mainWindow?.webContents.send("desktop:scale-reading", reading);
}

/** Registra o forwarder do renderer no adaptador ativo (idempotente pelo runtime). */
function attachScaleReadingForwarder(): void {
  runtime?.onScaleReading(forwardScaleReadingToRenderer);
}

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
  runtime.startOmieQueueDrainScheduler();
  writeStartupLog("omieQueueDrainScheduler:started");
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
    writeStartupLog(connected ? "scale:auto-connected" : "scale:auto-connect:failed");
  } catch {
    writeStartupLog("scale:auto-connect:skipped");
  }
  // Fora do `if (connected)` de proposito: quando o indicador ainda nao responde no
  // boot (PC ligado antes da rede), o adaptador reconecta sozinho minutos depois, e
  // antes disso o forwarder nunca chegava a ser registrado — a balanca ficava
  // conectada e o peso ao vivo parado em "-- kg". Registrar aqui e seguro porque
  // `connectScale` ja deixou o adaptador certo ativo, mesmo tendo falhado a conexao,
  // e `onScaleReading` e idempotente.
  attachScaleReadingForwarder();

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
      updateState = updateErrorState("Atualizacoes so funcionam no aplicativo instalado.");
      return updateState;
    }

    updateState = { ...createInitialUpdateState(), status: "checking" };
    try {
      // Tambem aqui, e nao so no ciclo automatico: o operador pode clicar logo
      // depois de o painel mover esta balanca de canal. E e esta chamada que
      // descobre as duas versoes quando a balanca esta no anel de teste.
      const plan = await applyUpdateChannel();
      updateState = await runUpdateCheck(plan.options.length > 1);
    } catch (err) {
      updateState = updateErrorState(
        err instanceof Error ? err.message : "Falha ao verificar atualizacoes."
      );
    }

    return updateState;
  });

  ipcMain.handle("desktop:download-and-install-update", async (_event, requestedRing?: unknown) => {
    if (!app.isPackaged) {
      updateState = updateErrorState("Instalacao de update so funciona no aplicativo instalado.");
      return updateState;
    }

    // Anel escolhido pelo operador na tela (so a balanca de teste escolhe).
    // Trocar o anel obriga a REVERIFICAR: e a verificacao que faz o updater
    // resolver a release do anel pedido, e e ela que o download instala.
    const chosenRing = normalizeRequestedRing(requestedRing);
    if (chosenRing) {
      try {
        aimUpdaterAt(chosenRing);
        updateState = { ...updateState, status: "checking", errorMessage: null };
        updateState = await runUpdateCheck(true);
      } catch (err) {
        updateState = updateErrorState(
          err instanceof Error ? err.message : "Falha ao verificar atualizacoes."
        );
        return updateState;
      }
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
      updateState = updateErrorState(
        err instanceof Error ? err.message : "Falha ao baixar atualizacao."
      );
    }

    return updateState;
  });

  ipcMain.handle("desktop:list-open-weighing-operations", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.listOpenWeighingOperations();
  });

  ipcMain.handle("desktop:customer-last-entry-preferences", (_event, customerId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.getCustomerLastEntryPreferences(customerId);
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

  ipcMain.handle("desktop:operation-omie-issue", (_event, operationId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.getOperationOmieIssue(operationId);
  });

  ipcMain.handle(
    "desktop:customer-omie-readiness",
    (_event, customerId: string, operationType?: "invoice" | "internal") => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }

      return runtime.getCustomerOmieReadiness(customerId, operationType);
    }
  );

  ipcMain.handle("desktop:clear-canceled-weighing-operations", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.clearCanceledWeighingOperations();
  });

  ipcMain.handle(
    "desktop:clear-closed-weighing-operations",
    (_event, options?: { untilDate?: string }) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }

      return runtime.clearClosedWeighingOperations(options ?? {});
    }
  );

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

  ipcMain.handle("desktop:update-weighing-operation", (_event, input: unknown) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.updateWeighingOperation(
      input as Parameters<DesktopRuntime["updateWeighingOperation"]>[0]
    );
  });

  ipcMain.handle("desktop:get-customer-freight-rules", (_event, customerId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }
    return runtime.getCustomerFreightRules(customerId);
  });

  ipcMain.handle(
    "desktop:get-customer-freight-for-product",
    (_event, customerId: string, productId: string, modality?: string | null) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }
      return runtime.getCustomerFreightForProduct(
        customerId,
        productId,
        isFreightModality(modality) ? modality : null
      );
    }
  );

  ipcMain.handle("desktop:get-last-customer-freight-note", (_event, customerId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }
    return runtime.getLastCustomerFreightNote(customerId);
  });

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

  ipcMain.handle("desktop:get-customer-future-billing-invoices", (_event, customerId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }
    return runtime.getCustomerFutureBillingInvoices(customerId);
  });

  ipcMain.handle("desktop:set-customer-future-billing-invoice", (_event, input: unknown) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }
    return runtime.setCustomerFutureBillingInvoice(
      input as Parameters<typeof runtime.setCustomerFutureBillingInvoice>[0]
    );
  });

  ipcMain.handle("desktop:remove-customer-future-billing-invoice", (_event, invoiceId: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }
    return runtime.removeCustomerFutureBillingInvoice(invoiceId);
  });

  ipcMain.handle(
    "desktop:remove-customer-freight-modality",
    (_event, ruleId: string, modality: string) => {
      if (!runtime) {
        throw new Error("Desktop runtime is not ready.");
      }
      if (!isFreightModality(modality)) {
        throw new Error("Tipo de frete invalido.");
      }
      return runtime.removeCustomerFreightModality(ruleId, modality);
    }
  );

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

  ipcMain.handle("desktop:get-active-receipt-profile", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.getActiveReceiptProfile();
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

  ipcMain.handle(
    "desktop:get-truck-control",
    (_event, startDate: string, endDate: string, search?: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.getTruckControlReport(startDate, endDate, search);
    }
  );

  // Exporta o controle de caminhoes em PDF ou Excel com o MESMO recorte da tela: se o
  // operador digitou uma placa (ou parte dela) na busca, o arquivo sai so com os
  // caminhoes que ficaram na lista, e com os totais desse recorte.
  ipcMain.handle(
    "desktop:export-truck-control",
    async (_event, format: string, startDate: string, endDate: string, search?: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      if (format !== "pdf" && format !== "excel") {
        throw new Error("Formato invalido para o controle de caminhoes (use PDF ou Excel).");
      }
      const saved = await saveReportDocuments([
        runtime.buildTruckControlDocument(format, startDate, endDate, search)
      ]);
      return saved ? { path: saved.files[0] } : null;
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

  ipcMain.handle("desktop:list-customer-report-customers", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listCustomerReportOptions();
  });

  ipcMain.handle(
    "desktop:get-customer-report",
    (_event, customerId: string, startDate: string, endDate: string, periodLabel?: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.getCustomerReport(customerId, startDate, endDate, periodLabel);
    }
  );

  // "Conferir notas no OMIE" do relatorio por cliente: so LE o estado la e grava o numero
  // da nota das cargas do periodo. Nao emite nada, entao nao precisa de confirmacao.
  ipcMain.handle(
    "desktop:reconcile-customer-report-notes",
    (_event, customerId: string, startDate: string, endDate: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.reconcileCustomerReportNotes(customerId, startDate, endDate);
    }
  );

  // Exporta o relatorio por cliente nos modelos (simplificado/completo) e formatos
  // (PDF/Excel) escolhidos. Um unico arquivo usa o "salvar como" de sempre; a partir de
  // dois, pede a pasta uma vez so em vez de abrir um dialogo por arquivo.
  ipcMain.handle(
    "desktop:export-customer-report",
    async (
      _event,
      customerId: string,
      startDate: string,
      endDate: string,
      variants: Array<"simplified" | "complete">,
      formats: Array<"pdf" | "excel">,
      periodLabel?: string
    ) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      if (!mainWindow) return null;

      const selectedVariants = (variants ?? []).filter(isCustomerReportVariant);
      const selectedFormats = (formats ?? []).filter(
        (format): format is "pdf" | "excel" => format === "pdf" || format === "excel"
      );
      if (selectedVariants.length === 0) {
        throw new Error("Selecione ao menos um modelo de relatorio (simplificado ou completo).");
      }
      if (selectedFormats.length === 0) {
        throw new Error("Selecione ao menos um formato de arquivo (PDF ou Excel).");
      }

      return saveReportDocuments(
        runtime.buildCustomerReportDocuments(
          customerId,
          startDate,
          endDate,
          selectedVariants,
          selectedFormats,
          periodLabel
        )
      );
    }
  );

  // Resumo comparativo de todos os clientes do periodo (uma linha por cliente).
  ipcMain.handle(
    "desktop:get-customers-overview",
    (_event, startDate: string, endDate: string, periodLabel?: string) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.getCustomersOverview(startDate, endDate, periodLabel);
    }
  );

  ipcMain.handle(
    "desktop:export-customers-overview",
    async (
      _event,
      startDate: string,
      endDate: string,
      formats: Array<"pdf" | "excel">,
      periodLabel?: string
    ) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      if (!mainWindow) return null;

      const selectedFormats = (formats ?? []).filter(
        (format): format is "pdf" | "excel" => format === "pdf" || format === "excel"
      );
      if (selectedFormats.length === 0) {
        throw new Error("Selecione ao menos um formato de arquivo (PDF ou Excel).");
      }

      return saveReportDocuments(
        runtime.buildCustomersOverviewDocuments(startDate, endDate, selectedFormats, periodLabel)
      );
    }
  );

  // Conferencia de faturamento: a lista pesagem a pesagem do periodo com a situacao de
  // cada uma no OMIE.
  ipcMain.handle(
    "desktop:get-weighing-billing-report",
    (_event, startDate: string, endDate: string, options?: unknown) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.getWeighingBillingReport(
        startDate,
        endDate,
        sanitizeWeighingBillingOptions(options)
      );
    }
  );

  ipcMain.handle(
    "desktop:export-weighing-billing-report",
    async (
      _event,
      startDate: string,
      endDate: string,
      formats: Array<"pdf" | "excel">,
      options?: unknown
    ) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      if (!mainWindow) return null;

      const selectedFormats = (formats ?? []).filter(
        (format): format is "pdf" | "excel" => format === "pdf" || format === "excel"
      );
      if (selectedFormats.length === 0) {
        throw new Error("Selecione ao menos um formato de arquivo (PDF ou Excel).");
      }

      return saveReportDocuments(
        runtime.buildWeighingBillingReportDocuments(
          startDate,
          endDate,
          selectedFormats,
          sanitizeWeighingBillingOptions(options)
        )
      );
    }
  );

  // Fechamento de faturas: a fatura de todos os clientes de um ciclo, de uma vez.
  ipcMain.handle(
    "desktop:get-invoice-closing",
    (_event, startDate: string, endDate: string, options?: unknown) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.getInvoiceClosing(startDate, endDate, sanitizeInvoiceClosingOptions(options));
    }
  );

  // Quantas pesagens do periodo o fechamento mandaria ao OMIE — a contagem que a tela
  // mostra na confirmacao, ANTES de emitir nota nenhuma.
  ipcMain.handle(
    "desktop:preview-invoice-closing-run",
    (_event, startDate: string, endDate: string, options?: unknown) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.previewInvoiceClosingRun(
        startDate,
        endDate,
        sanitizeInvoiceClosingOptions(options)
      );
    }
  );

  // Numero da nota das cargas que estao na tela: so LE o estado no OMIE. Nao fatura, nao
  // emite e nao muda documento nenhum — por isso a tela chama sozinha, sem confirmacao.
  ipcMain.handle("desktop:reconcile-omie-invoice-numbers", (_event, operationIds: unknown) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.reconcileOmieInvoiceNumbers(sanitizeOperationIdList(operationIds));
  });

  // "Cancelar as pesagens repetidas": cancela a carga registrada duas vezes. Mexe em
  // operacao concluida, entao a tela confirma com o operador antes de chegar aqui.
  ipcMain.handle(
    "desktop:cancel-invoice-closing-duplicates",
    (_event, startDate: string, endDate: string, options?: unknown) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.cancelInvoiceClosingDuplicates(
        startDate,
        endDate,
        sanitizeInvoiceClosingOptions(options)
      );
    }
  );

  // "Fazer fechamento": fatura no OMIE as pesagens do periodo. Emite nota fiscal — a tela
  // confirma com o operador antes de chegar aqui.
  ipcMain.handle(
    "desktop:run-invoice-closing",
    (_event, startDate: string, endDate: string, options?: unknown) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.runInvoiceClosing(
        startDate,
        endDate,
        sanitizeInvoiceClosingOptions(options),
        (progress) => mainWindow?.webContents.send("desktop:invoice-closing-progress", progress)
      );
    }
  );

  ipcMain.handle(
    "desktop:export-invoice-closing",
    async (
      _event,
      startDate: string,
      endDate: string,
      formats: Array<"pdf" | "excel">,
      options?: unknown
    ) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      if (!mainWindow) return null;

      const selectedFormats = (formats ?? []).filter(
        (format): format is "pdf" | "excel" => format === "pdf" || format === "excel"
      );
      if (selectedFormats.length === 0) {
        throw new Error("Selecione ao menos um formato de arquivo (PDF ou Excel).");
      }

      return saveReportDocuments(
        runtime.buildInvoiceClosingDocuments(
          startDate,
          endDate,
          selectedFormats,
          sanitizeInvoiceClosingOptions(options)
        )
      );
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

  ipcMain.handle("desktop:send-financial-report-now", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.sendFinancialReportNow();
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

  ipcMain.handle("desktop:report-channels-save", async (_event, input: Record<string, unknown>) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.saveReportChannelSettings(input);
  });

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

  ipcMain.handle("desktop:whatsapp-connection-link-get", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.whatsappConnectionLink();
  });

  ipcMain.handle("desktop:whatsapp-connection-link-create", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.whatsappCreateConnectionLink();
  });

  ipcMain.handle("desktop:whatsapp-connection-link-revoke", async () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.whatsappRevokeConnectionLink();
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

  // Papel desta balanca no cadastro de preco: a tela precisa saber antes de oferecer um
  // formulario que o backend vai recusar (ver `assertPriceAuthority` no runtime).
  ipcMain.handle("desktop:price-authority-get", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getPriceAuthority();
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

  ipcMain.handle("desktop:omie-categories-list", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.listOmieCategories();
  });

  ipcMain.handle(
    "desktop:product-omie-category-set",
    (_event, productId: string, categoryCode: string | null) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      runtime.setProductOmieCategory(productId, categoryCode);
    }
  );

  ipcMain.handle("desktop:omie-default-category-get", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getDefaultOmieCategory();
  });

  ipcMain.handle("desktop:omie-default-category-set", (_event, categoryCode: string | null) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.setDefaultOmieCategory(categoryCode);
  });

  ipcMain.handle("desktop:customer-credit-balance", (_event, customerId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getCustomerCreditBalance(customerId);
  });

  ipcMain.handle("desktop:customer-credit-summary", (_event, customerId: string) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getCustomerCreditSummary(customerId);
  });

  ipcMain.handle(
    "desktop:customer-credit-movements",
    (_event, customerId: string, limit?: number) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.listCustomerCreditMovements(customerId, limit);
    }
  );

  ipcMain.handle(
    "desktop:customer-credit-sync-advances",
    (_event, options?: { fullRescan?: boolean }) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.syncCustomerAdvancesFromOmie(options ?? {});
    }
  );

  ipcMain.handle("desktop:omie-advance-config-get", () => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getOmieAdvanceConfig();
  });

  ipcMain.handle(
    "desktop:omie-advance-config-set",
    (
      _event,
      patch: { categoryCodes?: string[]; accountCode?: number | null; accountName?: string | null }
    ) => {
      if (!runtime) throw new Error("Desktop runtime is not ready.");
      return runtime.setOmieAdvanceConfig(patch ?? {});
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

  ipcMain.handle("desktop:customers-list-deleted", () => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    return runtime.listDeletedCustomers();
  });

  ipcMain.handle("desktop:customers-restore", (_event, id: string) => {
    if (!runtime) {
      throw new Error("Desktop runtime is not ready.");
    }

    runtime.restoreCustomer(id);
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

  // Carteira: vendas em carteira e o fechamento que define a forma de recebimento.
  ipcMain.handle("desktop:wallet-report", (_event, query: WalletQuery) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.getWalletReport(query ?? {});
  });

  ipcMain.handle("desktop:wallet-settle", (_event, input: SettleWalletInput) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.settleWalletOperations(input);
  });

  ipcMain.handle("desktop:wallet-reopen", (_event, operationIds: string[]) => {
    if (!runtime) throw new Error("Desktop runtime is not ready.");
    return runtime.reopenWalletOperations(operationIds);
  });

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
    attachScaleReadingForwarder();
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
    const input = options as
      | { operationType?: "entry" | "exit"; timeoutMs?: number; operationId?: unknown }
      | undefined;
    return runtime.captureStableScaleWeight({
      operationType: input?.operationType === "exit" ? "exit" : "entry",
      timeoutMs: input?.timeoutMs,
      operationId: typeof input?.operationId === "string" ? input.operationId : undefined
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
    attachScaleReadingForwarder();
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

  // Chat da documentacao. Nunca lanca: sem runtime pronto ou sem nuvem, o
  // renderer usa a resposta montada com a documentacao local.
  ipcMain.handle("desktop:docs-assistant-ask", async (_event, request: DocsAssistantRequest) => {
    if (!runtime) {
      return {
        available: false,
        answer: "",
        answerSource: "desconhecido",
        sources: [],
        reason: "Desktop runtime is not ready."
      } satisfies DocsAssistantResult;
    }
    return runtime.askDocsAssistant(request);
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
          port: payload.networkPort ?? 9100,
          rasterizeLogo: rasterizeReceiptLogo
        }).printReceipt(payload);
        return;
      }

      // Termica ligada no Windows: os mesmos bytes ESC/POS da impressora de rede, entregues
      // na fila do Windows em modo RAW. Nada aqui passa pelo desenho do driver, entao o
      // cabecalho do cupom (logo, COD, COPIA NRO) chega ao papel do jeito que foi montado.
      if (payload.printerType === "windows_escpos") {
        await new WindowsRawEscPosPrinter({
          sendRaw: sendRawToWindowsPrinter,
          rasterizeLogo: rasterizeReceiptLogo
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
      // O cupom vai para um arquivo temporario em vez de uma data: URL: uma logo grande
      // estourava o limite de tamanho de URL do Chromium e derrubava a pagina inteira.
      const htmlPath = path.join(app.getPath("temp"), `kyberrock-cupom-${randomUUID()}.html`);

      // A logo vai para o HTML ja rasterizada em preto e branco, no tamanho exato do papel:
      // e a mesma imagem enviada a impressora de rede. Assim o driver do Windows nao precisa
      // converter tons de cinza em pontos (conversao que apagava logos claras) nem lidar com
      // o formato original do arquivo.
      const preparedLogo = prepareReceiptLogo(
        payload.snapshot.receiptLogo,
        maxLogoWidthDots(payload.paperWidthMm)
      );

      try {
        writeFileSync(htmlPath, buildReceiptHtml(payload, preparedLogo?.html), "utf8");
        await printWindow.loadFile(htmlPath);
        await waitForReceiptImages(printWindow);
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
        rmSync(htmlPath, { force: true });
      }
    }
  };
}

/**
 * Teto de espera pelo Windows aceitar o cupom na fila. E so a ENTREGA na fila: a impressao em
 * si continua depois, e o operador nao fica preso numa impressora desligada.
 */
const RAW_SPOOL_TIMEOUT_MS = 20_000;

/**
 * Coloca bytes crus na fila de impressao do Windows (datatype "RAW"), que e como uma termica
 * de cupom espera receber ESC/POS. O caminho grafico (HTML + driver) continua existindo para
 * impressora comum; este aqui e o da termica.
 *
 * A entrega usa a API de spooler do proprio Windows (`winspool.drv`) por PowerShell, e nao um
 * modulo nativo: `better-sqlite3` ja mostra o custo de manter binario compilado casado com a
 * versao do Electron, e uma impressora nao justifica um segundo. O script e ESTATICO — o nome
 * da impressora e o arquivo entram como PARAMETROS, nunca concatenados no texto do script, para
 * um nome de impressora com aspas nao virar comando.
 */
const RAW_SPOOL_SCRIPT = `param(
  [Parameter(Mandatory = $true)][string] $PrinterName,
  [Parameter(Mandatory = $true)][string] $Path,
  [Parameter(Mandatory = $true)][string] $DocumentName
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class KyberRockRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool OpenPrinterW(string printerName, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool StartDocPrinterW(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);

  private static Exception Fail(string step) {
    return new Exception(step + " falhou (codigo " + Marshal.GetLastWin32Error() + ").");
  }

  public static void Send(string printerName, string path, string documentName) {
    byte[] payload = File.ReadAllBytes(path);
    IntPtr printer;

    if (!OpenPrinterW(printerName, out printer, IntPtr.Zero)) {
      throw Fail("Abrir a impressora '" + printerName + "'");
    }

    try {
      DocInfo info = new DocInfo();
      info.pDocName = documentName;
      info.pDataType = "RAW";

      if (!StartDocPrinterW(printer, 1, info)) { throw Fail("Iniciar o documento"); }

      try {
        if (!StartPagePrinter(printer)) { throw Fail("Iniciar a pagina"); }

        IntPtr buffer = Marshal.AllocCoTaskMem(payload.Length);
        try {
          Marshal.Copy(payload, 0, buffer, payload.Length);
          int written;
          if (!WritePrinter(printer, buffer, payload.Length, out written)) { throw Fail("Enviar os dados"); }
          if (written != payload.Length) {
            throw new Exception("A impressora aceitou " + written + " de " + payload.Length + " bytes.");
          }
        } finally {
          Marshal.FreeCoTaskMem(buffer);
        }

        EndPagePrinter(printer);
      } finally {
        EndDocPrinter(printer);
      }
    } finally {
      ClosePrinter(printer);
    }
  }
}
'@
[KyberRockRawPrinter]::Send($PrinterName, $Path, $DocumentName)
`;

/**
 * Marca de ordem de bytes no topo do `.ps1`. Sem ela o Windows PowerShell 5.1 le o arquivo
 * como ANSI e corrompe qualquer acento das mensagens de erro do script.
 */
const UTF8_BOM = "\uFEFF";

async function sendRawToWindowsPrinter(
  printerName: string,
  data: Buffer,
  documentName: string
): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("A impressao ESC/POS direta so esta disponivel no Windows.");
  }

  const stamp = randomUUID();
  const dataPath = path.join(app.getPath("temp"), `kyberrock-cupom-${stamp}.bin`);
  const scriptPath = path.join(app.getPath("temp"), `kyberrock-raw-${stamp}.ps1`);

  try {
    writeFileSync(dataPath, data);
    // BOM: sem ele o PowerShell 5.1 le o script como ANSI e estraga qualquer acento.
    writeFileSync(scriptPath, `${UTF8_BOM}${RAW_SPOOL_SCRIPT}`, "utf8");

    await new Promise<void>((resolve, reject) => {
      execFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
          "-PrinterName",
          printerName,
          "-Path",
          dataPath,
          "-DocumentName",
          documentName
        ],
        { timeout: RAW_SPOOL_TIMEOUT_MS, windowsHide: true },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve();
            return;
          }

          const detail = String(stderr || error.message)
            .replace(/\s+/g, " ")
            .trim();
          writeStartupLog("receipt-print:raw-spool-failed", { printerName, detail });
          reject(new Error(`Nao foi possivel enviar o cupom para "${printerName}": ${detail}`));
        }
      );
    });
  } finally {
    rmSync(dataPath, { force: true });
    rmSync(scriptPath, { force: true });
  }
}

/** Teto de espera pela decodificacao da logo: passou disso, imprime do jeito que estiver. */
const RECEIPT_IMAGE_WAIT_TIMEOUT_MS = 3000;

/**
 * A janela de impressao fica oculta e o `webContents.print` dispara assim que a pagina termina
 * de carregar. Sem esperar a decodificacao das imagens, a logo entrava no PDF de impressao ainda
 * vazia e o cupom saia sem ela.
 *
 * Uma imagem que realmente falhou (`naturalWidth === 0`) primeiro tenta o endereco de reserva
 * (`data-fallback-src`, a logo ORIGINAL do perfil — ver `buildReceiptHtml`): o raster
 * monocromatico vem do `nativeImage` do Electron, um decodificador diferente do Chromium que
 * desenha a previa, e quando ele devolve imagem vazia o cupom saia sem logo nenhuma mesmo com a
 * logo perfeita na tela. So sai do documento a imagem que falhou TAMBEM na reserva, para nao
 * imprimir o icone de imagem quebrada. A espera tem teto: impressao nunca fica pendurada.
 */
async function waitForReceiptImages(printWindow: BrowserWindow): Promise<void> {
  try {
    const report = (await printWindow.webContents.executeJavaScript(
      `(() => {
         const settle = (image) =>
           image.complete
             ? Promise.resolve()
             : new Promise((resolve) => {
                 image.addEventListener("load", resolve, { once: true });
                 image.addEventListener("error", resolve, { once: true });
               });
         const settleAll = (images) =>
           Promise.all(
             images.map((image) => settle(image).then(() => image.decode().catch(() => undefined)))
           );
         const isBroken = (image) => image.complete && image.naturalWidth === 0;
         const withTimeout = (work) =>
           Promise.race([
             work,
             new Promise((resolve) => setTimeout(resolve, ${RECEIPT_IMAGE_WAIT_TIMEOUT_MS}))
           ]);
         const images = Array.from(document.images);
         return withTimeout(settleAll(images)).then(() => {
           // Troca para a logo original antes de desistir dela.
           const recovering = images.filter(
             (image) => isBroken(image) && image.dataset.fallbackSrc
           );
           recovering.forEach((image) => {
             image.style.objectFit = image.dataset.fallbackFit || "contain";
             image.src = image.dataset.fallbackSrc;
             delete image.dataset.fallbackSrc;
           });
           return withTimeout(settleAll(recovering)).then(() => {
             const broken = images.filter(isBroken);
             broken.forEach((image) => image.remove());
             return { total: images.length, recovered: recovering.length, broken: broken.length };
           });
         });
       })()`
    )) as { total: number; recovered: number; broken: number };

    if (report.recovered > 0 || report.broken > 0) {
      writeStartupLog("receipt-print:image-broken", report);
    }
  } catch (error) {
    writeStartupLog("receipt-print:image-wait-failed", error);
  }
}

/**
 * Logo pronta para impressao: o mesmo raster de 1 bit alimenta a impressora de rede
 * (bit image ESC/POS) e o HTML da impressora do Windows.
 */
interface PreparedReceiptLogo {
  raster: EscPosRasterImage;
  /**
   * Imagem de 1 bit para o HTML da impressora do Windows. `null` quando o raster sairia
   * praticamente em branco: nesse caso o HTML volta a usar a imagem ORIGINAL, para o
   * driver do Windows fazer a propria conversao em vez de imprimir um retangulo vazio.
   */
  html: PrintReadyReceiptLogo | null;
  /** Sairia praticamente em branco no papel (logo clara / traco branco). */
  blank: boolean;
}

/**
 * Converte o data URL configurado no preto-e-branco que a impressora termica imprime:
 * decodifica com o Electron, enquadra igual a previa da tela (contain/cover/fill) e
 * converte para 1 bit no tamanho exato em pontos (203 dpi) — com contraste sobre a tinta e
 * pontilhado (ver `buildThermalDotMap`), para logo em cor de marca nao sair em branco.
 *
 * Retorna null quando o Electron nao consegue decodificar a imagem. Isso acontece de verdade:
 * `nativeImage` so le PNG e JPEG, enquanto a previa da tela (Chromium) mostra tambem WebP,
 * GIF, BMP, SVG e AVIF — logo nesses formatos aparecia perfeita na tela e sumia no papel.
 * O upload agora converte tudo para PNG, e este log cobre os perfis salvos antes disso.
 */
function prepareReceiptLogo(
  logo: ReceiptLogoConfig,
  maxWidthDots: number
): PreparedReceiptLogo | null {
  if (!logo.dataUrl) {
    return null;
  }

  const source = nativeImage.createFromDataURL(logo.dataUrl);

  if (source.isEmpty()) {
    writeStartupLog("receipt-print:logo-decode-failed", {
      prefix: logo.dataUrl.slice(0, 32)
    });
    return null;
  }

  const sourceSize = source.getSize();
  const layout = computeLogoRasterLayout(
    sourceSize.width,
    sourceSize.height,
    Math.min(Math.round(logo.widthMm * RECEIPT_PRINTER_DOTS_PER_MM), maxWidthDots),
    Math.round(logo.heightMm * RECEIPT_PRINTER_DOTS_PER_MM),
    logo.fit
  );

  if (!layout) {
    return null;
  }

  let rendered = source.resize({
    width: layout.resizeWidth,
    height: layout.resizeHeight,
    quality: "best"
  });

  if (layout.cropWidth !== layout.resizeWidth || layout.cropHeight !== layout.resizeHeight) {
    rendered = rendered.crop({
      x: layout.cropX,
      y: layout.cropY,
      width: layout.cropWidth,
      height: layout.cropHeight
    });
  }

  const renderedSize = rendered.getSize();
  // `toBitmap()` entrega BGRA premultiplicado; sem avisar, a borda suavizada da logo
  // chegaria escurecida na conversao de 1 bit.
  const raster = packRasterImage(rendered.toBitmap(), renderedSize.width, renderedSize.height, {
    premultiplied: true
  });

  if (!raster) {
    return null;
  }

  const blank = isRasterBlank(raster);

  if (blank) {
    writeStartupLog("receipt-print:logo-blank", {
      widthPx: raster.widthPx,
      heightPx: raster.heightPx
    });
  }

  const monochrome = nativeImage.createFromBitmap(rasterToBgraBitmap(raster), {
    width: raster.widthPx,
    height: raster.heightPx
  });

  return {
    raster,
    html: blank
      ? null
      : {
          dataUrl: monochrome.toDataURL(),
          widthMm: dotsToMm(raster.widthPx),
          heightMm: dotsToMm(raster.heightPx)
        },
    blank
  };
}

/**
 * Impressora de rede: so o bit image ESC/POS interessa — a termica e de 1 bit e nao tem
 * como cair na imagem original, como o HTML faz.
 *
 * Raster que sairia em branco NAO e enviado: a impressora gastaria uma faixa de papel para
 * imprimir nada, e o cupom sairia com um bloco vazio no lugar da logo. Sem imagem, o
 * cabecalho comeca direto no texto — e o motivo fica no log de inicializacao.
 */
const rasterizeReceiptLogo: ReceiptLogoRasterizer = (logo, maxWidthPx) => {
  const prepared = prepareReceiptLogo(logo, maxWidthPx);
  if (!prepared) return null;
  return prepared.blank ? null : prepared.raster;
};

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
    // Com o autoDownload ligado o download ja comecou aqui. Ele fica desligado
    // so na verificacao que vai ABRIR a escolha de versao na balanca de teste:
    // baixar o anel errado enquanto o operador ainda escolhe seria download
    // jogado fora — e, se ele escolhesse o outro, dois downloads concorrentes.
    updateState = describeAvailableUpdate(
      info.version,
      autoUpdater.autoDownload ? "downloading" : "available"
    );
    mainWindow?.webContents.send("desktop:update-available", info.version);
  });
  autoUpdater.on("update-not-available", () => {
    updateState = { ...createInitialUpdateState(), ringOptions: updatePlan.options };
  });
  autoUpdater.on("download-progress", (progress) => {
    if (updateState.status !== "downloaded") {
      updateState = { ...updateState, status: "downloading", errorMessage: null };
    }
    mainWindow?.webContents.send("desktop:update-download-progress", progress.percent);
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateState = describeAvailableUpdate(info.version, "downloaded");
    mainWindow?.webContents.send("desktop:update-downloaded", info.version);
  });
  autoUpdater.on("error", (error) => {
    updateState = updateErrorState(error.message);
  });
}

function updateErrorState(message: string): UpdateState {
  return {
    status: "error",
    availableVersion: null,
    errorMessage: message,
    availableRing: null,
    ringOptions: updatePlan.options
  };
}

/**
 * De qual anel veio a versao que o updater ofereceu.
 *
 * A balanca de producao nao mostra anel nenhum — la so existe um, e nomea-lo em
 * cada aviso seria ruido. Na de teste, a versao que nao bate com nenhuma das
 * opcoes conhecidas cai no anel que a verificacao mirou.
 */
function describeAvailableUpdate(
  version: string,
  status: "available" | "downloading" | "downloaded"
): UpdateState {
  const matched = updatePlan.options.find(
    (option) => compareUpdateVersions(option.version, version) === 0
  );
  return {
    status,
    availableVersion: version,
    errorMessage: null,
    availableRing: updateChannelInUse === "beta" ? (matched?.ring ?? updatePlan.autoRing) : null,
    ringOptions: updatePlan.options
  };
}

function normalizeRequestedRing(value: unknown): UpdateRing | null {
  // So a balanca de teste escolhe versao. Um pedido chegando numa balanca de
  // producao e ignorado de proposito: e la que oferecer versao em avaliacao
  // seria exatamente o que os dois aneis existem para impedir.
  if (updateChannelInUse !== "beta") return null;
  if (value !== "beta" && value !== "latest") return null;
  return value;
}

/**
 * Aponta o updater para um anel especifico, sem mexer no que o canal decide.
 *
 * A escolha **consome** as opcoes: o operador ja decidiu, e deixar as duas
 * versoes penduradas no estado faria a tela continuar pedindo para escolher no
 * meio do download. A verificacao seguinte recalcula tudo do zero.
 */
function aimUpdaterAt(ring: UpdateRing): void {
  updatePlan = { autoRing: ring, options: [] };
  autoUpdater.allowPrerelease = ring === "beta";
  writeStartupLog("updater:ring", { channel: updateChannelInUse, ring });
}

/**
 * Roda a verificacao e traduz o resultado para o estado que a tela le.
 *
 * `withoutAutoDownload` desliga o download automatico so por esta passada (ver
 * o handler de `update-available`).
 *
 * A disponibilidade sai do `isUpdateAvailable`, e nao da mera presenca de
 * `updateInfo`: o `electron-updater` devolve a versao resolvida MESMO quando
 * ela e a que ja esta instalada. Ler so o `updateInfo` fazia a balanca de teste
 * parada na 0.8.200 anunciar "versao 0.8.200 disponivel" e oferecer o botao de
 * instalar a cada verificacao — a versao presa que o operador via na tela.
 */
async function runUpdateCheck(withoutAutoDownload: boolean): Promise<UpdateState> {
  const previousAutoDownload = autoUpdater.autoDownload;
  if (withoutAutoDownload) {
    autoUpdater.autoDownload = false;
  }

  let result: Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>;
  try {
    result = await autoUpdater.checkForUpdates();
  } finally {
    autoUpdater.autoDownload = previousAutoDownload;
  }

  const version = result?.updateInfo?.version ?? null;
  if (!version || !result?.isUpdateAvailable) {
    return { ...createInitialUpdateState(), ringOptions: updatePlan.options };
  }

  // O download desta mesma versao pode ter terminado enquanto a verificacao
  // corria; voltar para "baixando" esconderia o botao de reiniciar e instalar.
  if (updateState.status === "downloaded" && updateState.availableVersion === version) {
    return describeAvailableUpdate(version, "downloaded");
  }

  // "baixando" so quando o autoDownload realmente comecou o download nesta
  // passada; caso contrario a versao esta apenas disponivel, esperando o clique.
  const downloadStarted = previousAutoDownload && !withoutAutoDownload;
  return describeAvailableUpdate(version, downloadStarted ? "downloading" : "available");
}

/**
 * Aponta o `electron-updater` para o anel desta balanca.
 *
 * Roda aqui, e nao no `configureAutoUpdater`, porque o canal vem do SQLite e o
 * `configureAutoUpdater` e chamado no topo do modulo, antes de o runtime (e o
 * banco) existirem. E e reaplicado a cada verificacao: assim, trocar o canal da
 * balanca no painel passa a valer sem reiniciar o app.
 *
 * Mexe em `allowPrerelease` (qual release o updater escolhe) e em
 * `allowDowngrade` (se pode voltar para uma mais velha, o que so o anel de
 * teste pode). `autoUpdater.channel` fica INTOCADO de proposito: num
 * repositorio privado o provider do `electron-updater` ignora esse campo e
 * sempre procura `latest.yml`, e o setter dele ligaria `allowDowngrade` para
 * TODA a frota de brinde. O porque completo esta em
 * `services/update-channel.ts`.
 *
 * No anel de TESTE ele ainda olha os dois aneis antes de escolher o valor de
 * `allowPrerelease` (ver `services/update-candidates.ts`): com ele ligado o
 * updater instala a prerelease mais nova, que pode ser mais VELHA que a
 * producao — foi assim que uma balanca de teste ficou presa na 0.8.200 depois
 * de a 0.8.201 ir para producao. Consulta que falhar volta ao padrao do anel,
 * que e a prerelease.
 */
async function applyUpdateChannel(): Promise<UpdatePlan> {
  try {
    const channel = runtime?.getUpdateChannel() ?? DEFAULT_UPDATE_CHANNEL;
    updateChannelInUse = channel;
    autoUpdater.allowDowngrade = updaterChannelSettings(channel).allowDowngrade;

    const plan = resolveUpdatePlan({
      channel,
      installedVersion: app.getVersion(),
      candidates:
        channel === "beta" ? await readUpdateCandidates() : { test: null, production: null }
    });
    updatePlan = plan;

    const allowPrerelease = plan.autoRing === "beta";
    if (autoUpdater.allowPrerelease !== allowPrerelease) {
      writeStartupLog("updater:channel", { channel, plan });
    }
    autoUpdater.allowPrerelease = allowPrerelease;
    return plan;
  } catch (error) {
    // Nunca impedir a verificacao de atualizacao: sem canal aplicado o updater
    // segue no padrao, que e producao.
    writeStartupLog("updater:channel:error", error);
    return updatePlan;
  }
}

/** Le os dois aneis no GitHub com o mesmo token de leitura que o updater usa. */
async function readUpdateCandidates(): Promise<{ test: string | null; production: string | null }> {
  if (!GITHUB_UPDATER_TOKEN) {
    // Build sem token (dev): o updater tambem nao roda, entao nao ha o que ler.
    return { test: null, production: null };
  }

  return fetchUpdateCandidates({
    owner: GITHUB_UPDATER_OWNER,
    repo: GITHUB_UPDATER_REPO,
    token: GITHUB_UPDATER_TOKEN
  });
}

function startAutomaticUpdateChecks(): void {
  if (!app.isPackaged) {
    return;
  }

  void runAutomaticUpdateCheck();
  setInterval(() => {
    if (updateState.status === "idle" || updateState.status === "error") {
      void runAutomaticUpdateCheck();
    }
  }, UPDATE_CHECK_INTERVAL_MS);
}

/**
 * Ciclo automatico: mira o anel mais novo e deixa o `autoDownload` trabalhar.
 *
 * Ele NAO pergunta nada — a escolha entre teste e producao e um gesto do
 * operador, no botao de verificar. Sozinha, a balanca de teste vai sempre para
 * a versao mais nova dos dois aneis, que e o que a tira de uma versao presa.
 */
async function runAutomaticUpdateCheck(): Promise<void> {
  try {
    await applyUpdateChannel();
    updateState = await runUpdateCheck(false);
  } catch (error) {
    writeStartupLog("updater:check:error", error);
  }
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

/**
 * Grava em disco os documentos ja renderizados de um relatorio. Um unico arquivo usa o
 * "salvar como" de sempre; a partir de dois, pede a pasta uma vez so em vez de abrir um
 * dialogo por arquivo. Devolve `null` quando o operador cancela a escolha do destino.
 */
/**
 * Filtros da conferencia de faturamento vindos do renderer. Chegam pelo IPC como
 * `unknown` e sao reconstruidos campo a campo: o que nao for reconhecido e descartado em
 * vez de descer ate a consulta.
 */
function sanitizeWeighingBillingOptions(options: unknown): WeighingBillingReportOptions {
  if (!options || typeof options !== "object") return {};
  const raw = options as Record<string, unknown>;
  const situations = Array.isArray(raw.situations)
    ? raw.situations.filter(isWeighingBillingSituation)
    : [];
  return {
    customerId: typeof raw.customerId === "string" && raw.customerId ? raw.customerId : null,
    situations,
    search: typeof raw.search === "string" ? raw.search : null,
    periodLabel: typeof raw.periodLabel === "string" ? raw.periodLabel : null
  };
}

/**
 * Filtros do fechamento de faturas vindos do renderer, pela mesma regra da conferencia:
 * campo a campo, e o que nao for reconhecido nao desce ate a consulta.
 */
function sanitizeInvoiceClosingOptions(options: unknown): InvoiceClosingOptions {
  if (!options || typeof options !== "object") return {};
  const raw = options as Record<string, unknown>;
  const cycles = Array.isArray(raw.cycles) ? raw.cycles.filter(isInvoiceClosingCycle) : [];
  const plates = Array.isArray(raw.plates) ? normalizePlateList(raw.plates as string[]) : [];
  return {
    basis: isInvoiceClosingBasis(raw.basis) ? raw.basis : "period",
    periodCycle: isInvoiceClosingCycle(raw.periodCycle) ? raw.periodCycle : null,
    cycles,
    customerId: typeof raw.customerId === "string" && raw.customerId ? raw.customerId : null,
    plates,
    search: typeof raw.search === "string" ? raw.search : null,
    periodLabel: typeof raw.periodLabel === "string" ? raw.periodLabel : null
  };
}

/** Ids de operacao vindos do renderer: so string nao vazia, sem repetido. */
function sanitizeOperationIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

async function saveReportDocuments(
  documents: Array<{ format: "pdf" | "excel"; fileName: string; html: string }>
): Promise<{ files: string[] } | null> {
  if (!mainWindow || documents.length === 0) return null;

  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const writeDocument = async (
    document: (typeof documents)[number],
    filePath: string
  ): Promise<void> => {
    if (document.format === "pdf") {
      await fs.writeFile(filePath, await renderHtmlToPdf(document.html));
      return;
    }
    await fs.writeFile(filePath, document.html, "utf8");
  };

  if (documents.length === 1) {
    const [document] = documents;
    const filePath = await pickReportFilePath(document.fileName, [
      document.format === "pdf" ? "pdf" : "xls"
    ]);
    if (!filePath) return null;
    await writeDocument(document, filePath);
    return { files: [filePath] };
  }

  const folder = await dialog.showOpenDialog(mainWindow, {
    title: "Escolher a pasta dos relatorios",
    properties: ["openDirectory", "createDirectory"]
  });
  if (folder.canceled || folder.filePaths.length === 0) return null;

  const files: string[] = [];
  for (const document of documents) {
    const filePath = path.join(folder.filePaths[0], document.fileName);
    await writeDocument(document, filePath);
    files.push(filePath);
  }
  return { files };
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
  // Falta de permissao na pasta de dados ja vem escrita para o operador, com o
  // comando de reparo: mostrar o stack no lugar dela so esconderia a solucao.
  if (isDesktopDataAccessError(error)) {
    dialog.showErrorBox("KyberRock Desktop", error.message);
    app.quit();
    return;
  }
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
