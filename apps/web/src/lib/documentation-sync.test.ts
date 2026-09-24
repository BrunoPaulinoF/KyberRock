import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * O site nao importa outros workspaces (README do apps/web): a Central de ajuda e uma COPIA de
 * `apps/desktop/src/renderer/documentation-{content,search}.ts`. Este teste falha quando as duas
 * copias divergem, para quem corrigir a ajuda num lugar lembrar de copiar para o outro.
 *
 * Compara o texto, ignorando as linhas de import (o unico ajuste permitido na copia). Fora do
 * monorepo (a Hostinger copia so `apps/web`) o arquivo do desktop nao existe e o teste e pulado.
 */

const COPIES = ["documentation-content.ts", "documentation-search.ts"] as const;

function sourcePath(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

/** Tira os imports (inclusive os de varias linhas) e normaliza o fim de linha. */
function withoutImports(source: string): string {
  return source
    .replace(/\r\n/g, "\n")
    .replace(/^import\s[\s\S]*?;[ \t]*$/gm, "")
    .replace(/^\s+/, "")
    .trimEnd();
}

describe("copia da documentacao do desktop", () => {
  it("ignora imports de uma e de varias linhas", () => {
    const text = 'import type { A } from "a";\nimport {\n  B,\n  C\n} from "b";\n\nconst x = 1;\n';
    expect(withoutImports(text)).toBe("const x = 1;");
  });

  for (const file of COPIES) {
    const desktopFile = sourcePath(`../../../desktop/src/renderer/${file}`);
    const webFile = sourcePath(`./${file}`);

    it.skipIf(!existsSync(desktopFile))(`${file} e igual ao do desktop`, () => {
      const desktop = withoutImports(readFileSync(desktopFile, "utf8"));
      const web = withoutImports(readFileSync(webFile, "utf8"));
      expect(
        web === desktop,
        `apps/web/src/lib/${file} divergiu de apps/desktop/src/renderer/${file}: copie a correcao para os dois`
      ).toBe(true);
    });
  }
});
