import { getDesktopDataPaths } from "../database/paths.js";
import { openDesktopDatabase } from "../database/sqlite.js";
import { resolveCompanyId } from "../services/customer-import.js";
import type { DuplicateCadastroGroup } from "../services/customer-duplicates.js";
import { findDuplicateCustomerCadastros } from "../services/customer-duplicates.js";

/**
 * CLI de diagnostico dos cadastros de cliente repetidos NESTA maquina.
 *
 *   node dist/scripts/clientes-duplicados.js
 *   node dist/scripts/clientes-duplicados.js --db C:\\caminho\\kyberrock.sqlite3
 *
 * So le o banco — nao altera, nao funde e nao apaga nada.
 *
 * Serve para a pergunta que a tela nao responde: "por que na balanca principal o cliente
 * aparece dobrado e na outra maquina aparece um so?". Os cadastros `omie_<codigo>` nascem
 * apenas onde o sync direto com o OMIE roda (a maquina que tem as credenciais) e nao sobem
 * para a nuvem — entao as duas telas nunca mostram a mesma lista, e comparar uma com a
 * outra nao diz nada. Este relatorio roda no banco de cada maquina.
 */

const USAGE = `
KyberRock — clientes repetidos no banco desta maquina (somente leitura)

  --db <caminho>     banco SQLite (padrao: o do KyberRock instalado)
  --empresa <id>     obrigatorio so quando ha mais de uma empresa no banco
  --ajuda            mostra esta ajuda
`;

interface ParsedArgs {
  flags: Map<string, string>;
  booleans: Set<string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string>();
  const booleans = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      booleans.add(name);
    }
  }

  return { flags, booleans };
}

function describeDocument(document: string | null): string {
  const trimmed = (document ?? "").trim();
  return trimmed === "" ? "sem CNPJ/CPF" : trimmed;
}

function printGroup(group: DuplicateCadastroGroup, position: number): void {
  const heading =
    group.reason === "documento"
      ? "mesmo CNPJ/CPF — sao o mesmo cliente"
      : "mesmo nome, e um dos cadastros esta sem CNPJ/CPF — CONFERIR antes de juntar";

  console.log(`\n${position}. ${group.rows[0].name} (${heading})`);
  for (const row of group.rows) {
    const omie = row.omieCustomerId ? `OMIE ${row.omieCustomerId}` : "sem codigo OMIE";
    const inactive = row.isActive ? "" : ", inativo";
    console.log(
      `     - ${row.id}  |  ${describeDocument(row.document)}  |  ${omie}  |  ` +
        `${row.operations} pesagem(ns)${inactive}`
    );
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.booleans.has("ajuda") || args.booleans.has("help")) {
    console.log(USAGE);
    return;
  }

  const databasePath = args.flags.get("db") ?? getDesktopDataPaths().databasePath;
  const database = openDesktopDatabase({ databasePath, fileMustExist: true });

  try {
    const companyId = resolveCompanyId(database, args.flags.get("empresa"));
    const groups = findDuplicateCustomerCadastros(database, companyId);

    console.log(`\nBanco...: ${databasePath}`);
    console.log(`Empresa.: ${companyId}`);

    if (groups.length === 0) {
      console.log("\nNenhum cadastro repetido nesta maquina.");
      return;
    }

    console.log(`\n${groups.length} grupo(s) de cadastros que parecem o mesmo cliente:`);
    groups.forEach((group, index) => printGroup(group, index + 1));

    console.log(
      "\nNada foi alterado. As pesagens ao lado de cada linha dizem o que esta pendurado nela;\n" +
        "os grupos marcados como CONFERIR podem ser matriz e filial, que sao clientes diferentes."
    );
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error: unknown) {
  console.error(`\nErro: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
