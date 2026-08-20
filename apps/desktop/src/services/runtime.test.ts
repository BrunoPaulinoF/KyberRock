import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DesktopDatabase } from "../database/sqlite";
import { DesktopRuntime } from "./runtime";
import type { EmailSendInput } from "./email";
import { writeLocalSetting, readLocalSetting } from "./local-settings";
import { createReportRecipient } from "./report-recipients";
import { ensureInitialDesktopIdentity } from "./bootstrap";

describe("DesktopRuntime OMIE status", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports OMIE configured when cloud credentials are present", () => {
    const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-runtime-"));
    tempDirectories.push(baseDirectory);
    const runtime = DesktopRuntime.initialize(baseDirectory);

    try {
      const database = (runtime as unknown as { database: DesktopDatabase }).database;
      writeLocalSetting(database, "cloud_company_id", "company-1");
      writeLocalSetting(database, "cloud_unit_id", "unit-1");
      writeLocalSetting(database, "cloud_device_id", "device-1");
      writeLocalSetting(database, "cloud_device_token", "token-1");
      writeLocalSetting(database, "cloud_configured", true);

      expect(runtime.getOmieSyncStatus()).toMatchObject({
        configured: true,
        hasSyncedData: false,
        totalCustomers: 0,
        totalProducts: 0,
        totalPaymentTerms: 0
      });
    } finally {
      runtime.close();
    }
  });

  it("resets OMIE master data, clearing reference data and sync state", () => {
    const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-runtime-"));
    tempDirectories.push(baseDirectory);
    const runtime = DesktopRuntime.initialize(baseDirectory);

    try {
      const database = (runtime as unknown as { database: DesktopDatabase }).database;

      // Insert test company
      database
        .prepare(
          `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
        VALUES ('company-1', 'Test Co', 'Test', datetime('now'), datetime('now'))`
        )
        .run();

      // Insert local customers
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
        VALUES ('cust-1', 'company-1', 'local', 'Cliente A', 'Cliente A', 1, datetime('now'), datetime('now'))`
        )
        .run();
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
        VALUES ('cust-2', 'company-1', 'local', 'Cliente B', 'Cliente B', 1, datetime('now'), datetime('now'))`
        )
        .run();

      // Insert local carriers
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, name, source, is_active, created_at, updated_at)
        VALUES ('car-1', 'company-1', 'Transportadora A', 'local', 1, datetime('now'), datetime('now'))`
        )
        .run();

      database
        .prepare(
          `INSERT INTO products (id, company_id, omie_product_id, code, description, unit, is_active, created_at, updated_at)
        VALUES ('prod-1', 'company-1', 123, 'P123', 'Produto A', 'UN', 1, datetime('now'), datetime('now'))`
        )
        .run();

      database
        .prepare(
          `INSERT INTO payment_terms (id, company_id, omie_code, name, rules_json, is_active, created_at, updated_at)
        VALUES ('term-1', 'company-1', '30', '30 dias', '{}', 1, datetime('now'), datetime('now'))`
        )
        .run();

      // Insert OMIE sync runs
      database
        .prepare(
          `INSERT INTO omie_sync_runs (id, company_id, started_at, mode, triggered_by, success, created_at, updated_at)
        VALUES ('run-1', 'company-1', datetime('now'), 'full', 'manual', 1, datetime('now'), datetime('now'))`
        )
        .run();

      // Insert sync state
      writeLocalSetting(database, "omie_pull_state", {
        customersPage: 5,
        productsPage: 3,
        paymentTermsPage: 2,
        suppliersPage: 1,
        customersFinished: true,
        productsFinished: true,
        paymentTermsFinished: true,
        suppliersFinished: true,
        inProgress: true
      });
      writeLocalSetting(database, "omie_sync_lock", {
        lockedAt: new Date().toISOString(),
        runId: "run-1"
      });

      // Insert OMIE sync queue jobs
      database
        .prepare(
          `INSERT INTO sync_queue (id, target, action, entity_type, entity_id, idempotency_key, payload_json, status, attempt_count, next_attempt_at, created_at, updated_at)
        VALUES ('job-1', 'omie', 'send_order', 'weighing_operation', 'op-1', 'kyberrock:unit-1:op-1:create_sales_order', '{}', 'pending', 0, datetime('now'), datetime('now'), datetime('now'))`
        )
        .run();

      // Set identity so ensureIdentity picks company-1
      ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "Test Co",
        companyTradeName: "Test",
        unitId: "unit-1",
        unitName: "Unidade",
        deviceId: "device-1",
        deviceName: "Desktop"
      });

      const result = runtime.resetOmieMasterData();

      expect(result.customersCleared).toBe(2);
      expect(result.carriersCleared).toBe(1);
      expect(result.syncRunsCleared).toBe(1);
      expect(result.syncQueueCleared).toBe(1);

      // Verify soft delete
      const activeCustomers = database
        .prepare(
          `SELECT COUNT(*) FROM customers WHERE company_id = 'company-1' AND deleted_at IS NULL`
        )
        .pluck()
        .get() as number;
      const activeCarriers = database
        .prepare(
          `SELECT COUNT(*) FROM carriers WHERE company_id = 'company-1' AND deleted_at IS NULL`
        )
        .pluck()
        .get() as number;
      const activeProducts = database
        .prepare(
          `SELECT COUNT(*) FROM products WHERE company_id = 'company-1' AND deleted_at IS NULL`
        )
        .pluck()
        .get() as number;
      const activePaymentTerms = database
        .prepare(
          `SELECT COUNT(*) FROM payment_terms WHERE company_id = 'company-1' AND deleted_at IS NULL`
        )
        .pluck()
        .get() as number;
      expect(activeCustomers).toBe(0);
      expect(activeCarriers).toBe(0);
      expect(activeProducts).toBe(0);
      expect(activePaymentTerms).toBe(0);

      // Verify sync state cleared
      const pullState = readLocalSetting<Record<string, unknown>>(database, "omie_pull_state");
      const syncLock = readLocalSetting<Record<string, unknown>>(database, "omie_sync_lock");
      expect(pullState).toBeNull();
      expect(syncLock).toBeNull();

      // Verify sync queue cleared
      const queueCount = database
        .prepare(`SELECT COUNT(*) FROM sync_queue WHERE target = 'omie'`)
        .pluck()
        .get() as number;
      expect(queueCount).toBe(0);
    } finally {
      runtime.close();
    }
  });
});

describe("DesktopRuntime customer edits", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("re-arms the blocked closing with the cadastro the operator just corrected", () => {
    const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-runtime-"));
    tempDirectories.push(baseDirectory);
    const runtime = DesktopRuntime.initialize(baseDirectory);

    try {
      const database = (runtime as unknown as { database: DesktopDatabase }).database;
      const now = "2026-06-12T12:00:00.000Z";
      // Razao social que o OMIE recusa (acima de 60 caracteres), como veio do cadastro.
      const razaoLonga = "LOGI TRANSPORTES E LOGISTICA INTEGRADA DO BRASIL LTDA - FILIAL SAO PAULO";

      ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-1",
        deviceName: "PC Balanca"
      });
      // Desktop ativado: sem isto assertDesktopAccess barra qualquer edicao de cadastro.
      writeLocalSetting(database, "cloud_company_id", "company-1");
      writeLocalSetting(database, "cloud_unit_id", "unit-1");
      writeLocalSetting(database, "cloud_device_id", "device-1");
      writeLocalSetting(database, "cloud_device_token", "device-token-1");
      writeLocalSetting(database, "last_license_check_at", new Date().toISOString());

      database
        .prepare(
          `INSERT INTO customers (
            id, company_id, source, legal_name, trade_name, document, email, address_number,
            sync_status, needs_push, created_at, updated_at
          ) VALUES (
            'customer-logi', 'company-1', 'local', ?, 'Logi', '12345678000190',
            'nfe@logi.com.br', '100', 'error', 1, ?, ?
          )`
        )
        .run(razaoLonga, now, now);

      database
        .prepare(
          `INSERT INTO weighing_operations (
            id, company_id, unit_id, device_id, status, operation_type, customer_id,
            entry_weight_kg, exit_weight_kg, net_weight_kg, unit_price_cents,
            product_total_cents, total_cents, exit_weight_captured_at, created_at, updated_at
          ) VALUES (
            'operation-1', 'company-1', 'unit-1', 'device-1', 'closed_local', 'invoice', 'customer-logi',
            20, 10, 10, 2500, 25000, 25000, ?, ?, ?
          )`
        )
        .run(now, now, now);

      // Job montado no fechamento: carrega o SNAPSHOT do cadastro recusado pelo OMIE e
      // fica parado (next_attempt_at no futuro distante) ate alguem corrigir o cliente.
      database
        .prepare(
          `INSERT INTO sync_queue (
            id, target, action, entity_type, entity_id, idempotency_key, payload_json,
            status, attempt_count, next_attempt_at, created_at, updated_at
          ) VALUES (
            'omie-job-logi', 'omie', 'create_order', 'weighing_operation', 'operation-1',
            'kyberrock:unit-1:operation-1:create_sales_order', ?, 'failed', 0,
            '9999-12-31T23:59:59.999Z', ?, ?
          )`
        )
        .run(
          JSON.stringify({
            operationId: "operation-1",
            operationType: "invoice",
            customerOmieId: 0,
            localCustomerId: "customer-logi",
            customer: { localCustomerId: "customer-logi", razaoSocial: razaoLonga }
          }),
          now,
          now
        );

      runtime.updateCustomer(
        "customer-logi",
        { legalName: "LOGI TRANSPORTES LTDA" },
        { overrideOmieFields: true }
      );

      const job = database
        .prepare("SELECT status, next_attempt_at, payload_json FROM sync_queue WHERE id = ?")
        .get("omie-job-logi") as {
        status: string;
        next_attempt_at: string;
        payload_json: string;
      };

      // Sem o re-arm o job seguia parado com o cadastro antigo: a correcao do operador
      // nao mudava nada no que sobe ao OMIE e a recusa se repetia igual.
      expect(job.status).toBe("pending");
      expect(job.next_attempt_at).not.toBe("9999-12-31T23:59:59.999Z");
      expect(JSON.parse(job.payload_json).customer).toMatchObject({
        razaoSocial: "LOGI TRANSPORTES LTDA"
      });
    } finally {
      runtime.close();
    }
  });
});

describe("DesktopRuntime report dispatch attachments", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // O anexo de vendas saia como `.xls` (tabelas HTML): destinatario sem Excel —
  // celular, na maioria — nao conseguia abrir. Todo o pacote vai em PDF.
  it("sends every bundle attachment as PDF", async () => {
    const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-runtime-"));
    tempDirectories.push(baseDirectory);
    const runtime = DesktopRuntime.initialize(baseDirectory);

    try {
      const database = (runtime as unknown as { database: DesktopDatabase }).database;
      ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-1",
        deviceName: "PC Balanca"
      });
      createReportRecipient(database, {
        companyId: "company-1",
        email: "gestor@exemplo.com",
        sendEmail: true,
        sendWhatsapp: false,
        reportTypes: "both"
      });

      const sent: EmailSendInput[] = [];
      runtime.sendReportEmail = async (input: EmailSendInput) => {
        sent.push(input);
        return { success: true };
      };

      // 16/07/2026: dia qualquer no meio do mes, para o acumulado do mes nao
      // coincidir com o pacote diario.
      const result = await runtime.sendReportsNow(
        async (html) => Buffer.from(`pdf:${html.length}`, "utf8"),
        new Date(2026, 6, 16, 19, 0, 0)
      );

      expect(result.emailsSent).toBe(1);
      expect(sent).toHaveLength(1);
      const attachments = sent[0]?.attachments ?? [];
      expect(attachments.map((attachment) => attachment.contentType)).toEqual([
        "application/pdf",
        "application/pdf",
        "application/pdf",
        "application/pdf"
      ]);
      expect(attachments.every((attachment) => attachment.filename.endsWith(".pdf"))).toBe(true);
      expect(attachments.some((attachment) => attachment.filename.startsWith("vendas-"))).toBe(
        true
      );
    } finally {
      runtime.close();
    }
  });

  // Pedido dos destinatarios: o fechamento do dia sozinho nao mostra como o mes
  // esta indo. As vendas do mes corrente vao junto em todo envio.
  it("attaches the current month sales alongside the daily bundle", async () => {
    const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-runtime-"));
    tempDirectories.push(baseDirectory);
    const runtime = DesktopRuntime.initialize(baseDirectory);

    try {
      const database = (runtime as unknown as { database: DesktopDatabase }).database;
      ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-1",
        deviceName: "PC Balanca"
      });
      createReportRecipient(database, {
        companyId: "company-1",
        email: "gestor@exemplo.com",
        sendEmail: true,
        sendWhatsapp: false,
        reportTypes: "sales"
      });

      const sent: EmailSendInput[] = [];
      runtime.sendReportEmail = async (input: EmailSendInput) => {
        sent.push(input);
        return { success: true };
      };

      await runtime.sendReportsNow(
        async (html) => Buffer.from(`pdf:${html.length}`, "utf8"),
        new Date(2026, 6, 16, 19, 0, 0)
      );

      const filenames = (sent[0]?.attachments ?? []).map((attachment) => attachment.filename);
      expect(filenames).toContain("vendas-mes-2026-07.pdf");
      expect(sent[0]?.html).toContain("Vendas do mes 07/2026 (ate 16/07/2026)");
    } finally {
      runtime.close();
    }
  });

  // No dia 1 o pacote diario cobre exatamente a mesma janela do acumulado do
  // mes — o mesmo relatorio nao vai duas vezes.
  it("does not duplicate the sales report on the first day of the month", async () => {
    const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-runtime-"));
    tempDirectories.push(baseDirectory);
    const runtime = DesktopRuntime.initialize(baseDirectory);

    try {
      const database = (runtime as unknown as { database: DesktopDatabase }).database;
      ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-1",
        deviceName: "PC Balanca"
      });
      createReportRecipient(database, {
        companyId: "company-1",
        email: "gestor@exemplo.com",
        sendEmail: true,
        sendWhatsapp: false,
        reportTypes: "sales"
      });

      const sent: EmailSendInput[] = [];
      runtime.sendReportEmail = async (input: EmailSendInput) => {
        sent.push(input);
        return { success: true };
      };

      await runtime.sendReportsNow(
        async (html) => Buffer.from(`pdf:${html.length}`, "utf8"),
        new Date(2026, 7, 1, 19, 0, 0)
      );

      const filenames = (sent[0]?.attachments ?? []).map((attachment) => attachment.filename);
      expect(filenames.filter((filename) => filename.startsWith("vendas-"))).toEqual([
        "vendas-2026-08-01.pdf"
      ]);
    } finally {
      runtime.close();
    }
  });
});
