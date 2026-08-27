import { describe, expect, it } from "vitest";

import { formatBRL } from "./report-document";
import { centsPerTon, perTonLabel } from "./report-unit-price";

describe("valor por tonelada nos relatorios", () => {
  it("divide o total pelas toneladas da propria carga", () => {
    // 28.310 kg por R$ 1.189,02 -> R$ 42,00/t
    expect(centsPerTon(118902, 28310)).toBe(4200);
    // O separador entre "R$" e o numero e o espaco NAO separavel do pt-BR: comparar com um
    // espaco comum reprovaria um texto que esta certo.
    expect(perTonLabel(118902, 28310)).toBe(`${formatBRL(4200)}/t`);
  });

  // Frete fixo ou por viagem nao tem "preco por tonelada" no cadastro. O que o fechamento
  // pergunta e quanto ficou a tonelada NAQUELA carga, e isso a divisao responde.
  it("converte frete fixo no valor por tonelada equivalente", () => {
    // R$ 500,00 de frete fechado numa carga de 25 t -> R$ 20,00/t.
    expect(centsPerTon(50000, 25000)).toBe(2000);
  });

  it("arredonda para o centavo", () => {
    // R$ 1.000,00 em 30 t -> R$ 33,3333.../t, gravado como R$ 33,33/t.
    expect(centsPerTon(100000, 30000)).toBe(3333);
  });

  // "R$ 0,00/t" seria somado e comparado como se fosse preco; "-" diz que nao ha conta.
  it("sem peso nao inventa preco", () => {
    expect(centsPerTon(118902, 0)).toBeNull();
    expect(centsPerTon(118902, -10)).toBeNull();
    expect(perTonLabel(118902, 0)).toBe("-");
  });

  it("carga sem frete sai zerada, e nao vazia", () => {
    expect(centsPerTon(0, 28310)).toBe(0);
    expect(perTonLabel(0, 28310)).toBe(`${formatBRL(0)}/t`);
    expect(perTonLabel(0, 28310)).toMatch(/^R\$.0,00\/t$/);
  });

  it("ignora numero invalido em vez de propagar NaN para a planilha", () => {
    expect(centsPerTon(Number.NaN, 28310)).toBeNull();
    expect(centsPerTon(118902, Number.NaN)).toBeNull();
  });
});
