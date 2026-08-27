import {
  CUSTOMER_COMMERCIAL_PUBLISHED_AT_COLUMN,
  type PriceAuthorityMode
} from "./price-authority.js";

/**
 * Quem manda no bloco COMERCIAL e de CREDITO do cadastro do cliente quando a projecao da
 * nuvem e gravada no SQLite.
 *
 * O bloco e a aba Comercial inteira menos o que ja tem outro dono: forma de pagamento
 * padrao, transportadora padrao, "exige nota fiscal", uso de credito OMIE e toda a
 * configuracao da conta de credito (habilitada, periodicidade, dias de fechamento e de
 * vencimento). Ate esta versao nada disso saia do SQLite de cada balanca — o mesmo cliente
 * podia ter credito habilitado num computador e nao no outro.
 *
 * A decisao mora aqui, separada do SQL, porque ela tem tres desfechos e nenhum e obvio:
 *
 * - **principal**: nunca aceita o bloco da nuvem. Ela e a dona; o que esta la e o eco do
 *   proprio push dela, ou — na janela entre a eleicao e a republicacao — o bloco que outra
 *   balanca publicou antes de haver dona. Aceitar esse segundo caso faria a principal
 *   adotar justamente a configuracao que ela deveria estar corrigindo.
 * - **secundaria**: aceita sempre que o bloco tiver sido publicado, inclusive por cima de
 *   edicao local ainda nao enviada (`needs_push`). E o mesmo combinado do preco: o que ela
 *   digitou aqui nao e publicado, entao valeria ate o proximo pull e sumiria depois.
 * - **sem principal eleita**: o comportamento de sempre do cadastro compartilhado — a
 *   projecao vence, menos quando ha edicao local ainda nao enviada, que e mais nova.
 *
 * E em todos os tres: bloco NAO publicado nao muda nada. Ver
 * `CUSTOMER_COMMERCIAL_PUBLISHED_AT_COLUMN`.
 */
export function shouldApplyCloudCommercialBlock(input: {
  mode: PriceAuthorityMode;
  /** A linha como veio do `desktop-pull`. */
  cloudRow: Record<string, unknown>;
  /** A linha local tem edicao ainda nao enviada ao OMIE. */
  localNeedsPush: boolean;
}): boolean {
  if (!isCommercialBlockPublished(input.cloudRow)) return false;
  if (input.mode === "master") return false;
  if (input.mode === "follower") return true;
  return !input.localNeedsPush;
}

/**
 * A nuvem ja tem o bloco comercial desta linha?
 *
 * Duas perguntas em uma, e as duas precisam da mesma resposta "nao":
 *
 * - a coluna nem veio (`desktop-pull` de um projeto onde a migracao ainda nao rodou);
 * - a coluna veio nula, que e toda linha que existia antes desta versao e ainda nao foi
 *   republicada.
 *
 * Nos dois casos o nulo das demais colunas do bloco nao quer dizer "vazio", quer dizer
 * "nao sei" — e gravar esse "nao sei" apagaria a configuracao boa que a balanca ja tem.
 * Depois que a marca existe, o nulo passa a ser informacao legitima: e assim que a
 * principal LIMPA uma transportadora padrao nas demais maquinas.
 */
export function isCommercialBlockPublished(cloudRow: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(cloudRow, CUSTOMER_COMMERCIAL_PUBLISHED_AT_COLUMN)) {
    return false;
  }
  const value = cloudRow[CUSTOMER_COMMERCIAL_PUBLISHED_AT_COLUMN];
  return typeof value === "string" && value.trim().length > 0;
}

export const CREDIT_PERIODICITIES = ["monthly", "biweekly", "weekly"] as const;
export type CreditPeriodicity = (typeof CREDIT_PERIODICITIES)[number];

export const CREDIT_MODES = ["normal", "prepaid"] as const;
export type CreditMode = (typeof CREDIT_MODES)[number];

