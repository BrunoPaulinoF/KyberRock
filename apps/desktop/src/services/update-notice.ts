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
 * A balanca que ja esta na versao pedida nao precisa de recado nenhum — e ela
 * chega nesse estado antes de a nuvem apagar o aviso (o `desktop-status` so
 * limpa no ping seguinte a atualizacao). Sem esta conferencia, o operador
 * reabriria o app recem-atualizado e seria recebido por um pedido para
 * atualizar.
 */
export function shouldShowUpdateNotice(
  notice: DesktopUpdateNotice | null,
  installedVersion: string | null
): boolean {
  if (!notice) return false;
  return notice.version !== installedVersion;
}
