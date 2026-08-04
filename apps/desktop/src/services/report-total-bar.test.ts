import { describe, expect, it } from "vitest";

import { TOTAL_BAR_TITLE, renderTotalBar } from "./report-total-bar";

describe("barra de totais dos relatorios", () => {
  it("monta uma linha de tabela com titulo, rotulos e valores", () => {
    const bar = renderTotalBar([
      { label: "Carregamentos", value: "128" },
      { label: "Total", value: "R$ 412.900,00", emphasis: true }
    ]);

    expect(bar.startsWith("<table")).toBe(true);
    expect(bar).toContain(TOTAL_BAR_TITLE);
    expect(bar).toContain("Carregamentos");
    expect(bar).toContain("R$ 412.900,00");
    // Uma linha so: o Excel abre o `.xls` dos relatorios como celulas, e nao como
    // texto solto embaixo da planilha.
    expect(bar.match(/<tr>/g)).toHaveLength(1);
    expect(bar.match(/<td/g)).toHaveLength(3);
  });

  it("destaca apenas o valor marcado como principal", () => {
    const bar = renderTotalBar([
      { label: "Produto", value: "R$ 10,00" },
      { label: "Total", value: "R$ 30,00", emphasis: true }
    ]);

    expect(bar.match(/font-size:19px/g)).toHaveLength(1);
  });

  it("estiliza inline e nao depende de bloco style", () => {
    // O e-mail de fechamento diario nao tem `<style>` e cliente de e-mail costuma
    // descartar um; sem estilo inline a barra chegaria sem a faixa.
    const bar = renderTotalBar([{ label: "Total", value: "R$ 1,00", emphasis: true }]);

    expect(bar).toContain('style="width:100%');
    expect(bar).toContain("background:#1d4ed8");
    expect(bar).not.toContain("opacity");
  });

  it("escapa o conteudo vindo do cadastro", () => {
    const bar = renderTotalBar([{ label: 'Cliente "A" & <b>', value: "<script>" }]);

    expect(bar).toContain("Cliente &quot;A&quot; &amp; &lt;b&gt;");
    expect(bar).not.toContain("<script>");
  });
});
