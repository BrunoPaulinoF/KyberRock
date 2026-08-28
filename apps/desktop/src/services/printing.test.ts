import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { setCustomerFutureBillingInvoice } from "./customer-future-billing";
import {
  closeWeighingOperation,
  createSimulatedWeighingOperation,
  createWeighingOperation
} from "./weighing-operations";
import {
  configureReceiptPrintProfile,
  getActiveReceiptPrintProfile,
  listPrintReceipts,
  printTestReceipt,
  printWeighingReceipt,
  reprintWeighingReceipt,
  type ReceiptPrinter,
  type ReceiptPrintPayload
} from "./printing";

describe("printing", () => {
  it("prints a receipt for a closed operation", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        paperWidthMm: 80
      });
      const operation = createClosedOperation(database, identity);

      const receipt = await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer,
        new Date("2026-06-07T12:00:00.000Z")
      );

      expect(receipt).toMatchObject({
        operationId: operation.id,
        receiptNumber: 1,
        copyNumber: 2,
        printerName: "TERMICA-80",
        status: "printed",
        errorMessage: null
      });
      expect(printer.calls).toHaveLength(2);
      expect(printer.calls[0].lines).toContain("COPIA NRO 000000001");
      expect(printer.calls[1].lines).toContain("2a VIA");
      expect(printer.calls[0].lines).toContain("Cliente: Cliente Teste");
      expect(
        database
          .prepare("SELECT receipt_sequence FROM units WHERE id = ?")
          .pluck()
          .get(identity.unitId)
      ).toBe(1);
      expect(
        database
          .prepare("SELECT action FROM audit_logs WHERE action = 'receipt_printed'")
          .pluck()
          .get()
      ).toBe("receipt_printed");
      expect(
        database
          .prepare("SELECT action FROM sync_queue WHERE entity_type = 'print_receipt'")
          .pluck()
          .get()
      ).toBe("upsert_print_receipt");
    } finally {
      database.close();
    }
  });

  it("prints the internal operation receipt marked as a non-fiscal sale", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        paperWidthMm: 80
      });
      const operation = createClosedOperation(database, identity, "internal");

      await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer,
        new Date("2026-06-07T12:00:00.000Z")
      );

      // Mesmo cupom da venda com nota, com o aviso de que nao vale como documento fiscal.
      const lines = printer.calls[0].lines;
      expect(lines.some((line) => line.includes("VENDA SEM VALOR FISCAL"))).toBe(true);
      expect(lines).toContain("Cliente: Cliente Teste");
      expect(lines.some((line) => line.startsWith("LIQUIDO:"))).toBe(true);
    } finally {
      database.close();
    }
  });

  // Situacao 1 do frete ("O valor do frete aparece na nota e no cupom"): o cupom traz a
  // linha FRETE com o total calculado no fechamento e o VALOR do financeiro ja embutido.
  it("imprime o valor do frete no cupom e soma no total quando o frete vai na nota", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        paperWidthMm: 80
      });
      const operation = createClosedOperationWithFreight(database, identity, "fob");

      await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer,
        new Date("2026-06-07T12:00:00.000Z")
      );

      // 6,5 t x R$ 90,00/t = R$ 585,00 de frete.
      expect(operation.freightTotalCents).toBe(58_500);
      const lines = printer.calls[0].lines;
      expect(lines).toContain("FRETE R$ 585,00");
      expect(lines.some((line) => line.startsWith("VENCTO:") && line.includes("R$ 585,78"))).toBe(
        true
      );
    } finally {
      database.close();
    }
  });

  // Situacao 2 ("valor so no sistema"): o frete continua calculado e gravado, mas nao sai
  // no papel — e o total impresso desconta ele, senao o cupom cobraria um valor sem origem.
  it("nao imprime o frete quando o valor fica so no sistema", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        paperWidthMm: 80
      });
      const operation = createClosedOperationWithFreight(database, identity, "cif");

      await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer,
        new Date("2026-06-07T12:00:00.000Z")
      );

      expect(operation.freightTotalCents).toBe(58_500);
      const lines = printer.calls[0].lines;
      expect(lines.some((line) => line.startsWith("FRETE"))).toBe(false);
      expect(lines.some((line) => line.startsWith("VENCTO:") && line.includes("R$ 0,78"))).toBe(
        true
      );
    } finally {
      database.close();
    }
  });

  // A observacao escrita no campo "Destino/obs." da entrada e recado para quem recebe a
  // carga: sai no papel ate quando o VALOR do frete fica so no sistema.
  it("imprime a observacao do frete escrita na entrada", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        paperWidthMm: 80
      });
      const operation = createClosedOperationWithFreight(
        database,
        identity,
        "cif",
        "Entregar na obra do centro"
      );

      await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer,
        new Date("2026-06-07T12:00:00.000Z")
      );

      const lines = printer.calls[0].lines;
      expect(lines.some((line) => line.startsWith("FRETE R$"))).toBe(false);
      expect(lines).toContain("OBS.: Entregar na obra do centro");
    } finally {
      database.close();
    }
  });

  it("reprints a receipt as the next copy", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });
      const operation = createClosedOperation(database, identity);
      const firstReceipt = await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer
      );

      const reprint = await reprintWeighingReceipt(
        database,
        { receiptId: firstReceipt.id, identity },
        printer,
        new Date("2026-06-07T13:00:00.000Z")
      );

      expect(reprint).toMatchObject({
        operationId: operation.id,
        receiptNumber: 1,
        copyNumber: 3,
        status: "printed"
      });
      expect(printer.calls).toHaveLength(3);
      expect(printer.calls[2].lines).toContain("3a VIA");
      expect(database.prepare("SELECT COUNT(*) FROM print_receipts").pluck().get()).toBe(3);
      expect(
        database
          .prepare("SELECT action FROM audit_logs WHERE action = 'receipt_reprinted'")
          .pluck()
          .get()
      ).toBe("receipt_reprinted");
    } finally {
      database.close();
    }
  });

  it("imprime o numero do computador como sufixo e mantem o mesmo numero na reimpressao", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      // Numero atribuido pela nuvem a esta balanca (a segunda da pedreira).
      database.prepare("UPDATE devices SET device_number = 2 WHERE id = ?").run(identity.deviceId);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });
      const operation = createClosedOperation(database, identity);

      const receipt = await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer
      );

      expect(receipt.deviceNumber).toBe(2);
      expect(printer.calls[0].lines).toContain("COPIA NRO 000000001-2");

      const reprint = await reprintWeighingReceipt(
        database,
        { receiptId: receipt.id, identity },
        printer
      );

      expect(reprint.deviceNumber).toBe(2);
      expect(printer.calls.at(-1)?.lines).toContain("COPIA NRO 000000001-2");
    } finally {
      database.close();
    }
  });

  it("records printer failures without changing the closed operation", async () => {
    const database = createDatabase();
    const printer = createFakePrinter(new Error("Printer offline"));

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });
      const operation = createClosedOperation(database, identity);

      const receipt = await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer
      );

      expect(receipt).toMatchObject({ status: "failed", errorMessage: "Printer offline" });
      expect(
        database
          .prepare("SELECT status FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(operation.id)
      ).toBe("closed_local");
      expect(database.prepare("SELECT status FROM print_receipts").pluck().get()).toBe("failed");
    } finally {
      database.close();
    }
  });

  /**
   * A leitura dos cupons deixou de usar `SELECT *` para nao trazer do disco o
   * `content_snapshot_json` (~11 kB por linha) que o mapeamento ja descartava. Estes casos
   * travam a equivalencia: os mesmos cupons, com os mesmos campos preenchidos, na mesma
   * ordem -- e a garantia de que o snapshot continua GRAVADO, so nao e mais lido aqui.
   */
  it("lista os cupons com todos os campos, sem trazer o snapshot descartado", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });
      const operation = createClosedOperation(database, identity);
      const impresso = await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer
      );

      const listados = listPrintReceipts(database);
      const listado = listados.find((r) => r.id === impresso.id);

      // Campo a campo, a via listada e identica a que a impressao devolveu.
      expect(listado).toEqual(impresso);
      // E nenhum campo do resumo pode ter virado indefinido pela troca da consulta.
      expect(listado?.operationId).toBe(operation.id);
      expect(listado?.unitId).toBe(identity.unitId);
      expect(listado?.receiptNumber).toBeGreaterThan(0);
      expect(listado?.printerName).toBe("TERMICA-80");
      expect(listado?.status).toBe("printed");
      expect(listado?.printedAt).toBeTruthy();
      expect(listado?.createdAt).toBeTruthy();
      expect(listado?.updatedAt).toBeTruthy();
      expect(listado?.deviceNumber).toBe(impresso.deviceNumber);
      expect(listado?.errorMessage).toBeNull();
      // O resumo nunca teve o snapshot -- e continua sem.
      expect("contentSnapshotJson" in (listado as object)).toBe(false);

      // O snapshot segue GRAVADO na tabela: a consulta parou de le-lo, nao de grava-lo.
      // E o que o espelhamento para a nuvem usa, com a consulta dele.
      for (const via of listados) {
        const gravado = database
          .prepare("SELECT content_snapshot_json FROM print_receipts WHERE id = ?")
          .get(via.id) as { content_snapshot_json: string };
        expect(gravado.content_snapshot_json.length).toBeGreaterThan(0);
        expect(() => JSON.parse(gravado.content_snapshot_json)).not.toThrow();
      }
    } finally {
      database.close();
    }
  });

  it("mantem a ordem do cupom mais recente para o mais antigo", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });
      const operation = createClosedOperation(database, identity);
      await printWeighingReceipt(database, { operationId: operation.id, identity }, printer);

      // As vias de uma mesma impressao nascem no mesmo milissegundo, entao empatam no
      // ORDER BY. Datas distintas e o que torna a ordem observavel de verdade.
      const vias = listPrintReceipts(database);
      expect(vias.length).toBeGreaterThan(1);
      vias.forEach((via, indice) => {
        database
          .prepare("UPDATE print_receipts SET created_at = ? WHERE id = ?")
          .run(`2026-0${indice + 1}-01T10:00:00.000Z`, via.id);
      });

      const ordenados = listPrintReceipts(database);
      expect(ordenados.map((r) => r.createdAt)).toEqual(
        [...ordenados.map((r) => r.createdAt)].sort().reverse()
      );
      // Nenhuma via se perdeu na troca da consulta.
      expect(new Set(ordenados.map((r) => r.id))).toEqual(new Set(vias.map((r) => r.id)));
    } finally {
      database.close();
    }
  });

  it("rejects printing an open operation", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });
      const operation = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });

      await expect(
        printWeighingReceipt(database, { operationId: operation.id, identity }, printer)
      ).rejects.toThrow("Only closed operations can be printed");
      expect(listPrintReceipts(database)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("reprints a receipt for an operation already synced to the cloud/OMIE", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });
      const operation = createClosedOperation(database, identity);

      // A sincronizacao promove a operacao de closed_local para synced. A reimpressao
      // da nota pela aba Concluidas ainda precisa funcionar nesse estado.
      database
        .prepare("UPDATE weighing_operations SET status = 'synced' WHERE id = ?")
        .run(operation.id);

      const receipt = await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer
      );

      expect(receipt.status).toBe("printed");
      expect(printer.calls.length).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  });

  it("prints a test receipt without creating a real operation", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });

      const receipt = await printTestReceipt(
        database,
        { identity },
        printer,
        new Date("2026-06-07T12:00:00.000Z")
      );

      expect(receipt.status).toBe("printed");
      expect(receipt.receiptNumber).toBe(0);
      expect(receipt.copyNumber).toBe(0);
      expect(receipt.printerName).toBe("TERMICA-80");
      expect(printer.calls).toHaveLength(1);
      expect(printer.calls[0].lines).toContain("=== CUPOM DE TESTE ===");
      expect(printer.calls[0].lines).toContain("Cliente: Cliente Exemplo");
      expect(printer.calls[0].lines).toContain("Veiculo: ABC1D23");
      expect(printer.calls[0].lines).toContain("Motorista: Motorista Teste");
      expect(printer.calls[0].lines).toContain("0001-BRITA 1 (TESTE)");
      expect(printer.calls[0].lines).toContain("ENTRADA <TARA>: 12,000 <TON>");
      expect(printer.calls[0].lines).toContain("SAIDA <CARREGADO>: 18,500 <TON>");
      expect(printer.calls[0].lines).toContain("LIQUIDO: 6,500 <TON>");
      expect(
        printer.calls[0].lines.some((line) => line.includes("R$") && line.includes("780,00"))
      ).toBe(true);

      // Nao deve criar operacao real
      expect(listPrintReceipts(database)).toHaveLength(1);
      const printReceipt = listPrintReceipts(database)[0];
      expect(printReceipt.operationId).toBe("test");
    } finally {
      database.close();
    }
  });

  it("records test receipt failures without crashing", async () => {
    const database = createDatabase();
    const printer = createFakePrinter(new Error("Printer offline"));

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });

      const receipt = await printTestReceipt(database, { identity }, printer);

      expect(receipt.status).toBe("failed");
      expect(receipt.errorMessage).toBe("Printer offline");
    } finally {
      database.close();
    }
  });

  // A logo e o cabecalho do cupom passaram a viajar no snapshot como bloco estruturado:
  // sem isso o renderizador HTML tinha de adivinhar quantas linhas do topo pular.
  it("leva a logo e o cabecalho estruturado ate a impressora", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();
    const logoDataUrl = "data:image/png;base64,iVBORw0KGgo=";

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        receiptLogoDataUrl: logoDataUrl,
        receiptLogoWidthMm: 30,
        receiptLogoHeightMm: 20
      });
      const operation = createClosedOperation(database, identity);

      await printWeighingReceipt(database, { operationId: operation.id, identity }, printer);

      const snapshot = printer.calls[0].snapshot;
      expect(snapshot.receiptLogo).toMatchObject({ dataUrl: logoDataUrl, widthMm: 30 });
      expect(snapshot.header.companyName).toBe("KYBERROCK MINERACAO LTDA");
      expect(snapshot.header.receiptNumberLabel).toBe("000000001");
      expect(snapshot.style.showLogo).toBe(true);
      expect(snapshot.lines.slice(-snapshot.bodyLines.length)).toEqual(snapshot.bodyLines);
    } finally {
      database.close();
    }
  });

  it("mantem a logo salva quando o perfil e regravado sem informar a logo", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        receiptLogoDataUrl: "data:image/png;base64,iVBORw0KGgo="
      });

      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-90" });

      expect(getActiveReceiptPrintProfile(database, identity.deviceId)?.receiptLogo.dataUrl).toBe(
        "data:image/png;base64,iVBORw0KGgo="
      );
    } finally {
      database.close();
    }
  });

  // A tela de impressao carregava o formulario com listPrintProfiles()[0], que devolve
  // perfis de qualquer computador/tipo de documento. Este lookup e a fonte correta.
  it("resolve o perfil ativo do proprio computador", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });

      expect(getActiveReceiptPrintProfile(database, identity.deviceId)).toMatchObject({
        deviceId: identity.deviceId,
        documentType: "receipt_80mm",
        windowsPrinterName: "TERMICA-80"
      });
      expect(getActiveReceiptPrintProfile(database, "outro-computador")).toBeNull();
    } finally {
      database.close();
    }
  });

  it("aplica a personalizacao de fonte e tamanhos no cupom impresso", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        templateConfig: {
          mode: "custom",
          fontFamily: "condensed",
          numberFontSizePx: 18,
          showFinancial: false
        }
      });
      const operation = createClosedOperation(database, identity);

      await printWeighingReceipt(database, { operationId: operation.id, identity }, printer);

      const snapshot = printer.calls[0].snapshot;
      expect(snapshot.style).toMatchObject({ fontFamily: "condensed", numberFontSizePx: 18 });
      expect(snapshot.lines).not.toContain("FINANCEIRO");
    } finally {
      database.close();
    }
  });

  /**
   * A termica ligada no Windows precisa poder receber ESC/POS pronto em vez de uma pagina
   * desenhada pelo driver. Se o tipo nao sobreviver ao banco, a impressao volta silenciosamente
   * para o caminho grafico — e o cupom volta a sair sem logo e sem numero.
   */
  it("guarda o modo texto direto (ESC/POS) escolhido para a impressora do Windows", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        printerType: "windows_escpos",
        windowsPrinterName: "MP-4200 TH"
      });

      const profile = getActiveReceiptPrintProfile(database, identity.deviceId);
      expect(profile).toMatchObject({
        printerType: "windows_escpos",
        windowsPrinterName: "MP-4200 TH",
        networkHost: null
      });

      const operation = createClosedOperation(database, identity);
      await printWeighingReceipt(database, { operationId: operation.id, identity }, printer);

      // O cupom sai para a fila do Windows pelo nome da impressora, nao por host:porta.
      expect(printer.calls[0].printerType).toBe("windows_escpos");
      expect(printer.calls[0].printerName).toBe("MP-4200 TH");
    } finally {
      database.close();
    }
  });

  it("exige o nome da impressora tambem no modo texto direto", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);

      expect(() =>
        configureReceiptPrintProfile(database, {
          identity,
          printerType: "windows_escpos",
          windowsPrinterName: "  "
        })
      ).toThrow(/Printer name/i);
    } finally {
      database.close();
    }
  });

  it("imprime o telefone da pedreira configurado no perfil", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        templateConfig: { companyPhone: "(11) 3333-4444" }
      });
      const operation = createClosedOperation(database, identity);

      await printWeighingReceipt(database, { operationId: operation.id, identity }, printer);

      expect(printer.calls[0].lines).toContain("CONTATO: (11) 3333-4444");
    } finally {
      database.close();
    }
  });

  /**
   * O cupom sem a linha "COD ..." deixa o operador sem como achar a venda a partir do papel.
   * Toda operacao aberta nesta balanca ja nasce com codigo; a que chega da nuvem publicada
   * por uma balanca em versao antiga pode vir sem, e ai o codigo e atribuido na impressao.
   */
  it("numera a operacao que chegou sem codigo antes de imprimir", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });
      const anterior = createClosedOperation(database, identity);
      const operation = createClosedOperation(database, identity);
      database
        .prepare("UPDATE weighing_operations SET operation_code = NULL WHERE id = ?")
        .run(operation.id);

      await printWeighingReceipt(database, { operationId: operation.id, identity }, printer);

      const codigoAnterior = database
        .prepare("SELECT operation_code FROM weighing_operations WHERE id = ?")
        .pluck()
        .get(anterior.id) as number;
      const codigo = database
        .prepare("SELECT operation_code FROM weighing_operations WHERE id = ?")
        .pluck()
        .get(operation.id) as number;

      // Segue a sequencia da pedreira, sem repetir o codigo de outra operacao.
      expect(codigo).toBe(codigoAnterior + 1);
      expect(printer.calls[0].snapshot.header.operationCodeLabel).toBe(
        String(codigo).padStart(6, "0")
      );
      expect(printer.calls[0].lines.join("\n")).toContain(`COD ${String(codigo).padStart(6, "0")}`);
    } finally {
      database.close();
    }
  });

  it("nao renumera o cupom ja emitido quando ele e reimpresso", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });
      const operation = createClosedOperation(database, identity);
      const codigo = database
        .prepare("SELECT operation_code FROM weighing_operations WHERE id = ?")
        .pluck()
        .get(operation.id) as number;

      const receipt = await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer
      );
      await reprintWeighingReceipt(database, { receiptId: receipt.id, identity }, printer);

      expect(
        database
          .prepare("SELECT operation_code FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(operation.id)
      ).toBe(codigo);
    } finally {
      database.close();
    }
  });

  it("imprime a referencia da nota de entrega futura do produto pesado", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        paperWidthMm: 80
      });
      insertFutureBillingCadastro(database);
      setCustomerFutureBillingInvoice(database, {
        customerId: "customer-fb",
        productId: "product-rachao",
        nfeNumber: "12345"
      });
      // Nota de outro produto do MESMO cliente: nao pode sair nesta pesagem.
      setCustomerFutureBillingInvoice(database, {
        customerId: "customer-fb",
        productId: "product-brita",
        nfeNumber: "99999"
      });
      const operation = createClosedRachaoOperation(database, identity);

      await printWeighingReceipt(database, { operationId: operation.id, identity }, printer);

      const printed = printer.calls[0].lines.join(" ");
      expect(printed).toContain("NF-E DE FATURAMENTO FUTURO N. 12345");
      expect(printed).not.toContain("99999");
    } finally {
      database.close();
    }
  });

  it("a 2a via sai com a MESMA nota da 1a, mesmo se o cadastro mudar depois", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        paperWidthMm: 80
      });
      insertFutureBillingCadastro(database);
      setCustomerFutureBillingInvoice(database, {
        customerId: "customer-fb",
        productId: "product-rachao",
        nfeNumber: "12345"
      });
      const operation = createClosedRachaoOperation(database, identity);
      const receipt = await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer
      );
      expect(printer.calls[0].lines.join(" ")).toContain("N. 12345");

      // A entrega futura acabou e o operador cadastra a nota seguinte. O que ja saiu no
      // papel nao pode mudar: a 1a via em maos do cliente cita a 12345, e a NF-e enviada
      // ao OMIE tambem.
      setCustomerFutureBillingInvoice(database, {
        customerId: "customer-fb",
        productId: "product-rachao",
        nfeNumber: "77777"
      });
      printer.calls.length = 0;
      await reprintWeighingReceipt(database, { receiptId: receipt.id, identity }, printer);

      expect(printer.calls[0].lines.join(" ")).toContain("N. 12345");
      expect(printer.calls[0].lines.join(" ")).not.toContain("77777");
    } finally {
      database.close();
    }
  });

  it("nao imprime a nota de entrega futura na operacao interna (venda sem nota)", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        paperWidthMm: 80
      });
      insertFutureBillingCadastro(database);
      setCustomerFutureBillingInvoice(database, {
        customerId: "customer-fb",
        productId: "product-rachao",
        nfeNumber: "12345"
      });
      const operation = createClosedRachaoOperation(database, identity, "internal");

      await printWeighingReceipt(database, { operationId: operation.id, identity }, printer);

      // A operacao interna vira ordem de servico e nao emite NF-e: nao ha remessa de
      // entrega futura para referenciar, no papel nem no OMIE.
      expect(printer.calls[0].lines.join(" ")).not.toContain("12345");
      expect(
        database
          .prepare("SELECT future_billing_nfe_number FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(operation.id)
      ).toBeNull();
    } finally {
      database.close();
    }
  });

  it("nao imprime a linha de entrega futura quando o cliente nao tem nota", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        paperWidthMm: 80
      });
      insertFutureBillingCadastro(database);
      const operation = createClosedRachaoOperation(database, identity);

      await printWeighingReceipt(database, { operationId: operation.id, identity }, printer);

      expect(printer.calls[0].lines.join(" ")).not.toContain("FATURAMENTO FUTURO");
    } finally {
      database.close();
    }
  });
});

