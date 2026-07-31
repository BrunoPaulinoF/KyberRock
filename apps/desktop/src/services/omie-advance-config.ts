import type { DesktopDatabase } from "../database/sqlite.js";
import { readLocalSetting, writeLocalSetting } from "./local-settings.js";

/**
 * Configuracao do adiantamento do cliente no OMIE.
 *
 * Por padrao o KyberRock descobre sozinho, pela descricao, quais categorias do
 * plano de contas sao de adiantamento e qual conta corrente guarda esse dinheiro
 * ("Adiantamento de Clientes", o padrao do OMIE). A deteccao por nome quebra
 * quando a pedreira renomeia a categoria, entao ela pode ser fixada aqui — o que
 * estiver configurado tem prioridade sobre a descoberta automatica.
 */
export interface OmieAdvanceConfig {
  /** Categorias que classificam um adiantamento de cliente (vazio = detectar). */
  categoryCodes: string[];
  /** Conta corrente de adiantamentos, nCodCC (null = detectar). */
  accountCode: number | null;
  /** Nome da conta escolhida, so para exibir na tela de configuracao. */
  accountName: string | null;
  /** True quando o operador fixou a configuracao (nao sobrescrever com deteccao). */
  manual: boolean;
}

export const OMIE_ADVANCE_CONFIG_SETTING_KEY = "omie.advanceConfig";

const EMPTY_CONFIG: OmieAdvanceConfig = {
  categoryCodes: [],
  accountCode: null,
  accountName: null,
  manual: false
};

export function readOmieAdvanceConfig(database: DesktopDatabase): OmieAdvanceConfig {
  const stored = readLocalSetting<Partial<OmieAdvanceConfig>>(
    database,
    OMIE_ADVANCE_CONFIG_SETTING_KEY
  );
  return normalizeOmieAdvanceConfig(stored);
}

export function writeOmieAdvanceConfig(
  database: DesktopDatabase,
  patch: Partial<OmieAdvanceConfig>,
  updatedAt: string = new Date().toISOString()
): OmieAdvanceConfig {
  const next = normalizeOmieAdvanceConfig({ ...readOmieAdvanceConfig(database), ...patch });
  writeLocalSetting(database, OMIE_ADVANCE_CONFIG_SETTING_KEY, next, updatedAt);
  return next;
}

/**
 * Guarda o que o OMIE devolveu na sincronizacao (categorias encontradas, conta
 * corrente usada na baixa) para os proximos ciclos irem diretos. Nunca sobrescreve
 * o que o operador fixou na tela: `manual` vence a deteccao.
 */
export function rememberDetectedAdvanceConfig(
  database: DesktopDatabase,
  detected: { categoryCodes?: string[]; accountCode?: number | null }
): OmieAdvanceConfig {
  const current = readOmieAdvanceConfig(database);
  if (current.manual) return current;

  const patch: Partial<OmieAdvanceConfig> = {};
  if (detected.categoryCodes?.length) patch.categoryCodes = detected.categoryCodes;
  if (detected.accountCode) patch.accountCode = detected.accountCode;
  if (Object.keys(patch).length === 0) return current;
  return writeOmieAdvanceConfig(database, patch);
}

export function normalizeOmieAdvanceConfig(
  value: Partial<OmieAdvanceConfig> | null | undefined
): OmieAdvanceConfig {
  if (!value || typeof value !== "object") return { ...EMPTY_CONFIG };
  const categoryCodes = Array.isArray(value.categoryCodes)
    ? [
        ...new Set(
          value.categoryCodes
            .map((code) => (typeof code === "string" ? code.trim() : ""))
            .filter((code) => code.length > 0)
        )
      ]
    : [];
  const accountCode =
    typeof value.accountCode === "number" && Number.isFinite(value.accountCode)
      ? Math.trunc(value.accountCode)
      : null;
  return {
    categoryCodes,
    accountCode: accountCode && accountCode > 0 ? accountCode : null,
    accountName: typeof value.accountName === "string" ? value.accountName.trim() || null : null,
    manual: value.manual === true
  };
}
