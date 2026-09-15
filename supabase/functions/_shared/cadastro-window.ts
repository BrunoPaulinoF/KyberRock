/**
 * A janela do pull incremental do cadastro — e por que ela NAO e o `updated_at`.
 *
 * O desktop puxa o cadastro das outras maquinas da pedreira a cada 15 s pedindo "so o que
 * mudou desde o meu ultimo pull". Enquanto esse recorte foi `updated_at`, ele respondia a
 * pergunta errada: `updated_at` e a hora da maquina que EDITOU o cadastro, e a linha so sai
 * de la na varredura completa dela, que roda a cada 30 min. Entre as duas coisas abria um
 * buraco definitivo:
 *
 *   10:00  o comercial cadastra o cliente        -> updated_at = 10:00 na maquina dele
 *   10:28  a varredura publica a linha           -> a nuvem grava updated_at = 10:00
 *   10:29  a expedicao faz o pull incremental    -> pede updated_at > 10:24 (cursor - folga)
 *
 * A linha de 10:00 nao entra nesse recorte, e o cursor da expedicao so anda para a frente:
 * ela nunca mais entraria. O cadastro so aparecia na varredura COMPLETA da expedicao (mais
 * 30 min, e ela pode estar desligada). Quando a diferenca passa da folga do cursor — cadastro
 * feito offline, computador que passou a noite fechado, relogio local atrasado — o caminho
 * rapido simplesmente nao entregava.
 *
 * `cloud_synced_at` e a hora da NUVEM no momento em que a linha foi gravada la (carimbada por
 * gatilho, migracao `202609150001_cadastro_cloud_arrival`, entao vale para toda escrita: o
 * desktop, o painel, o `omie-sync` e o tombstone da disputa de preco). Recortando por ela, "o
 * que mudou desde o meu ultimo pull" passa a querer dizer "o que chegou na nuvem desde entao",
 * que e a pergunta certa e nao depende do relogio de nenhum computador da pedreira.
 */

import { isUnknownColumnError, type PostgrestLikeError } from "./db-read-error.ts";

/** Quando a linha chegou NA NUVEM. O recorte do pull incremental. */
export const CADASTRO_ARRIVAL_COLUMN = "cloud_synced_at";

/** O recorte anterior, usado so enquanto a migracao nao estiver aplicada. */
export const CADASTRO_LEGACY_WINDOW_COLUMN = "updated_at";

/**
 * A coluna que recorta a consulta do cadastro, ou `null` para trazer tudo.
 *
 * Sem `cadastroSince` a chamada e a varredura completa: ela pede o cadastro inteiro de
 * proposito, e e ela que se auto-corrige quando um pull incremental deixou algo de fora.
 */
export function cadastroWindowColumn(
  cadastroSince: string | null,
  options: { legacy?: boolean } = {}
): string | null {
  if (!cadastroSince) return null;
  return options.legacy ? CADASTRO_LEGACY_WINDOW_COLUMN : CADASTRO_ARRIVAL_COLUMN;
}

/**
 * Vale refazer a consulta com a janela antiga?
 *
 * So quando a coluna nova ainda nao existe — a janela entre o deploy da funcao e a aplicacao
 * da migracao. Qualquer outra falha (tabela ausente, banco fora do ar) tem de continuar sendo
 * o aviso que ja era: refazer a consulta ali so dobraria a carga sobre quem ja caiu, e cair
 * para o recorte antigo escondendo um erro de verdade e pior do que o aviso.
 */
export function shouldRetryWithLegacyWindow(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  return isUnknownColumnError(error);
}
