import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));

function read(file: string): string {
  return readFileSync(resolve(rendererDir, file), "utf8");
}

describe("record detail view (duplo clique nos cadastros)", () => {
  it("DataTable expoe onRowOpen com duplo clique e Enter, ignorando alvos interativos", () => {
    const source = read("crud-ui.tsx");

    expect(source).toContain("onRowOpen?: (row: T) => void");
    expect(source).toContain("onDoubleClick");
    expect(source).toContain("isInteractiveTarget");
    expect(source).toContain('event.key === "Enter"');
    expect(source).toContain("Duplo clique para visualizar");
  });

  it("RecordDetailModal e read-only com transicao para o modal de edicao", () => {
    const source = read("crud-ui.tsx");

    expect(source).toContain("export function RecordDetailModal");
    expect(source).toContain("Fechar");
    expect(source).toContain('editLabel = "Editar"');
    // Valores vazios nunca somem: viram travessao.
    expect(source).toContain("detailDisplayValue");
  });

  it("cadastros genericos e clientes abrem a visualizacao pela linha", () => {
    const app = read("App.tsx");
    const customers = read("CustomersView.tsx");

    expect(app).toContain("RecordDetailModal");
    expect(app).toContain("onRowOpen={(item) => void openView(item)}");
    expect(customers).toContain("RecordDetailModal");
    expect(customers).toContain("onRowOpen={(customer) => setViewingCustomer(customer)}");
    expect(customers).toContain("buildCustomerDetailSections");
  });
});

describe("confirmacoes e protecao do formulario", () => {
  it("nenhuma tela do renderer usa window.confirm nativo", () => {
    for (const file of [
      "App.tsx",
      "CustomersView.tsx",
      "ReportsView.tsx",
      "ReportChannelsSettings.tsx"
    ]) {
      expect(read(file), `${file} deve usar o ConfirmDialog estilizado`).not.toContain(
        "window.confirm"
      );
    }
  });

  it("fechar formulario com alteracoes pede confirmacao antes de descartar", () => {
    const app = read("App.tsx");
    const customers = read("CustomersView.tsx");

    expect(app).toContain("Descartar alteracoes?");
    expect(app).toContain("formBaselineRef");
    expect(customers).toContain("Descartar alteracoes?");
    expect(customers).toContain("formBaselineRef");
  });

  it("modal de formulario foca o primeiro campo editavel ao abrir", () => {
    const source = read("CrudFormModal.tsx");

    expect(source).toContain("firstField?.focus()");
  });
});
