/**
 * Contas do OMIE que ganham relatorio de movimentacao proprio no envio financeiro
 * (`companies.financial_bank_accounts`, editado na ficha da pedreira).
 *
 * O teto e o mesmo de `supabase/functions/_shared/omie-checking-accounts.ts`, repetido de
 * proposito: o site nao importa modulo Deno das Edge Functions. Quem decide de verdade e o
 * `admin-api`, que corta o excesso ao gravar; aqui o teto so trava a tela antes. Se um mudar,
 * mude os dois.
 */
export const MAX_BANK_MOVEMENT_ACCOUNTS = 6;

export interface BankAccountChoice {
  code: number;
  name: string;
}

/** Conta como o `admin-api` devolve do ListarContasCorrentes. */
export interface OmieCheckingAccountOption extends BankAccountChoice {
  type: string | null;
  inactive: boolean;
}

export interface BankAccountOption extends BankAccountChoice {
  /** Rotulo extra ("inativa no OMIE", "nao encontrada no OMIE"). */
  note: string | null;
}

/**
 * O que a tela lista para marcar. Antes de buscar no OMIE: so o que ja esta escolhido. Depois:
 * as contas do OMIE na ordem dele e, no fim, as escolhidas que o OMIE nao devolveu mais — para
 * poderem ser desmarcadas em vez de ficarem presas na escolha sem aparecer.
 */
export function bankAccountOptions(
  selected: readonly BankAccountChoice[],
  loaded: readonly OmieCheckingAccountOption[] | null
): BankAccountOption[] {
  if (loaded === null) return selected.map((account) => ({ ...account, note: null }));
  const loadedCodes = new Set(loaded.map((account) => account.code));
  return [
    ...loaded.map((account) => ({
      code: account.code,
      name: account.name,
      note: account.inactive ? "inativa no OMIE" : null
    })),
    ...selected
      .filter((account) => !loadedCodes.has(account.code))
      .map((account) => ({ ...account, note: "não encontrada no OMIE" }))
  ];
}

/** Marca ou desmarca uma conta, sem passar do teto e mantendo a ordem das opcoes. */
export function toggleBankAccount(
  selected: readonly BankAccountChoice[],
  options: readonly BankAccountChoice[],
  account: BankAccountChoice
): BankAccountChoice[] {
  const isSelected = selected.some((item) => item.code === account.code);
  if (!isSelected && selected.length >= MAX_BANK_MOVEMENT_ACCOUNTS) return [...selected];
  const next = isSelected
    ? selected.filter((item) => item.code !== account.code)
    : [...selected, { code: account.code, name: account.name }];
  const order = new Map(options.map((option, index) => [option.code, index]));
  return next.sort(
    (a, b) =>
      (order.get(a.code) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.code) ?? Number.MAX_SAFE_INTEGER)
  );
}
