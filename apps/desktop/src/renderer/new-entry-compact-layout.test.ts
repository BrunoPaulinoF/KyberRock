import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PAYMENT_CONDITION_FORMATS } from "./PaymentConditionLegend";

const rendererDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(rendererDir, "App.tsx"), "utf8");
const legendSource = readFileSync(resolve(rendererDir, "PaymentConditionLegend.tsx"), "utf8");
const searchPickerSource = readFileSync(resolve(rendererDir, "SearchPicker.tsx"), "utf8");

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `trecho nao encontrado: ${start}`).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to, `fim nao encontrado: ${end}`).toBeGreaterThan(-1);
  return source.slice(from, to);
}

/**
 * A Nova entrada cabe na tela sem rolagem: os tres cards nunca crescem alem da
 * altura livre. Estes testes prendem as decisoes que garantem isso — nenhuma delas
 * esconde campo, botao ou informacao, so muda a forma de apresentar.
 */
describe("Nova entrada compacta", () => {
  it("mantem todos os campos, botoes e avisos da entrada", () => {
    const entry = sliceBetween(
      appSource,
      "<section style={styles.entryShell}>",
      "{showVehicleModal"
    );

    for (const label of [
      'label="Cliente"',
      'label="Produto"',
      'label="Forma de pagamento"',
      'label="Condicao de pagamento"',
      'label="Transportadora"',
      'label="Placa"',
      'label="Motorista"'
    ]) {
      expect(entry).toContain(label);
    }

    for (const text of [
      "Peso para simular (kg)",
      "Enviar peso",
      "Capturar peso",
      "Limpar e voltar",
      "Reconectar balança",
      "+ Vincular transportadora",
      "+ Cadastrar motorista",
      "<FreightTypeChoice",
      "<FreightInvoiceChoice",
      "<PaymentConditionLegend",
      "<PriceDetailsPanel"
    ]) {
      expect(entry).toContain(text);
    }
  });

  it("desenha o cabecalho em uma faixa so, com o peso simulado ao lado do titulo", () => {
    const hero = sliceBetween(appSource, "<div style={styles.entryHero}>", "{formError ?");

    // O envio do peso virtual mora na coluna do titulo (uma linha: rotulo, campo e
    // botao), e nao mais numa terceira faixa embaixo do cabecalho.
    expect(hero).toContain("Peso para simular (kg)");
    expect(hero).not.toContain('marginTop: "12px"');
    expect(hero.indexOf("Peso para simular (kg)")).toBeLessThan(
      hero.indexOf("styles.liveWeightCard")
    );
  });

  it("recolhe a tabela de formatos da condicao de pagamento sem perder nenhum deles", () => {
    expect(legendSource).toContain("<details>");
    expect(legendSource).toContain("<summary");
    expect(legendSource).toContain("Como escrever");
    // A previa (o que responde ao que esta sendo digitado) fica fora do recolhido.
    expect(legendSource.indexOf("{preview.message}")).toBeLessThan(
      legendSource.indexOf("<details>")
    );
    expect(PAYMENT_CONDITION_FORMATS).toHaveLength(10);
  });

  it("prende os campos a largura da coluna do card", () => {
    // O <input> carrega uma largura minima de ~20 caracteres. Sem `minWidth: 0` +
    // `width: 100%` a dupla Placa/Motorista estourava o card e ele ganhava barra de
    // rolagem horizontal.
    const inputStyle = sliceBetween(appSource, "\n  input: {", "\n  },");
    expect(inputStyle).toContain("minWidth: 0");

    // O campo de escolha de cadastro agora e o `SearchPicker`, e a garantia vale la: o
    // input ocupa a largura toda e o container que o segura pode encolher.
    const pickerInput = sliceBetween(searchPickerSource, 'role="combobox"', "/>");
    expect(pickerInput).toContain('width: "100%"');

    // E o CacheSelect segura o picker num container que PODE encolher: sem `minWidth: 0`
    // o input volta a impor a largura de ~20 caracteres e estoura a coluna do card.
    const cacheSelectSlot = sliceBetween(appSource, "function CacheSelect({", "\n}\n");
    expect(cacheSelectSlot).toContain("<SearchPicker");
    expect(cacheSelectSlot).toContain("style={{ flex: 1, minWidth: 0 }}");
  });

  it("mantem as tres colunas dentro da largura da coluna de conteudo", () => {
    const grid = sliceBetween(appSource, "\n  entryGrid: {", "\n  },");
    const mins = [...grid.matchAll(/minmax\((\d+)px/g)].map((match) => Number(match[1]));
    const gaps = 2 * 8;

    expect(mins).toHaveLength(3);
    // A coluna de conteudo de uma janela de 1116px de largura util (a da tela que
    // motivou este ajuste) precisa caber os tres cards: acima disso o ultimo card
    // era cortado, porque contentBody esconde o transbordo horizontal.
    expect(mins.reduce((total, min) => total + min, 0) + gaps).toBeLessThanOrEqual(1116);
  });
});
