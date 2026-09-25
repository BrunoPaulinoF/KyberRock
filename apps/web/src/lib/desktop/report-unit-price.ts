import { formatBRL } from "./report-document.js";

/**
 * Valor por TONELADA de uma carga, a partir do total e do peso liquido.
 *
 * O comercial fecha a fatura conferindo dois numeros: o total e quanto ele deu por
 * tonelada. O segundo nao existia no arquivo — nem para o material, nem para o frete —, e
 * "entrar no cadastro do material para ver o preco" nao serve num fechamento de centenas
 * de cargas, cada uma podendo ter preco especial, tabela ou preco digitado a mao na
 * operacao.
 *
 * O valor e sempre DERIVADO do total da propria linha, e nao lido do cadastro: e o que de
 * fato foi cobrado naquela carga. Frete fixo ou por viagem tambem cai aqui, e o resultado
 * e o valor por tonelada EQUIVALENTE — que e justamente a pergunta ("quanto ficou a
 * tonelada nessa carga?").
 */

/** Centavos por tonelada. `null` quando nao ha peso: dividir por zero nao informa nada. */
export function centsPerTon(totalCents: number, netWeightKg: number): number | null {
  if (!Number.isFinite(totalCents) || !Number.isFinite(netWeightKg)) return null;
  if (netWeightKg <= 0) return null;
  return Math.round(totalCents / (netWeightKg / 1000));
}

/**
 * O mesmo valor pronto para a celula. Sem peso vira "-" (e nao "R$ 0,00/t", que se
 * somaria e se compararia como se fosse um preco de verdade).
 */
export function perTonLabel(totalCents: number, netWeightKg: number): string {
  const cents = centsPerTon(totalCents, netWeightKg);
  return cents === null ? "-" : `${formatBRL(cents)}/t`;
}
