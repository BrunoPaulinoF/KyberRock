import type { DesktopDatabase } from "../database/sqlite.js";
import { readStringLocalSetting, writeLocalSetting } from "./local-settings.js";

/**
 * Canal de atualizacao desta balanca.
 *
 * O `desktop-release.yml` deixa todo build PARADO como **rascunho** (draft) e o
 * `desktop-promote.yml` e quem publica:
 *
 *   rascunho              -> ninguem enxerga (nem teste, nem producao)
 *   publicado pre-release -> so as balancas neste canal (as de teste)
 *   publicado estavel     -> todas as balancas (producao)
 *
 * Quem decide o canal de cada balanca e o painel administrativo; o valor chega
 * pelo `desktop-status` e fica gravado aqui para sobreviver a reinicio e a
 * queda de internet.
 */
export type DesktopUpdateChannel = "latest" | "beta";

/** Canal de producao. Tudo que nao for reconhecido cai aqui, de proposito. */
export const DEFAULT_UPDATE_CHANNEL: DesktopUpdateChannel = "latest";

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
  /**
   * Unica alavanca que separa os dois aneis.
   *
   * `false` -> o updater pede `GET /releases/latest`, que o GitHub responde com
   *            a release estavel mais recente (pula rascunho E pre-release).
   * `true`  -> o updater lista `GET /releases`, descarta rascunho e prefere a
   *            pre-release mais nova — que e exatamente a versao em avaliacao.
   *
   * NAO existe aqui um campo `channel`, e a ausencia dele e deliberada. Ver o
   * bloco abaixo.
   */
  allowPrerelease: boolean;
}

/**
 * Traduz o canal da balanca para o unico ajuste que o `electron-updater`
 * respeita neste repositorio.
 *
 * ## Por que nao usamos `autoUpdater.channel`
 *
 * A primeira versao deste codigo definia `autoUpdater.channel = "beta"` e
 * publicava um `beta.yml` na release. Nao funcionava — e falhava em silencio,
 * que e o pior jeito de falhar num updater de frota.
 *
 * O KyberRock publica num repositorio **privado** (`private: true` no
 * `build.publish` do desktop) e injeta um token de leitura, entao o
 * `electron-updater` instancia o `PrivateGitHubProvider`. E o
 * `PrivateGitHubProvider` — ao contrario do `GitHubProvider` publico, que le
 * `updater.channel` — resolve o nome do metadado assim:
 *
 *     const channelFile = getChannelFilename(this.getDefaultChannelName())
 *
 * `getDefaultChannelName()` e fixo em `"latest"`. O valor de `updater.channel`
 * **nunca e lido**. Ou seja: num repo privado o updater so procura por
 * `latest.yml`, sempre, e um `beta.yml` na release e um arquivo que ninguem le.
 *
 * Ha ainda um segundo motivo, independente do primeiro: o setter de `channel`
 * do `AppUpdater` liga `allowDowngrade = true` como efeito colateral. Definir
 * `channel` — com QUALQUER valor, inclusive `"latest"` — autorizaria a balanca
 * a instalar uma versao mais VELHA que a instalada. Numa operacao de balanca
 * isso e regressao silenciosa de banco e de regra fiscal.
 *
 * Por isso o desktop nao toca em `channel`: o anel de teste inteiro se apoia em
 * `allowPrerelease`, e o metadado se chama `latest.yml` nos dois aneis.
 */
export function updaterChannelSettings(channel: DesktopUpdateChannel): UpdaterChannelSettings {
  return { allowPrerelease: channel === "beta" };
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
