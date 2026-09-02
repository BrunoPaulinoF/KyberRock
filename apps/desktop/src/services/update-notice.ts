/**
 * Aviso de atualizacao pedido pelo painel, do lado da balanca.
 *
 * Quem esta no painel ve a frota espalhada em duas ou tres versoes (liberar nao
 * e instalar: a balanca baixa em segundo plano e so aplica quando o operador
 * fecha o app). Este aviso e o recado que faltava — chega pelo `desktop-status`,
 * no ping que ja existe, e sobe na tela do operador com o botao de atualizar
 * agora.
 *
 * O que ele deliberadamente NAO faz e instalar sozinho: aplicar a atualizacao
 * reinicia o app, e uma balanca no meio de uma pesagem nao pode ser reiniciada
 * por um clique que aconteceu em outra cidade. Quem decide a hora e quem esta na
 * balanca; a nuvem so avisa.
 *
 * Fica gravado localmente para sobreviver a reinicio e a queda de internet: o
 * recado que chegou as 8h continua valendo as 8h05, com a internet caida.
 */
import type { DesktopDatabase } from "../database/sqlite.js";
import { readLocalSetting, writeLocalSetting } from "./local-settings.js";

export const UPDATE_NOTICE_SETTING_KEY = "update_notice";

export interface DesktopUpdateNotice {
  /** Versao para a qual o painel chamou esta balanca. */
  version: string;
  /** Quando o painel disparou. `null` quando a nuvem nao mandou a data. */
  requestedAt: string | null;
}

/**
 * Le o aviso vindo da nuvem, aceitando so o que faz sentido mostrar.
 *
 * Uma "versao" fora de `MAJOR.MINOR.PATCH` viraria um recado que manda o
 * operador reiniciar a balanca em direcao a nada. Fora do formato vale
 * `null` — sem aviso e melhor que aviso errado.
 */
export function parseUpdateNotice(value: unknown): DesktopUpdateNotice | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { version?: unknown; requestedAt?: unknown };
  const version = typeof raw.version === "string" ? raw.version.trim().replace(/^v/, "") : "";
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  return {
    version,
    requestedAt: typeof raw.requestedAt === "string" ? raw.requestedAt : null
  };
}

export function readUpdateNotice(database: DesktopDatabase): DesktopUpdateNotice | null {
  return parseUpdateNotice(readLocalSetting(database, UPDATE_NOTICE_SETTING_KEY));
}

/**
 * Apaga o aviso gravado aqui, sem depender da nuvem.
 *
 * A nuvem apaga o recado no ping seguinte, e e assim que um aviso cancelado no
 * painel some. Mas o aviso que esta maquina NUNCA vai cumprir (ver
 * `shouldShowUpdateNotice`) nao pode ficar guardado esperando esse ping: ele
 * sobrevive a reinicio e a queda de internet, entao uma balanca sem rede
 * continuaria mostrando na abertura um pedido que ninguem mais quer.
 */
export function forgetUpdateNotice(database: DesktopDatabase, now: Date = new Date()): void {
  writeLocalSetting(database, UPDATE_NOTICE_SETTING_KEY, null, now.toISOString());
}

/** Compara versoes numero a numero: 0.8.9 < 0.8.10, que um compare de texto erra. */
function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Grava (ou apaga) o aviso que a nuvem acabou de mandar.
 *
 * `null` APAGA de proposito: e assim que um aviso ja atendido, ou cancelado no
 * painel, some da tela do operador. Campo AUSENTE (`undefined`) e outra coisa —
 * nuvem antiga, que nao conhece o recurso — e nesse caso o que esta gravado nao
 * e tocado.
 */
export function applyUpdateNoticeFromCloud(
  database: DesktopDatabase,
  value: unknown,
  now: Date = new Date()
): void {
  if (value === undefined) return;
  const notice = parseUpdateNotice(value);
  writeLocalSetting(database, UPDATE_NOTICE_SETTING_KEY, notice, now.toISOString());
}

/**
 * O aviso ainda vale para esta maquina?
 *
 * Vale so quando a versao pedida esta A FRENTE da instalada. Sao dois casos
 * diferentes, e os dois terminavam no mesmo aviso eterno:
 *
 * - JA CHEGOU na versao pedida: acontece antes de a nuvem apagar o aviso (o
 *   `desktop-status` so limpa no ping seguinte a atualizacao), e sem esta
 *   conferencia o app recem-atualizado abriria pedindo para atualizar.
 * - JA PASSOU da versao pedida: e o aviso disparado com a producao REGREDIDA.
 *   A balanca de producao nao volta atras (`allowDowngrade` fica desligado
 *   nela de proposito, ver `update-channel.ts`), entao "Atualizar agora" nao
 *   instalava nada, a versao pedida nunca era alcancada, a nuvem nunca apagava
 *   o recado e ele voltava a cada abertura do KyberRock — para sempre.
 *
 * Versao instalada desconhecida continua mostrando: nao saber onde a maquina
 * esta nao e motivo para engolir o recado.
 */
export function shouldShowUpdateNotice(
  notice: DesktopUpdateNotice | null,
  installedVersion: string | null
): boolean {
  if (!notice) return false;
  if (!installedVersion) return true;
  return compareVersions(notice.version, installedVersion) > 0;
}
