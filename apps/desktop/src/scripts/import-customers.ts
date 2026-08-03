import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getDesktopDataPaths } from "../database/paths.js";
import type { DesktopDatabase } from "../database/sqlite.js";
import { openDesktopDatabase } from "../database/sqlite.js";
import { exportManualBackup } from "../services/backup.js";
import type {
  CustomerImportRecord,
  CustomerColumnMap,
  MergeCustomerSheetsResult
} from "../services/customer-import-sheet.js";
import {
  customerRecordsToCsv,
  mergeCustomerSheets,
  parseCustomerSheet,
  parseDocumentSheet
} from "../services/customer-import-sheet.js";
import type { ImportCustomersReport } from "../services/customer-import.js";
import { importCustomers, resolveCompanyId } from "../services/customer-import.js";
import { readSpreadsheet, toCsvFile } from "../services/spreadsheet-read.js";

/**
 * CLI de importacao de clientes.
 *
 *   node dist/scripts/import-customers.js conciliar --precos A.xlsx --documentos B.xlsx
 *   node dist/scripts/import-customers.js importar  --arquivo clientes-conciliados.csv --dry-run
 *   node dist/scripts/import-customers.js importar  --arquivo clientes-conciliados.csv
 *
 * Documentacao completa em docs/importacao-clientes.md.
 */

const USAGE = `
KyberRock — importacao de clientes a partir de planilhas

  conciliar   Junta a planilha comercial (contato + preco por produto) com a de
              CNPJ/CPF e gera uma planilha unica.

    --precos <arquivo>        planilha com clientes, contato e precos (.xlsx ou .csv)
    --documentos <arquivo>    planilha com nomes e CNPJ/CPF (.xlsx ou .csv)
    --saida <arquivo>         CSV consolidado (padrao: clientes-conciliados.csv)
    --aba-precos <nome|N>     aba da planilha de precos (padrao: a primeira)
    --aba-documentos <nome|N> aba da planilha de documentos (padrao: a primeira)
    --similaridade <0..1>     corte para casar nomes diferentes (padrao: 0.86)
    --colunas-preco a,b       forca estas colunas como preco de produto
    --ignorar-colunas a,b     ignora estas colunas

  importar    Aplica a planilha no KyberRock (banco local). Cliente que ja existe
              tem os dados substituidos pelos da planilha; quem nao existe e criado.
              O envio ao OMIE continua sendo feito pelo sync do proprio app.

    --arquivo <arquivo>       planilha consolidada (.csv ou .xlsx)
    --precos / --documentos   alternativa a --arquivo: concilia e importa de uma vez
    --aba <nome|N>            aba da planilha (padrao: a primeira)
    --db <caminho>            banco SQLite (padrao: o do KyberRock instalado)
    --empresa <id>            obrigatorio so quando ha mais de uma empresa no banco
    --dry-run                 simula e mostra o relatorio sem gravar nada
    --limpar-vazios           celula vazia APAGA o valor atual (padrao: mantem)
    --substituir-precos       apaga precos especiais que nao estao na planilha
    --somente-com-cnpj        pula clientes sem CNPJ/CPF
    --mapa-produtos <json>    { "nome na planilha": "produto no KyberRock" }
    --relatorio <arquivo>     grava o relatorio linha a linha em CSV
    --sem-backup              nao copia o banco antes de gravar
`;

interface ParsedArgs {
  command: string;
  flags: Map<string, string>;
  booleans: Set<string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string>();
  const booleans = new Set<string>();
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "";

  for (let index = command ? 1 : 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      index++;
    } else {
      booleans.add(name);
    }
  }

  return { command, flags, booleans };
}

function requireFlag(args: ParsedArgs, name: string): string {
  const value = args.flags.get(name);
  if (!value) throw new Error(`Faltou --${name}. Use --ajuda para ver os parametros.`);
  return value;
}

