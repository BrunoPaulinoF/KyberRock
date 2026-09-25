import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * A aba Comercial do site e a tela "Relatorio de vendas" do KyberRock Portal
 * (`apps/loader-web`), que o comercial usava. A conta (visoes, filtro de frete, preco medio,
 * CSV) e copia byte a byte da do portal: enquanto as duas telas existirem, o mesmo filtro tem de
 * dar o mesmo numero nas duas. Corrigiu la, copie aqui.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const portal = path.resolve(here, "../../../loader-web/src/lib");

describe("regras copiadas do portal", () => {
  for (const file of ["sales-report.ts", "sales-report.test.ts"]) {
    it(`${file} e igual ao do portal`, () => {
      expect(readFileSync(path.join(here, "portal", file), "utf8")).toBe(
        readFileSync(path.join(portal, file), "utf8")
      );
    });
  }
});
