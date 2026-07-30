import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// As Edge Functions rodam em Deno, nao em Node: globais do Node (Buffer,
// process, __dirname...) nao existem sem import explicito. O erro so aparece em
// producao, na hora em que aquela linha executa — foi assim que o envio do
// relatorio financeiro morreu em "Buffer is not defined" ao anexar os PDFs,
// depois de ja ter gasto minutos consultando o OMIE. Este teste le o proprio
// fonte porque importar o modulo dispararia o Deno.serve.

const functionsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const NODE_GLOBALS = [
  { name: "Buffer", module: "node:buffer" },
  { name: "process", module: "node:process" }
];

const EDGE_FUNCTION_ENTRYPOINTS = [
  "financial-report-email/index.ts",
  "daily-report-email/index.ts"
];

describe("globais do Node nas Edge Functions", () => {
  for (const entrypoint of EDGE_FUNCTION_ENTRYPOINTS) {
    const source = readFileSync(resolve(functionsDir, entrypoint), "utf8");

    for (const global of NODE_GLOBALS) {
      it(`${entrypoint}: importa ${global.name} se usar ${global.name}`, () => {
        const uses = new RegExp(`\\b${global.name}\\.`).test(source);
        if (!uses) return;
        expect(
          source.includes(`from "${global.module}"`),
          `${entrypoint} usa ${global.name} sem importar de ${global.module}`
        ).toBe(true);
      });
    }
  }

  it("o relatorio financeiro anexa PDFs e portanto precisa do Buffer", () => {
    const source = readFileSync(resolve(functionsDir, "financial-report-email/index.ts"), "utf8");

    expect(source).toContain("Buffer.from(attachment.content)");
    expect(source).toContain('from "node:buffer"');
  });
});
