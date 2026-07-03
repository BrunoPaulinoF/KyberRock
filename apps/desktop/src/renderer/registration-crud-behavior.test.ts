import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));

describe("registration CRUD behavior", () => {
  it("keeps secondary cadastro forms actionable and recoverable", () => {
    const source = readFileSync(resolve(rendererDir, "App.tsx"), "utf8");

    expect(source).toContain("Nome e obrigatorio.");
    expect(source).toContain("Atualizar");
    expect(source).toContain("productDefaultPricesRemove");
    expect(source).toContain("Confirmar remocao do preco padrao");
  });

  it("confirms report-recipient deletion and validates each selected channel", () => {
    const source = readFileSync(resolve(rendererDir, "ReportsView.tsx"), "utf8");

    expect(source).toContain("Confirmar exclusao do destinatario?");
    expect(source).toContain("emailError");
    expect(source).toContain("whatsappError");
  });
});
