import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * A `web-api` resolve a condicao de pagamento digitada no cadastro do cliente pela MESMA regra
 * da balanca: o mesmo texto tem de reusar a mesma condicao dos dois lados, senao cada ponta cria
 * a sua e o cadastro enche de duplicatas. Estes arquivos sao copias de
 * `apps/desktop/src/services/` (sem import nenhum, por isso rodam no Deno como estao): corrigiu
 * la, copie aqui.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "../../../apps/desktop/src/services");

describe("regras copiadas do desktop", () => {
  for (const file of ["payment-condition-parser.ts", "payment-condition-match.ts"]) {
    it(`${file} e igual ao do desktop`, () => {
      expect(readFileSync(path.join(here, file), "utf8")).toBe(
        readFileSync(path.join(desktop, file), "utf8")
      );
    });
  }
});
