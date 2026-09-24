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

describe("regras copiadas do desktop", () => {
  for (const file of ["freight.ts", "payment-condition-parser.ts", "payment-condition-match.ts"]) {
    it(`${file} e igual ao do desktop`, () => {
      const copy = readFileSync(path.join(here, "desktop", file), "utf8");
      const original = readFileSync(path.join(desktop, file), "utf8");
      expect(copy).toBe(original);
    });
  }
});