function parseSheetOption(value: string | undefined): string | number | undefined {
  if (value === undefined) return undefined;
  const asNumber = Number(value);
  return Number.isInteger(asNumber) && asNumber > 0 ? asNumber : value;
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function describeColumns(label: string, columns: CustomerColumnMap): void {
  const fields = Object.entries(columns.fields)
    .map(([key, header]) => `${key}="${header}"`)
    .join(", ");
  console.log(`\n${label}`);
  console.log(`  Campos.....: ${fields || "(nenhum)"}`);
  if (columns.longFormat) {
    console.log(
      `  Precos.....: uma linha por produto ("${columns.longFormat.productHeader}" x "${columns.longFormat.priceHeader}")`
    );
  } else {
    console.log(
      `  Produtos...: ${columns.priceColumns.map((column) => column.product).join(", ") || "(nenhum)"}`
    );
  }
  if (columns.ignored.length > 0) {
    console.log(`  Ignoradas..: ${columns.ignored.join(", ")}`);
  }
}

function printWarnings(warnings: readonly string[]): void {
  if (warnings.length === 0) return;
  console.log(`\nAvisos (${warnings.length}):`);
  warnings.slice(0, 30).forEach((warning) => console.log(`  - ${warning}`));
  if (warnings.length > 30) console.log(`  ... e mais ${warnings.length - 30}.`);
}

// ---------------------------------------------------------------------------
// conciliar
// ---------------------------------------------------------------------------

interface LoadedSheets {
  records: CustomerImportRecord[];
  merge: MergeCustomerSheetsResult;
}

function conciliate(args: ParsedArgs): LoadedSheets {
  const pricesPath = requireFlag(args, "precos");
  const documentsPath = requireFlag(args, "documentos");
  const detectOptions = {
    priceColumns: parseList(args.flags.get("colunas-preco")),
    ignoreColumns: parseList(args.flags.get("ignorar-colunas"))
  };

  const pricesTable = readSpreadsheet(pricesPath, {
    sheet: parseSheetOption(args.flags.get("aba-precos"))
  });
  const documentsTable = readSpreadsheet(documentsPath, {
    sheet: parseSheetOption(args.flags.get("aba-documentos"))
  });

  console.log(
    `Planilha de precos.....: ${path.basename(pricesPath)} — aba "${pricesTable.name}", ${pricesTable.rows.length} linhas`
  );
  console.log(
    `Planilha de documentos.: ${path.basename(documentsPath)} — aba "${documentsTable.name}", ${documentsTable.rows.length} linhas`
  );

  const parsed = parseCustomerSheet(pricesTable, detectOptions);
  describeColumns("Colunas reconhecidas na planilha de precos:", parsed.columns);

  const documents = parseDocumentSheet(documentsTable, detectOptions);
  const similarity = args.flags.get("similaridade");
  const merge = mergeCustomerSheets(parsed.records, documents.entries, {
    similarityThreshold: similarity ? Number(similarity) : undefined
  });

  console.log(`\nClientes na planilha de precos: ${parsed.records.length}`);
  console.log(`CNPJ/CPF disponiveis..........: ${documents.entries.length}`);
  console.log(`Conciliados...................: ${merge.matched.length}`);
  console.log(`Sem CNPJ/CPF..................: ${merge.withoutDocument.length}`);
  console.log(`Documentos nao usados.........: ${merge.unusedDocuments.length}`);

  const approximate = merge.matched.filter((match) => match.score < 1);
  if (approximate.length > 0) {
    console.log(`\nCasados por semelhanca (confira antes de importar):`);
    approximate.forEach((match) =>
      console.log(
        `  - "${match.customer}" ~ "${match.matchedName}" (${match.score}) -> ${match.document}`
      )
    );
  }

  if (merge.withoutDocument.length > 0) {
    console.log(`\nSem CNPJ/CPF:`);
    merge.withoutDocument
      .slice(0, 30)
      .forEach((item) =>
        console.log(
          `  - linha ${item.sourceLine}: "${item.customer}"${
            item.bestCandidate ? ` (mais proximo: "${item.bestCandidate}", ${item.bestScore})` : ""
          }`
        )
      );
    if (merge.withoutDocument.length > 30) {
      console.log(`  ... e mais ${merge.withoutDocument.length - 30}.`);
    }
  }

  printWarnings([...parsed.warnings, ...documents.warnings, ...merge.warnings]);

  return { records: merge.records, merge };
}

function writePendingCsv(outputPath: string, merge: MergeCustomerSheetsResult): string | null {
  if (merge.withoutDocument.length === 0 && merge.unusedDocuments.length === 0) return null;

  const rows: string[][] = [["Tipo", "Linha", "Nome", "Mais proximo", "Semelhanca", "CNPJ/CPF"]];
  for (const item of merge.withoutDocument) {
    rows.push([
      "Sem CNPJ/CPF",
      String(item.sourceLine),
      item.customer,
      item.bestCandidate ?? "",
      item.bestScore ? String(item.bestScore) : "",
      ""
    ]);
  }
  for (const item of merge.unusedDocuments) {
    rows.push(["Documento nao usado", String(item.sourceLine), item.name, "", "", item.document]);
  }

  const pendingPath = outputPath.replace(/(\.[^.]+)?$/, "-pendencias.csv");
  writeFileSync(pendingPath, toCsvFile(rows), "utf8");
  return pendingPath;
}

function runConciliate(args: ParsedArgs): void {
  const { merge } = conciliate(args);
  const outputPath = args.flags.get("saida") ?? "clientes-conciliados.csv";

  writeFileSync(outputPath, customerRecordsToCsv(merge.records), "utf8");
  console.log(`\nPlanilha consolidada: ${path.resolve(outputPath)}`);

  const pendingPath = writePendingCsv(outputPath, merge);
  if (pendingPath) console.log(`Pendencias..........: ${path.resolve(pendingPath)}`);

  console.log(
    `\nConfira o arquivo e depois rode:\n  node dist/scripts/import-customers.js importar --arquivo "${outputPath}" --dry-run`
  );
}

// ---------------------------------------------------------------------------
// importar
// ---------------------------------------------------------------------------

function loadRecordsForImport(args: ParsedArgs): CustomerImportRecord[] {
  if (args.flags.has("arquivo")) {
    const filePath = requireFlag(args, "arquivo");
    const table = readSpreadsheet(filePath, { sheet: parseSheetOption(args.flags.get("aba")) });
    const parsed = parseCustomerSheet(table, {
      priceColumns: parseList(args.flags.get("colunas-preco")),
      ignoreColumns: parseList(args.flags.get("ignorar-colunas"))
    });
    console.log(
      `Planilha: ${path.basename(filePath)} — aba "${table.name}", ${parsed.records.length} clientes`
    );
    describeColumns("Colunas reconhecidas:", parsed.columns);
    printWarnings(parsed.warnings);
    return parsed.records;
  }

  // Sem --arquivo, aceita as duas planilhas cruas e concilia na hora.
  return conciliate(args).records;
}

function readProductAliases(filePath: string | undefined): Record<string, string> | undefined {
  if (!filePath) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `--mapa-produtos deve ser um JSON no formato { "nome na planilha": "produto no KyberRock" }.`
    );
  }
  return parsed as Record<string, string>;
}

