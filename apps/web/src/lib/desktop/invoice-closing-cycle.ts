/**
 * Vocabulario do ciclo de fechamento: os valores possiveis e os rotulos.
 *
 * Fica separado de `invoice-closing.ts` pelo mesmo motivo de
 * `weighing-billing-situation.ts`: a TELA precisa dos rotulos para montar os filtros, e o
 * servico do fechamento depende do SQLite — importar valor (nao tipo) de la levaria
 * `node:crypto` para dentro do bundle do renderer, que roda no navegador do Electron.
 * Este modulo e puro de proposito: nao importa banco, nao importa Node.
 *
 * Os tres valores sao os mesmos de `customers.credit_periodicity`, e nao por acaso: o
 * ciclo do fechamento E a periodicidade cadastrada no cliente. Uma lista propria aqui
 * acabaria divergindo da tela de Cadastros no primeiro ciclo novo.
 */

export type InvoiceClosingCycle = "biweekly" | "monthly" | "weekly";

export const INVOICE_CLOSING_CYCLES: readonly InvoiceClosingCycle[] = [
  "biweekly",
  "monthly",
  "weekly"
];

export const INVOICE_CLOSING_CYCLE_LABEL: Record<InvoiceClosingCycle, string> = {
  biweekly: "Quinzenal",
  monthly: "Mensal",
  weekly: "Semanal"
};

export function isInvoiceClosingCycle(value: unknown): value is InvoiceClosingCycle {
  return value === "biweekly" || value === "monthly" || value === "weekly";
}

/**
 * O vale como ele sai impresso no cupom ("000123"): e assim que o numero esta no papel que
 * o cliente guardou, e conferir 123 contra 000123 e trabalho a toa. Numeros ja maiores que
 * seis digitos saem inteiros — cortar seria pior que desalinhar.
 */
export function formatCouponNumber(code: number | null): string {
  return code === null ? "-" : String(code).padStart(6, "0");
}
