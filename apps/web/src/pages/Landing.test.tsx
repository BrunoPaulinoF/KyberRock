import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AuthProvider } from "../lib/auth";
import { DESKTOP_DOWNLOAD_URL, GUIDE_PDF_URL } from "../lib/marketing";
import { Landing } from "./Landing";

/** A pagina inteira, como o servidor a desenharia (sem efeitos: nada de rede nem relogio). */
function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AuthProvider>
        <Landing />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("Landing", () => {
  const html = render();

  it("deixa quem ja e cliente entrar sem sair da pagina", () => {
    expect(html).toContain('id="entrar"');
    expect(html).toContain("Já é cliente?");
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
  });

  it("chama para a demonstracao pelo WhatsApp", () => {
    expect(html).toContain("Quero uma demonstração");
    expect(html).toContain("https://wa.me/");
  });

  it("oferece o instalador do desktop e o guia em PDF, como o loader-web oferecia", () => {
    expect(html).toContain(`href="${DESKTOP_DOWNLOAD_URL}"`);
    expect(html).toContain(`href="${GUIDE_PDF_URL}"`);
  });

  it("todo link do menu leva a uma secao que existe", () => {
    const anchors = [...html.matchAll(/href="#([a-z-]+)"/g)].map((match) => match[1]);
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of new Set(anchors)) {
      expect(html, `#${anchor}`).toContain(`id="${anchor}"`);
    }
  });

  it("responde as duvidas de quem esta avaliando", () => {
    expect(html).toContain("Precisa de internet para pesar?");
    expect(html).toContain("Funciona com a minha balança?");
  });
});
