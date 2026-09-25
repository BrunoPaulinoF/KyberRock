import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * O site nao importa outro workspace (README do apps/web), entao as regras que precisam ser
 * IGUAIS nos dois lados — tipo de frete e condicao de pagamento — sao copias de
 * `apps/desktop/src/services/`. Este teste falha quando uma das copias fica para tras: corrigiu
 * la, copie aqui.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "../../../desktop/src/services");

/** Copias byte a byte (sem import de outro workspace). */
const EXACT_COPIES = [
  "freight.ts",
  "payment-condition-parser.ts",
  "payment-condition-match.ts",
  // Relatorios: o mesmo HTML que o desktop salva em PDF e em .xls.
  "report-document.ts",
  "sheet-cell.ts",
  "report-total-bar.ts",
  "report-unit-price.ts",
  "invoice-number-label.ts",
  "invoice-closing-cycle.ts",
  "weighing-billing-situation.ts"
];

/**
 * Os montadores de relatorio importam tipos de modulos que moram no SQLite do desktop (e o de
 * caminhoes, a busca do `@kyberrock/shared`), entao a copia do site troca SO o bloco de
 * imports. Todo o resto — colunas, totais, textos, formatacao — tem de ser igual ao do desktop.
 */
const BODY_COPIES = [
  "truck-control-report.ts",
  "customer-report-render.ts",
  "weighing-billing-report-render.ts",
  "invoice-closing-render.ts"
];

/** O arquivo sem o bloco de imports do comeco. */
export function withoutImports(source: string): string {
  const lines = source.split("\n");
  let index = 0;
  let inImport = false;
  while (index < lines.length) {
    const line = lines[index];
    if (inImport) {
      if (/from\s+["'][^"']+["'];?\s*$/.test(line)) inImport = false;
      index++;
      continue;
    }
    if (line.trim() === "") {
      index++;
      continue;
    }
    if (/^import\s/.test(line)) {
      inImport = !/from\s+["'][^"']+["'];?\s*$/.test(line) && !/^import\s+["']/.test(line);
      index++;
      continue;
    }
    break;
  }
  return lines.slice(index).join("\n");
}

describe("regras copiadas do desktop", () => {
  for (const file of BODY_COPIES) {
    it(`${file}: tudo menos os imports e igual ao do desktop`, () => {
      const copy = readFileSync(path.join(here, "desktop", file), "utf8");
      const original = readFileSync(path.join(desktop, file), "utf8");
      expect(withoutImports(copy)).toBe(withoutImports(original));
    });
  }

  for (const file of EXACT_COPIES) {
    it(`${file} e igual ao do desktop`, () => {
      const copy = readFileSync(path.join(here, "desktop", file), "utf8");
      const original = readFileSync(path.join(desktop, file), "utf8");
      expect(copy).toBe(original);
    });
  }
});
