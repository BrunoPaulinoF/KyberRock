/**
 * A janela do pull incremental do HISTORICO (pesagens, pedidos de carregamento e vias
 * impressas) — o mesmo conserto que `cadastro-window.ts` fez para o cadastro.
 *
 * O recorte era `updated_at`, a hora da maquina que EDITOU a pesagem, e o `desktop-sync` grava
 * esse valor como veio. Quando a mudanca demora mais que a folga do cursor (5 min) para chegar
 * na nuvem, ela cai fora da janela de quem ja puxou, e o cursor so anda para a frente:
 *
 *   12:56  a balanca cancela a carga            -> updated_at = 12:56
 *   13:00  o escritorio faz o pull incremental  -> pede updated_at > 12:55
 *   13:02  o cancelamento chega na nuvem        -> a nuvem grava updated_at = 12:56
 *   13:01+ o escritorio pede updated_at > 12:56 -> a linha de 12:56 nunca mais entra
 *
 * Para o escritorio a carga continuava concluida, e ela entrava no fechamento de frete do
 * transportador. `cloud_synced_at` e a hora da NUVEM na gravacao (gatilho da migracao
 * `202609230001_history_cloud_arrival`), entao "o que mudou desde o meu ultimo pull" passa a ser
 * "o que chegou aqui desde entao" — que nao depende de quanto o envio demorou nem do relogio de
 * nenhum computador da pedreira.
 */

import {
  CADASTRO_ARRIVAL_COLUMN,
  CADASTRO_LEGACY_WINDOW_COLUMN,
  shouldRetryWithLegacyWindow
} from "./cadastro-window.ts";

/** Quando a linha chegou NA NUVEM. O recorte do pull incremental do historico. */
export const HISTORY_ARRIVAL_COLUMN = CADASTRO_ARRIVAL_COLUMN;

/** O recorte anterior, usado so enquanto a migracao nao estiver aplicada. */
export const HISTORY_LEGACY_WINDOW_COLUMN = CADASTRO_LEGACY_WINDOW_COLUMN;

/**
 * A coluna que recorta a consulta do historico, ou `null` para trazer a janela recente
 * inteira (a varredura completa, que e a rede de seguranca do incremental).
 */
export function historyWindowColumn(
  historySince: string | null,
  options: { legacy?: boolean } = {}
): string | null {
  if (!historySince) return null;
  return options.legacy ? HISTORY_LEGACY_WINDOW_COLUMN : HISTORY_ARRIVAL_COLUMN;
}

/** So refaz a consulta com o recorte antigo quando o que falta e a coluna nova. */
export const shouldRetryHistoryWithLegacyWindow = shouldRetryWithLegacyWindow;
