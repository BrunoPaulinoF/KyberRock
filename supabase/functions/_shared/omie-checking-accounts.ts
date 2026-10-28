// Contas correntes do OMIE (ListarContasCorrentes) e a escolha, por pedreira, de
// quais delas ganham o proprio relatorio de movimentacao no envio financeiro
// (`companies.financial_bank_accounts`, migracao `202610280001`).
//
// Puro (sem Deno/fetch): usado pelo `financial-report-email`, que monta o
// relatorio, e pelo `admin-api`, que lista as contas e grava a escolha feita no
// painel. As duas pontas leem a mesma coluna, entao a normalizacao e uma so.

export interface OmieCheckingAccount {
  code: number;
  name: string;
  /** "CC" conta corrente, "CX" caixa, "AD" adiantamento, "CR" cartao... */
  type: string | null;
  inactive: boolean;
}

/** Conta escolhida para o relatorio por banco: o codigo (nCodCC) e o nome visto na escolha. */
export interface BankMovementAccount {
  code: number;
  name: string;
}

/**
 * Teto de contas por pedreira. Cada conta e uma chamada ListarExtrato com 3 s de
 * folga entre elas, dentro de uma Edge Function que ja consulta contas a pagar e
 * o extrato geral; sem teto, marcar tudo estouraria o tempo da funcao.
 */
export const MAX_BANK_MOVEMENT_ACCOUNTS = 6;

export const CHECKING_ACCOUNT_LIST_KEYS = [
  "ListarContasCorrentes",
  "conta_corrente_lista",
  "contaCorrenteLista"
] as const;

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function accountCode(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const code = Number(raw);
  return Number.isSafeInteger(code) && code > 0 ? code : null;
}

/**
 * Le o retorno do ListarContasCorrentes. A conta inativa vem em `inativo`
 * ("S"/"N") — o relatorio financeiro olhava `inativa`, campo que o OMIE nao
 * manda, e por isso nunca deixava conta nenhuma de fora.
 */
export function parseCheckingAccounts(response: Record<string, unknown>): OmieCheckingAccount[] {
  let rows: unknown[] = [];
  for (const key of CHECKING_ACCOUNT_LIST_KEYS) {
    const value = response?.[key];
    if (Array.isArray(value)) {
      rows = value;
      break;
    }
  }

  const accounts: OmieCheckingAccount[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const code = accountCode(item.nCodCC ?? item.codigo_conta_corrente);
    const name = text(item.descricao);
    if (code === null || name === null) continue;
    accounts.push({
      code,
      name,
      type: text(item.tipo_conta_corrente ?? item.tipo),
      inactive: [item.inativo, item.inativa].some((flag) => text(flag)?.toUpperCase() === "S")
    });
  }
  return accounts;
}

/**
 * Normaliza a escolha gravada (ou recebida do painel): so codigo valido, sem
 * repetir conta, nome aparado, no maximo `MAX_BANK_MOVEMENT_ACCOUNTS`. Qualquer
 * coisa que nao seja lista vira lista vazia — sem escolha, nada a mais e enviado.
 */
export function normalizeBankMovementAccounts(value: unknown): BankMovementAccount[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const accounts: BankMovementAccount[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const code = accountCode(item.code);
    if (code === null || seen.has(code)) continue;
    seen.add(code);
    accounts.push({ code, name: text(item.name) ?? `Conta ${code}` });
    if (accounts.length === MAX_BANK_MOVEMENT_ACCOUNTS) break;
  }
  return accounts;
}
