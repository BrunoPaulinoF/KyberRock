import type { DesktopDatabase } from "../database/sqlite.js";
import { readStringLocalSetting, writeLocalSetting } from "./local-settings.js";

/**
 * Canal de atualizacao desta balanca.
 *
 * O `desktop-release.yml` deixa todo build PARADO (pre-release, com um metadado
 * de nome neutro que canal nenhum segue) e o `desktop-promote.yml` copia esse
 * metadado para o anel escolhido:
 *
 *   `beta.yml`   -> so as balancas neste canal (as de teste)
 *   `latest.yml` -> todas as demais (producao)
 *
 * Quem decide o canal de cada balanca e o painel administrativo; o valor chega
 * pelo `desktop-status` e fica gravado aqui para sobreviver a reinicio e a
 * queda de internet.
 */
export type DesktopUpdateChannel = "latest" | "beta";

/** Canal de producao. Tudo que nao for reconhecido cai aqui, de proposito. */
export const DEFAULT_UPDATE_CHANNEL: DesktopUpdateChannel = "latest";

export const DESKTOP_UPDATE_CHANNELS: readonly DesktopUpdateChannel[] = ["latest", "beta"];

export const UPDATE_CHANNEL_SETTING_KEY = "update_channel";

/**
 * Converte qualquer entrada no canal correspondente.
 *
 * **Nada que nao seja exatamente `beta` tira a balanca de producao.** Texto
 * vazio, `null`, erro de digitacao no painel, coluna que a nuvem ainda nao tem:
 * tudo vira `latest`. Falhar para o lado do canal estavel e a unica opcao
 * segura — um valor estranho jamais pode fazer uma balanca de cliente comecar a
 * receber versao em avaliacao.
 */
export function normalizeUpdateChannel(value: unknown): DesktopUpdateChannel {
  if (typeof value !== "string") return DEFAULT_UPDATE_CHANNEL;
  const normalized = value.trim().toLowerCase();
  return normalized === "beta" ? "beta" : DEFAULT_UPDATE_CHANNEL;
}

export interface UpdaterChannelSettings {
  /** Nome do arquivo de metadados que o `electron-updater` vai procurar. */
  channel: DesktopUpdateChannel;
  /**
   * O anel de teste vive DENTRO do pre-release: e isso que mantem a frota cega
   * para a versao em avaliacao. Sem `allowPrerelease`, a balanca de teste
   * ignoraria exatamente as releases que deveria enxergar.
   */
  allowPrerelease: boolean;
}

export function updaterChannelSettings(channel: DesktopUpdateChannel): UpdaterChannelSettings {
  return { channel, allowPrerelease: channel === "beta" };
}

export function readUpdateChannel(database: DesktopDatabase): DesktopUpdateChannel {
  return normalizeUpdateChannel(readStringLocalSetting(database, UPDATE_CHANNEL_SETTING_KEY));
}

/** Grava o canal ja normalizado e devolve o que ficou valendo. */
export function writeUpdateChannel(
  database: DesktopDatabase,
  value: unknown
): DesktopUpdateChannel {
  const channel = normalizeUpdateChannel(value);
  writeLocalSetting(database, UPDATE_CHANNEL_SETTING_KEY, channel);
  return channel;
}
