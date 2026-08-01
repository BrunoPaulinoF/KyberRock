import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(rendererDir, "App.tsx"), "utf8");
const customersSource = readFileSync(resolve(rendererDir, "CustomersView.tsx"), "utf8");

describe("cadastro na hora pela Nova entrada", () => {
  it("abre os mesmos formularios da tela de Cadastros, sem modais reduzidos proprios", () => {
    // Os modais rapidos (nome + documento) foram trocados pelo cadastro completo.
    expect(appSource).not.toContain("QuickVehicleModal");
    expect(appSource).not.toContain("QuickDriverModal");
    expect(appSource).not.toContain("QuickCarrierModal");
    expect(appSource).not.toContain("QuickCustomerModal");

    for (const form of ["<VehicleCrud", "<DriverCrud", "<CarrierCrud", "<CustomersView"]) {
      expect(appSource).toContain(form);
    }
  });

  it("mantem o modo somente-formulario nos cadastros reaproveitados", () => {
    expect(appSource).toContain("standaloneForm?: StandaloneCrudFormOptions");
    expect(customersSource).toContain("standaloneForm?: StandaloneCustomerFormOptions");
  });

  it("mantem a busca por CNPJ no cadastro de transportadora", () => {
    // O botao vive na config de campos do CarrierCrud, entao ele acompanha o
    // formulario tambem quando a Nova entrada o abre.
    expect(appSource).toContain("<CarrierCnpjAutoFillButton");
    expect(appSource).toContain("desktopApi.lookupCnpj(digits)");
  });
});