async function backupDatabase(database: DesktopDatabase, databasePath: string): Promise<string> {
  const paths = getDesktopDataPaths();
  const isDefaultDatabase = path.resolve(databasePath) === path.resolve(paths.databasePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(
    isDefaultDatabase ? paths.backupDirectory : path.dirname(databasePath),
    `kyberrock-pre-import-${stamp}.sqlite3`
  );
  await exportManualBackup(database, destination);
  return destination;
}

function printReport(report: ImportCustomersReport): void {
  console.log(`\n${report.dryRun ? "SIMULACAO (nada foi gravado)" : "Importacao concluida"}`);
  console.log(`  Criados..............: ${report.created}`);
  console.log(`  Atualizados..........: ${report.updated}`);
  console.log(`  Sem alteracao........: ${report.unchanged}`);
  console.log(`  Pulados..............: ${report.skipped}`);
  console.log(`  Com erro.............: ${report.failed}`);
  console.log(`  Precos gravados......: ${report.pricesApplied}`);
  console.log(`  Precos removidos.....: ${report.pricesRemoved}`);

  const failures = report.entries.filter((entry) => entry.action === "error");
  if (failures.length > 0) {
    console.log(`\nErros:`);
    failures.forEach((entry) =>
      console.log(`  - linha ${entry.sourceLine} "${entry.customer}": ${entry.message}`)
    );
  }

  const skipped = report.entries.filter((entry) => entry.action === "skipped");
  if (skipped.length > 0) {
    console.log(`\nPulados:`);
    skipped
      .slice(0, 30)
      .forEach((entry) =>
        console.log(`  - linha ${entry.sourceLine} "${entry.customer}": ${entry.message}`)
      );
    if (skipped.length > 30) console.log(`  ... e mais ${skipped.length - 30}.`);
  }

  const withoutDocument = report.entries.filter(
    (entry) => entry.document === null && entry.action !== "skipped" && entry.action !== "error"
  );
  if (withoutDocument.length > 0) {
    console.log(
      `\nAtencao: ${withoutDocument.length} cliente(s) entraram sem CNPJ/CPF. O OMIE recusa cadastro sem documento — preencha antes do proximo sync.`
    );
  }

  if (report.unresolvedProducts.length > 0) {
    console.log(`\nProdutos da planilha que nao existem no KyberRock (precos nao aplicados):`);
    report.unresolvedProducts.forEach((product) => console.log(`  - ${product}`));
    console.log(
      `  Cadastre o produto (ou sincronize com o OMIE) e rode de novo, ou use --mapa-produtos.`
    );
  }
}

function writeReportCsv(filePath: string, report: ImportCustomersReport): void {
  const rows: string[][] = [
    [
      "Linha",
      "Cliente",
      "CNPJ/CPF",
      "Acao",
      "Campos alterados",
      "Precos gravados",
      "Precos removidos",
      "Produtos nao encontrados",
      "Mensagem"
    ]
  ];

  for (const entry of report.entries) {
    rows.push([
      String(entry.sourceLine),
      entry.customer,
      entry.document ?? "",
      entry.action,
      entry.changedFields.join(", "),
      String(entry.pricesApplied),
      String(entry.pricesRemoved),
      entry.unresolvedProducts.join(", "),
      entry.message ?? ""
    ]);
  }

  writeFileSync(filePath, toCsvFile(rows), "utf8");
  console.log(`\nRelatorio detalhado: ${path.resolve(filePath)}`);
}

async function runImport(args: ParsedArgs): Promise<void> {
  const records = loadRecordsForImport(args);
  if (records.length === 0) {
    console.log("\nNenhum cliente na planilha. Nada a importar.");
    return;
  }

  const databasePath = args.flags.get("db") ?? getDesktopDataPaths().databasePath;
  const dryRun = args.booleans.has("dry-run");
  const database = openDesktopDatabase({ databasePath, fileMustExist: true });

  try {
    const companyId = resolveCompanyId(database, args.flags.get("empresa"));
    console.log(`\nBanco...: ${databasePath}`);
    console.log(`Empresa.: ${companyId}`);

    if (!dryRun && !args.booleans.has("sem-backup")) {
      const backupPath = await backupDatabase(database, databasePath);
      console.log(`Backup..: ${backupPath}`);
    }

    const report = importCustomers(database, records, {
      companyId,
      dryRun,
      clearEmpty: args.booleans.has("limpar-vazios"),
      replacePrices: args.booleans.has("substituir-precos"),
      requireDocument: args.booleans.has("somente-com-cnpj"),
      productAliases: readProductAliases(args.flags.get("mapa-produtos"))
    });

    printReport(report);

    const reportPath = args.flags.get("relatorio");
    if (reportPath) writeReportCsv(reportPath, report);

    if (!dryRun) {
      console.log(
        `\nOs cadastros ficaram marcados para envio. O OMIE recebe no proximo sync do KyberRock (ou pelo botao de sincronizar no app).`
      );
    }
  } finally {
    database.close();
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.booleans.has("ajuda") || args.booleans.has("help")) {
    console.log(USAGE);
    return;
  }

  switch (args.command) {
    case "conciliar":
      runConciliate(args);
      return;
    case "importar":
      await runImport(args);
      return;
    default:
      console.error(`Comando desconhecido: "${args.command}".`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`\nErro: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
