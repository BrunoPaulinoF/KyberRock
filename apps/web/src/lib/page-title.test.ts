import { describe, expect, it } from "vitest";

import { documentTitle, standaloneTitle } from "./page-title";

describe("documentTitle", () => {
  it("poe o nome da tela antes do nome do produto", () => {
    expect(documentTitle("Operações")).toBe("Operações · KyberRock");
  });

  it("sem tela conhecida fica so o nome do produto", () => {
    expect(documentTitle(null)).toBe("KyberRock");
    expect(documentTitle(undefined)).toBe("KyberRock");
    expect(documentTitle("  ")).toBe("KyberRock");
  });
});

describe("standaloneTitle", () => {
  it("da nome as telas que nao usam o menu lateral", () => {
    expect(standaloneTitle("/login")).toBe("Entrar");
    expect(standaloneTitle("/carregamento")).toBe("Fila de carregamento");
    expect(standaloneTitle("/monitoramento")).toBe("Monitoramento");
    expect(standaloneTitle("/admin")).toBe("Painel da plataforma");
    expect(standaloneTitle("/admin/login")).toBe("Entrar no painel");
    expect(standaloneTitle("/whatsapp/abc123")).toBe("Conectar WhatsApp");
  });

  it("deixa com a casca e com a pagina de apresentacao o que e delas", () => {
    expect(standaloneTitle("/")).toBeNull();
    expect(standaloneTitle("/operacoes")).toBeNull();
    expect(standaloneTitle("/cadastros/clientes")).toBeNull();
  });
});