/** Cliente e produtos reais (o cupom resolve a nota pelo par cliente+produto). */
function insertFutureBillingCadastro(database: DesktopDatabase): void {
  const now = "2026-06-06T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
       VALUES ('customer-fb', 'company-1', 'local', 'Concessionaria LTDA', 'Concessionaria', 1, ?, ?)`
    )
    .run(now, now);
  for (const [id, omieId, code, description] of [
    ["product-rachao", 123, "RACHAO", "Rachao"],
    ["product-brita", 124, "BRITA1", "Brita 1"]
  ] as Array<[string, number, string, string]>) {
    database
      .prepare(
        `INSERT INTO products (
           id, company_id, omie_product_id, code, description, unit, unit_price_cents, item_type,
           created_at, updated_at
         ) VALUES (?, 'company-1', ?, ?, ?, 'ton', 12000, '04 - Produtos Acabados', ?, ?)`
      )
      .run(id, omieId, code, description, now, now);
  }
  database
    .prepare(
      `INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
       VALUES ('vehicle-fb', 'company-1', 'ABC1D23', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO drivers (id, company_id, name, created_at, updated_at)
       VALUES ('driver-fb', 'company-1', 'Motorista Teste', ?, ?)`
    )
    .run(now, now);
}

function createClosedRachaoOperation(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  operationType: "invoice" | "internal" = "invoice"
): { id: string } {
  const operation = createWeighingOperation(database, {
    identity,
    customerId: "customer-fb",
    vehicleId: "vehicle-fb",
    driverId: "driver-fb",
    productId: "product-rachao",
    entryWeightKg: 12_000
  });
  return closeWeighingOperation(database, {
    operationId: operation.id,
    exitWeightKg: 18_500,
    operationType
  });
}

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  return database;
}

function createIdentity(database: DesktopDatabase): LocalDesktopIdentity {
  return ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
}

function createClosedOperation(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  operationType: "invoice" | "internal" = "invoice"
) {
  const operation = createSimulatedWeighingOperation(database, {
    identity,
    operationType,
    customerName: "Cliente Teste",
    plate: "ABC1D23",
    driverName: "Motorista Teste",
    productDescription: "Brita 1",
    paymentTermName: "A vista",
    unitPriceCents: 12,
    entryWeightKg: 12_000
  });

  return closeWeighingOperation(database, {
    operationId: operation.id,
    exitWeightKg: 18_500,
    operationType
  });
}

/**
 * Operacao fechada com frete por tonelada lancado. `modality` escolhe entre a situacao 1
 * ("fob": o valor sai na nota e no cupom) e a 2 ("cif": o valor fica so no sistema).
 */
function createClosedOperationWithFreight(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  modality: "fob" | "cif",
  destination: string | null = null
) {
  const operation = createSimulatedWeighingOperation(database, {
    identity,
    customerName: "Cliente Teste",
    plate: "ABC1D23",
    driverName: "Motorista Teste",
    productDescription: "Brita 1",
    paymentTermName: "A vista",
    unitPriceCents: 12,
    entryWeightKg: 12_000
  });
  database
    .prepare("UPDATE weighing_operations SET freight_json = ?, freight_type = ? WHERE id = ?")
    .run(
      JSON.stringify({
        payer: "customer",
        rule: {
          id: "operation-freight",
          name: "Frete da operacao",
          type: "per_ton",
          baseValueCents: 9_000,
          unit: "ton"
        },
        destination,
        showOnReceipt: modality === "fob"
      }),
      modality,
      operation.id
    );

  return closeWeighingOperation(database, {
    operationId: operation.id,
    exitWeightKg: 18_500,
    operationType: "invoice"
  });
}

function createFakePrinter(error?: Error): ReceiptPrinter & { calls: ReceiptPrintPayload[] } {
  const calls: ReceiptPrintPayload[] = [];

  return {
    calls,
    async printReceipt(payload) {
      calls.push(payload);

      if (error) {
        throw error;
      }
    }
  };
}
