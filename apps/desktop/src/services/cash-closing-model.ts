/**
 * Tipos e rotulos do fechamento do caixa, sem dependencia de Node nem do banco: a tela
 * (`renderer/CashClosingView.tsx`) importa daqui. A conta vive em `cash-closing.ts`.
 */

export const NO_ACCOUNT_KEY = "sem-conta";

export interface CashClosingMethodLine {
  paymentMethodName: string;
  operations: number;
  totalCents: number;
}

export interface CashClosingAccount {
  /** Chave da conferencia: id da conta, ou `NO_ACCOUNT_KEY`. */
  key: string;
  accountName: string;
  /** O que deve ter entrado nesta conta no dia. */
  expectedCents: number;
  /** Vendas do dia recebidas na hora, por forma de pagamento. */
  sales: CashClosingMethodLine[];
  /** Fechamentos de carteira lancados no dia, recebidos na hora. */
  walletSettlements: CashClosingMethodLine[];
}

export type CashClosingReceivableKind = "boleto" | "a_prazo" | "carteira" | "fiado" | "sem_forma";

export interface CashClosingReceivable {
  kind: CashClosingReceivableKind;
  paymentMethodName: string;
  operations: number;
  totalCents: number;
}

export type CashClosingNoChargeKind = "bonificacao" | "adiantamento" | "sem_cobranca";

export interface CashClosingNoCharge {
  kind: CashClosingNoChargeKind;
  operations: number;
  totalCents: number;
}

export interface SavedCashClosing {
  countedCents: Record<string, number>;
  notes: string;
  savedAt: string;
}

export interface CashClosingReport {
  date: string;
  /** Vendas fechadas no dia (canceladas fora). */
  operations: number;
  netWeightKg: number;
  /** Total cobrado das vendas do dia. */
  soldCents: number;
  /** Soma do que deve ter entrado nas contas (inclui fechamento de carteira do dia). */
  receivedCents: number;
  receivableCents: number;
  noChargeCents: number;
  accounts: CashClosingAccount[];
  receivables: CashClosingReceivable[];
  noCharge: CashClosingNoCharge[];
  saved: SavedCashClosing | null;
}

export const RECEIVABLE_KIND_LABEL: Record<CashClosingReceivableKind, string> = {
  boleto: "Boleto",
  a_prazo: "Parcelas a prazo",
  carteira: "Em carteira",
  fiado: "Crédito do cliente (fiado)",
  sem_forma: "Sem forma de pagamento"
};

export const NO_CHARGE_KIND_LABEL: Record<CashClosingNoChargeKind, string> = {
  bonificacao: "Bonificação",
  adiantamento: "Pago com adiantamento do cliente",
  sem_cobranca: "Sem cobrança (SEM CLIENTE ou valor zero)"
};