/**
 * Periodicidade valida, ou o valor local.
 *
 * As duas colunas tem CHECK no SQLite. Um valor fora da lista chegando da nuvem derrubaria
 * a gravacao do cliente, e `applySection` transformaria isso em "nenhum cliente entrou
 * neste pull" — uma balanca cega para o cadastro inteiro por causa de uma linha. Cair no
 * valor local e o desfecho conservador.
 */
export function normalizeCreditPeriodicity(
  value: unknown,
  fallback: CreditPeriodicity
): CreditPeriodicity {
  return CREDIT_PERIODICITIES.includes(value as CreditPeriodicity)
    ? (value as CreditPeriodicity)
    : fallback;
}

export function normalizeCreditMode(value: unknown, fallback: CreditMode): CreditMode {
  return CREDIT_MODES.includes(value as CreditMode) ? (value as CreditMode) : fallback;
}

/**
 * Campos da aba Comercial cujo dono e a balanca principal, do jeito que a tela e o IPC os
 * nomeiam (camelCase) e do jeito que a linha do SQLite os guarda (snake_case).
 *
 * Os dois nomes ficam lado a lado porque a checagem compara justamente um com o outro: o
 * que a tela mandou contra o que ja esta gravado.
 */
export const MASTERED_CUSTOMER_FIELDS = [
  { input: "defaultPaymentMethodId", column: "default_payment_method_id", kind: "id" },
  { input: "defaultCarrierId", column: "default_carrier_id", kind: "id" },
  { input: "nfRequired", column: "nf_required", kind: "boolean" },
  { input: "creditMode", column: "credit_mode", kind: "text" },
  { input: "creditAccountEnabled", column: "credit_account_enabled", kind: "boolean" },
  { input: "creditPeriodicity", column: "credit_periodicity", kind: "text" },
  { input: "creditClosingDay", column: "credit_closing_day", kind: "number" },
  { input: "creditSecondClosingDay", column: "credit_second_closing_day", kind: "number" },
  { input: "creditBoletoDays", column: "credit_boleto_days", kind: "number" },
  { input: "creditSecondBoletoDays", column: "credit_second_boleto_days", kind: "number" },
  { input: "creditClosingWeekday", column: "credit_closing_weekday", kind: "number" }
] as const;

/**
 * Quais campos com dono a edicao MUDARIA — vazio quando ela nao encosta em nenhum.
 *
 * A pergunta e essa, e nao "a edicao menciona algum campo com dono", porque a tela salva o
 * formulario INTEIRO de uma vez: corrigir o telefone do cliente numa balanca secundaria
 * manda junto a forma de pagamento padrao e a configuracao de credito, iguais as que ja
 * estao gravadas. Recusar por mencao travaria o cadastro inteiro na secundaria — que e
 * exatamente o que ela precisa continuar podendo fazer.
 *
 * Campo ausente da edicao (`undefined`) nao e comparado: quem nao mandou nao mudou.
 */
export function findChangedMasteredCustomerFields(
  existing: Record<string, unknown>,
  input: Record<string, unknown>
): string[] {
  const changed: string[] = [];
  for (const field of MASTERED_CUSTOMER_FIELDS) {
    if (input[field.input] === undefined) continue;
    const next = normalizeMasteredValue(input[field.input], field.kind);
    const current = normalizeMasteredValue(existing[field.column], field.kind);
    if (next !== current) changed.push(field.input);
  }
  return changed;
}

/**
 * Os dois lados na mesma forma antes de comparar. Sem isto a comparacao acusaria mudanca
 * onde nao ha: a tela manda `true`/`""` e o SQLite guarda `1`/`NULL`, e "sem forma de
 * pagamento padrao" chega como string vazia de um lado e nulo do outro.
 */
function normalizeMasteredValue(
  value: unknown,
  kind: "id" | "boolean" | "text" | "number"
): string {
  if (kind === "boolean") return value ? "1" : "0";
  if (kind === "number") {
    if (value === null || value === undefined || value === "") return "";
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(Math.trunc(parsed)) : "";
  }
  const text =
    typeof value === "string"
      ? value.trim()
      : value === null || value === undefined
        ? ""
        : String(value);
  return text;
}
