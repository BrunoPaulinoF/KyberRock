import { randomUUID } from "node:crypto";

import { invalidEmailsInList, normalizeEmailList } from "@kyberrock/shared";

import type { DesktopDatabase } from "../database/sqlite.js";
import { readStringLocalSetting, writeLocalSetting } from "./local-settings.js";
import { DOCUMENT_DIGITS_SQL, documentDigits } from "./customer-identity.js";
import {
  CLOSED_OPERATION_STATUS_SQL_LIST,
  OPEN_OPERATION_STATUS_SQL_LIST
} from "./weighing-operation-status.js";

/** Key do e-mail padrao de NF-e (usado quando o cliente nao tem e-mail proprio). */
export const DEFAULT_NFE_EMAIL_KEY = "default_nfe_email";

/**
 * O cadastro do cliente aceita quantos e-mails o operador quiser (NF-e, boleto, financeiro,
 * comprador...). Todos ficam no mesmo campo, separados por virgula — o formato que o OMIE
 * usa para mandar a nota e o boleto para todos os destinatarios.
 *
 * A normalizacao nao descarta endereco invalido: o formulario e quem avisa o operador, e
 * apagar o que ele digitou aqui esconderia o erro (e o OMIE recusaria o cadastro depois).
 */
export function normalizeCustomerEmails(value: string | null | undefined): string | null {
  const normalized = normalizeEmailList(value);
  return normalized.length > 0 ? normalized : null;
}

export interface CreateCustomerInput {
  companyId: string;
  tradeName: string;
  legalName: string;
  document?: string;
  phone?: string;
  email?: string;
  /** Destinatarios da NF-e (aba Fiscal). Lista separada por virgula; vazio = nenhum. */
  fiscalEmails?: string;
  creditLimitCents?: number;
  creditMode?: "normal" | "prepaid";
  omieBillingBlocked?: boolean;
  observations?: string;
  defaultCarrierId?: string;
  defaultPaymentTermId?: string;
  defaultPaymentMethodId?: string;
  creditAccountEnabled?: boolean;
  creditClosingDay?: number | null;
  creditBoletoDays?: number | null;
  nfRequired?: boolean;
  creditPeriodicity?: "monthly" | "biweekly" | "weekly";
  creditSecondClosingDay?: number | null;
  creditSecondBoletoDays?: number | null;
  creditClosingWeekday?: number | null;
  zipcode?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

export interface UpdateCustomerInput {
  tradeName?: string;
  legalName?: string;
  document?: string;
  phone?: string;
  email?: string;
  /** Destinatarios da NF-e (aba Fiscal). Lista separada por virgula; vazio limpa. */
  fiscalEmails?: string;
  /** null limpa o limite de credito; undefined mantem o valor atual. */
  creditLimitCents?: number | null;
  creditMode?: "normal" | "prepaid";
  omieBillingBlocked?: boolean;
  observations?: string;
  isActive?: boolean;
  defaultCarrierId?: string | null;
  defaultPaymentTermId?: string | null;
  defaultPaymentMethodId?: string | null;
  creditAccountEnabled?: boolean;
  creditClosingDay?: number | null;
  creditBoletoDays?: number | null;
  nfRequired?: boolean;
  creditPeriodicity?: "monthly" | "biweekly" | "weekly";
  creditSecondClosingDay?: number | null;
  creditSecondBoletoDays?: number | null;
  creditClosingWeekday?: number | null;
  zipcode?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
}

export interface CustomerRow {
  id: string;
  company_id: string;
  omie_customer_id: number | null;
  omie_integration_code: string | null;
  source: "omie" | "local" | "hybrid";
  legal_name: string;
  trade_name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  fiscal_emails: string | null;
  credit_limit_cents: number | null;
  credit_mode: "normal" | "prepaid";
  open_receivables_cents: number;
  omie_billing_blocked: number;
  observations: string | null;
  default_carrier_id: string | null;
  default_payment_term_id: string | null;
  default_payment_method_id: string | null;
  credit_account_enabled: number;
  credit_closing_day: number | null;
  credit_boleto_days: number | null;
  nf_required: number;
  credit_periodicity: "monthly" | "biweekly" | "weekly";
  credit_second_closing_day: number | null;
  credit_second_boleto_days: number | null;
  credit_closing_weekday: number | null;
  zipcode: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  financial_cache_at: string | null;
  sync_status: "synced" | "pending" | "error";
  needs_push: number;
  omie_updated_at: string | null;
  local_updated_at: string | null;
  last_synced_at: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Cliente ativo com o mesmo CNPJ/CPF na empresa, ignorando mascara. O documento
 * identifica o cliente no OMIE (find-or-create por CNPJ/CPF), entao dois cadastros
 * com o mesmo documento sao sempre o mesmo cliente — e virariam o mesmo cadastro la.
 */
/** Alias local de `documentDigits`: o mesmo criterio usado pelo sync e pelas telas. */
const onlyDigits = documentDigits;

export function findCustomerByDocument(
  database: DesktopDatabase,
  companyId: string,
  document: string,
  excludeId?: string
): { id: string; trade_name: string; legal_name: string; is_active: number } | null {
  const digits = onlyDigits(document);
  if (!digits) return null;
  const row = database
    .prepare(
      `SELECT id, trade_name, legal_name, is_active FROM customers
       WHERE company_id = ?
         AND deleted_at IS NULL
         AND ${DOCUMENT_DIGITS_SQL} = ?
         AND (? IS NULL OR id <> ?)
       LIMIT 1`
    )
    .get(companyId, digits, excludeId ?? null, excludeId ?? null) as
    | { id: string; trade_name: string; legal_name: string; is_active: number }
    | undefined;
  return row ?? null;
}

function assertDocumentIsFree(
  database: DesktopDatabase,
  companyId: string,
  document: string | null | undefined,
  excludeId?: string
): void {
  if (!document?.trim()) return;
  const existing = findCustomerByDocument(database, companyId, document, excludeId);
  if (!existing) return;
  const name = existing.trade_name?.trim() || existing.legal_name?.trim() || "sem nome";
  // Cliente inativo tambem e dono do documento. Sem dizer que ele esta inativo, o
  // operador procurava na lista, nao achava (a lista escondia os inativos) e ficava sem
  // entender por que o CNPJ/CPF estava ocupado.
  const inactiveHint =
    existing.is_active === 0
      ? " Ele esta inativo — procure por ele na lista de clientes e reative em vez de cadastrar de novo."
      : "";
  throw new Error(`Ja existe um cliente com este CNPJ/CPF: ${name}.${inactiveHint}`);
}

export function createCustomer(
  database: DesktopDatabase,
  input: CreateCustomerInput,
  now: Date = new Date()
): CustomerRow {
  // Sem esta trava, salvar o mesmo cadastro duas vezes (duplo clique, repetir o
  // cadastro sem procurar antes) criava dois clientes identicos na lista.
  assertDocumentIsFree(database, input.companyId, input.document);

  const id = randomUUID();
  const nowIso = now.toISOString();

  let defaultCarrierId = input.defaultCarrierId ?? null;

  if (!defaultCarrierId) {
    if (input.tradeName) {
      const carrierName = `${input.tradeName} (padrão)`;
      const existing = database
        .prepare("SELECT id FROM carriers WHERE company_id = ? AND name = ? AND deleted_at IS NULL")
        .get(input.companyId, carrierName) as { id: string } | undefined;

      if (existing) {
        defaultCarrierId = existing.id;
      } else {
        const carrierId = randomUUID();
        database
          .prepare(
            `INSERT INTO carriers (id, company_id, name, document, source, is_active, created_at, updated_at)
             VALUES (?, ?, ?, NULL, 'local', 1, ?, ?)`
          )
          .run(carrierId, input.companyId, carrierName, nowIso, nowIso);
        defaultCarrierId = carrierId;
      }
    }
  }

  database
    .prepare(
      `INSERT INTO customers (
        id, company_id, source, legal_name, trade_name, document, phone, email, fiscal_emails,
        credit_limit_cents, credit_mode, open_receivables_cents, omie_billing_blocked,
        observations, default_carrier_id, default_payment_term_id, default_payment_method_id,
        credit_account_enabled, credit_closing_day, credit_boleto_days, nf_required,
        credit_periodicity, credit_second_closing_day, credit_second_boleto_days, credit_closing_weekday,
        zipcode, address_street, address_number,
        address_complement, neighborhood, city, state, sync_status, needs_push, local_updated_at, is_active,
        created_at, updated_at
      ) VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, 1, ?, ?)`
    )
    .run(
      id,
      input.companyId,
      input.legalName,
      input.tradeName,
      input.document ?? null,
      input.phone ?? null,
      normalizeCustomerEmails(input.email),
      normalizeCustomerEmails(input.fiscalEmails),
      input.creditLimitCents ?? null,
      input.creditMode ?? "normal",
      input.omieBillingBlocked ? 1 : 0,
      input.observations ?? null,
      defaultCarrierId,
      input.defaultPaymentTermId ?? null,
      input.defaultPaymentMethodId ?? null,
      input.creditAccountEnabled ? 1 : 0,
      input.creditClosingDay ?? null,
      input.creditBoletoDays ?? null,
      input.nfRequired === false ? 0 : 1,
      input.creditPeriodicity ?? "monthly",
      input.creditSecondClosingDay ?? null,
      input.creditSecondBoletoDays ?? null,
      input.creditClosingWeekday ?? null,
      input.zipcode ?? null,
      input.addressStreet ?? null,
      input.addressNumber ?? null,
      input.addressComplement ?? null,
      input.neighborhood ?? null,
      input.city ?? null,
      input.state ?? null,
      nowIso,
      nowIso,
      nowIso
    );

  return database.prepare("SELECT * FROM customers WHERE id = ?").get(id) as CustomerRow;
}

export interface UpdateCustomerOptions {
  /**
   * Libera a edicao dos campos de cadastro que normalmente sao "propriedade do
   * OMIE" (endereco, e-mail, razao...). Usado para COMPLETAR o cadastro (busca por
   * CNPJ, e-mail padrao de NF-e, auto-complete no fechamento). Ao alterar um cliente
   * origem OMIE, ele vira 'hybrid' — assim o proximo sync empurra os campos ao OMIE
   * (o push filtra source IN ('local','hybrid')) e o faturamento la passa a funcionar.
   */
  overrideOmieFields?: boolean;
}

export function updateCustomer(
  database: DesktopDatabase,
  id: string,
  input: UpdateCustomerInput,
  now: Date = new Date(),
  options: UpdateCustomerOptions = {}
): CustomerRow {
  const existing = database
    .prepare("SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL")
    .get(id) as CustomerRow | undefined;

  if (!existing) {
    throw new Error("Cliente nao encontrado.");
  }

  if (existing.source === "omie" && !options.overrideOmieFields) {
    const protectedFields: Array<keyof UpdateCustomerInput> = [
      "tradeName",
      "legalName",
      "document",
      "phone",
      "email",
      "fiscalEmails",
      "creditLimitCents",
      "omieBillingBlocked",
      "zipcode",
      "addressStreet",
      "addressNumber",
      "addressComplement",
      "neighborhood",
      "city",
      "state"
    ];
    const changedProtectedField = protectedFields.some((field) => input[field] !== undefined);
    if (changedProtectedField) {
      throw new Error("Campos vindos do OMIE nao podem ser alterados localmente.");
    }
  }

  // So checa quando o documento MUDA: um cadastro que ja tem duplicata precisa
  // continuar editavel (ex.: ajustar o limite de credito) enquanto o usuario nao
  // apaga a copia.
  if (
    input.document !== undefined &&
    onlyDigits(input.document) !== onlyDigits(existing.document)
  ) {
    assertDocumentIsFree(database, existing.company_id, input.document, id);
  }

  const nowIso = now.toISOString();
  const sets: string[] = [];
  const values: unknown[] = [];

  // Cliente origem OMIE com edicao local de cadastro passa a 'hybrid' para o push
  // ao OMIE (que ignora source='omie') e para nao ser sobrescrito na proxima sync.
  if (existing.source === "omie" && options.overrideOmieFields) {
    sets.push("source = 'hybrid'");
  }

  if (input.legalName !== undefined) {
    sets.push("legal_name = ?");
    values.push(input.legalName);
  }
  if (input.tradeName !== undefined) {
    sets.push("trade_name = ?");
    values.push(input.tradeName);
  }
  if (input.document !== undefined) {
    sets.push("document = ?");
    values.push(input.document);
  }
  if (input.phone !== undefined) {
    sets.push("phone = ?");
    values.push(input.phone);
  }
  if (input.email !== undefined) {
    sets.push("email = ?");
    values.push(normalizeCustomerEmails(input.email));
  }
  if (input.fiscalEmails !== undefined) {
    sets.push("fiscal_emails = ?");
    values.push(normalizeCustomerEmails(input.fiscalEmails));
  }
  if (input.creditLimitCents !== undefined) {
    sets.push("credit_limit_cents = ?");
    values.push(input.creditLimitCents);
  }
  if (input.creditMode !== undefined) {
    sets.push("credit_mode = ?");
    values.push(input.creditMode);
  }
  if (input.omieBillingBlocked !== undefined) {
    sets.push("omie_billing_blocked = ?");
    values.push(input.omieBillingBlocked ? 1 : 0);
  }
  if (input.observations !== undefined) {
    sets.push("observations = ?");
    values.push(input.observations);
  }
  if (input.defaultCarrierId !== undefined) {
    sets.push("default_carrier_id = ?");
    values.push(input.defaultCarrierId);
  }
  if (input.defaultPaymentTermId !== undefined) {
    sets.push("default_payment_term_id = ?");
    values.push(input.defaultPaymentTermId);
  }
  if (input.defaultPaymentMethodId !== undefined) {
    sets.push("default_payment_method_id = ?");
    values.push(input.defaultPaymentMethodId);
  }
  if (input.creditAccountEnabled !== undefined) {
    sets.push("credit_account_enabled = ?");
    values.push(input.creditAccountEnabled ? 1 : 0);
  }
  if (input.creditClosingDay !== undefined) {
    sets.push("credit_closing_day = ?");
    values.push(input.creditClosingDay);
  }
  if (input.creditBoletoDays !== undefined) {
    sets.push("credit_boleto_days = ?");
    values.push(input.creditBoletoDays);
  }
  if (input.nfRequired !== undefined) {
    sets.push("nf_required = ?");
    values.push(input.nfRequired ? 1 : 0);
  }
  if (input.creditPeriodicity !== undefined) {
    sets.push("credit_periodicity = ?");
    values.push(input.creditPeriodicity);
  }
  if (input.creditSecondClosingDay !== undefined) {
    sets.push("credit_second_closing_day = ?");
    values.push(input.creditSecondClosingDay);
  }
  if (input.creditSecondBoletoDays !== undefined) {
    sets.push("credit_second_boleto_days = ?");
    values.push(input.creditSecondBoletoDays);
  }
  if (input.creditClosingWeekday !== undefined) {
    sets.push("credit_closing_weekday = ?");
    values.push(input.creditClosingWeekday);
  }
  if (input.zipcode !== undefined) {
    sets.push("zipcode = ?");
    values.push(input.zipcode);
  }
  if (input.addressStreet !== undefined) {
    sets.push("address_street = ?");
    values.push(input.addressStreet);
  }
  if (input.addressNumber !== undefined) {
    sets.push("address_number = ?");
    values.push(input.addressNumber);
  }
  if (input.addressComplement !== undefined) {
    sets.push("address_complement = ?");
    values.push(input.addressComplement);
  }
  if (input.neighborhood !== undefined) {
    sets.push("neighborhood = ?");
    values.push(input.neighborhood);
  }
  if (input.city !== undefined) {
    sets.push("city = ?");
    values.push(input.city);
  }
  if (input.state !== undefined) {
    sets.push("state = ?");
    values.push(input.state);
  }
  if (input.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(input.isActive ? 1 : 0);
  }

  if (sets.length === 0) {
    return existing;
  }

  sets.push("needs_push = 1");
  sets.push("local_updated_at = ?");
  values.push(nowIso);
  sets.push("updated_at = ?");
  values.push(nowIso);

  values.push(id);

  database.prepare(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?`).run(...values);

  return database.prepare("SELECT * FROM customers WHERE id = ?").get(id) as CustomerRow;
}

/** O que impede a exclusao de um cliente: dinheiro ainda presos nas pesagens dele. */
export interface CustomerDeletionBlock {
  /** Pesagens que ainda nao fecharam (`draft` ... `awaiting_exit`). */
  openCount: number;
  /** Pesagens ja concluidas que ninguem faturou ainda. */
  unbilledCount: number;
}

/**
 * O que trava a exclusao deste cliente — ou null quando nao ha nada travando.
 *
 * Duas perguntas, e as duas sao sobre dinheiro:
 *
 *  - Tem carga EM ANDAMENTO? Excluir no meio da operacao deixa um caminhao na balanca sem
 *    cliente na tela.
 *  - Tem carga CONCLUIDA e nao faturada? E exatamente o caso que motivou esta trava: a
 *    exclusao esconde o cadastro de todas as telas (o cache so carrega
 *    `deleted_at IS NULL`), e com ele some o filtro por onde o Fechamento chega naquelas
 *    pesagens. As cargas continuam no banco, mas ninguem as cobra.
 *
 * `billed` e a UNICA situacao que conta como faturada, igual a `resolveSituation` em
 * `weighing-billing-situation.ts` — la o retorno `billed` sai so de
 * `omie_billing_status === "billed"`, e e por isso que a comparacao aqui pode ser feita
 * direto em SQL. Se aquela regra ganhar outro caminho para `billed`, esta consulta tem de
 * acompanhar.
 *
 * `cancelled` fica de fora das duas contas de proposito (nao esta em nenhuma das duas
 * listas de status): carga cancelada nao vira nota e nao pode segurar um cadastro para
 * sempre. Pesagem ja excluida tambem nao conta.
 */
export function findCustomerDeletionBlock(
  database: DesktopDatabase,
  customerId: string
): CustomerDeletionBlock | null {
  const row = database
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN (${OPEN_OPERATION_STATUS_SQL_LIST}) THEN 1 ELSE 0 END) AS open_count,
         SUM(CASE WHEN status IN (${CLOSED_OPERATION_STATUS_SQL_LIST})
                   AND COALESCE(omie_billing_status, '') <> 'billed' THEN 1 ELSE 0 END) AS unbilled_count
       FROM weighing_operations
       WHERE customer_id = ? AND deleted_at IS NULL`
    )
    .get(customerId) as { open_count: number | null; unbilled_count: number | null } | undefined;

  const openCount = row?.open_count ?? 0;
  const unbilledCount = row?.unbilled_count ?? 0;
  if (openCount === 0 && unbilledCount === 0) return null;
  return { openCount, unbilledCount };
}

/** "3 pesagens em aberto e 12 concluidas sem faturar" — so as partes que existem. */
function describeDeletionBlock(block: CustomerDeletionBlock): string {
  const parts: string[] = [];
  if (block.openCount > 0) {
    parts.push(
      block.openCount === 1 ? "1 pesagem em aberto" : `${block.openCount} pesagens em aberto`
    );
  }
  if (block.unbilledCount > 0) {
    parts.push(
      block.unbilledCount === 1
        ? "1 pesagem concluida sem faturar"
        : `${block.unbilledCount} pesagens concluidas sem faturar`
    );
  }
  return parts.join(" e ");
}

/**
 * Exclui (logicamente) um cliente — se ele nao tiver pesagem pendente.
 *
 * A exclusao nunca apaga pesagem: ela so marca `deleted_at` no cadastro. O problema e que
 * o cadastro excluido some de todas as telas, e junto com ele some o caminho ate as cargas
 * dele no Fechamento. Por isso a trava: enquanto houver carga em aberto ou por faturar, a
 * saida certa e Inativar (o cadastro continua visivel e o CNPJ/CPF continua ocupado), nao
 * excluir.
 */
export function deleteCustomer(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): void {
  const existing = database
    .prepare("SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { id: string } | undefined;

  if (!existing) {
    throw new Error("Cliente nao encontrado.");
  }

  const block = findCustomerDeletionBlock(database, id);
  if (block) {
    throw new Error(
      `Este cliente tem ${describeDeletionBlock(block)}. ` +
        "Feche ou cancele as pesagens em aberto e fature as concluidas antes de excluir — " +
        "ou use Inativar, que tira o cliente do dia a dia sem esconder as cargas dele."
    );
  }

  const nowIso = now.toISOString();

  database
    .prepare(
      `UPDATE customers SET deleted_at = ?, updated_at = ?, needs_push = 1, local_updated_at = ? WHERE id = ?`
    )
    .run(nowIso, nowIso, nowIso, id);
}

/** Um cadastro excluido, do jeito que a tela de clientes lista para oferecer o Restaurar. */
export interface DeletedCustomerSummary {
  id: string;
  tradeName: string;
  legalName: string;
  document: string | null;
  source: "omie" | "local" | "hybrid";
  deletedAt: string;
}

/**
 * Os cadastros excluidos da empresa, do mais recente para o mais antigo.
 *
 * Le direto do SQLite em vez de passar pelo cache das telas de proposito: o cache existe
 * para alimentar os seletores do dia a dia, e cliente excluido nao pode reaparecer numa
 * lista de escolha — so nesta lista, que existe justamente para desfazer a exclusao.
 */
export function listDeletedCustomers(
  database: DesktopDatabase,
  companyId: string,
  limit = 100
): DeletedCustomerSummary[] {
  const rows = database
    .prepare(
      `SELECT id, trade_name, legal_name, document, source, deleted_at
       FROM customers
       WHERE company_id = ? AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC, trade_name ASC
       LIMIT ?`
    )
    .all(companyId, limit) as {
    id: string;
    trade_name: string;
    legal_name: string;
    document: string | null;
    source: "omie" | "local" | "hybrid";
    deleted_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    tradeName: row.trade_name,
    legalName: row.legal_name,
    document: row.document,
    source: row.source,
    deletedAt: row.deleted_at
  }));
}

/**
 * Desfaz a exclusao de um cliente — o cadastro volta a aparecer nas telas, com as pesagens
 * dele alcancaveis de novo pelo filtro do Fechamento.
 *
 * Nada precisa ser reconstruido: as pesagens nunca sairam do banco e continuam apontando
 * para este `customers.id`. Restaurar e so limpar o `deleted_at`.
 */
export function restoreCustomer(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): CustomerRow {
  const existing = database
    .prepare(
      "SELECT id, company_id, document, source FROM customers WHERE id = ? AND deleted_at IS NOT NULL"
    )
    .get(id) as
    | { id: string; company_id: string; document: string | null; source: string }
    | undefined;

  if (!existing) {
    throw new Error("Cliente nao encontrado ou nao esta excluido.");
  }

  // Enquanto esteve excluido, o CNPJ/CPF ficou livre (`findCustomerByDocument` ignora
  // excluidos) e alguem pode ter cadastrado o mesmo cliente de novo. Restaurar por cima
  // deixaria dois cadastros ativos com o mesmo documento — o duplicado que o OMIE recusa.
  assertDocumentIsFree(database, existing.company_id, existing.document, id);

  /*
   * `deleteCustomer` deixou `needs_push = 1`, mas essa marca nunca foi consumida: o envio
   * ao OMIE pula quem tem `deleted_at` preenchido. Para o cadastro que veio do OMIE ela
   * ainda por cima congela a linha — o push so olha `source IN ('local','hybrid')` e o
   * pull so reescreve quem esta com `needs_push = 0` —, entao a restauracao devolve esse
   * caso ao espelho da nuvem. Quem nasceu aqui continua pendente de envio, como era antes.
   */
  const needsPush = existing.source === "omie" ? 0 : 1;
  const nowIso = now.toISOString();

  database
    .prepare(
      `UPDATE customers
          SET deleted_at = NULL,
              needs_push = ?,
              sync_status = ?,
              updated_at = ?,
              local_updated_at = ?
        WHERE id = ?`
    )
    .run(needsPush, needsPush === 0 ? "synced" : "pending", nowIso, nowIso, id);

  return database.prepare("SELECT * FROM customers WHERE id = ?").get(id) as CustomerRow;
}

/** Le o e-mail padrao de NF-e configurado (ou null). */
export function getDefaultNfeEmail(database: DesktopDatabase): string | null {
  return readStringLocalSetting(database, DEFAULT_NFE_EMAIL_KEY);
}

/**
 * Grava (ou limpa, com string vazia) o e-mail padrao de NF-e. Aceita quantos enderecos o
 * operador quiser, separados por virgula, e valida cada um.
 */
export function setDefaultNfeEmail(database: DesktopDatabase, email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) {
    writeLocalSetting(database, DEFAULT_NFE_EMAIL_KEY, null);
    return null;
  }
  const invalid = invalidEmailsInList(trimmed);
  if (invalid.length > 0) {
    throw new Error(`E-mail padrao invalido: ${invalid.join(", ")}.`);
  }
  const normalized = normalizeEmailList(trimmed);
  writeLocalSetting(database, DEFAULT_NFE_EMAIL_KEY, normalized);
  return normalized;
}

/**
 * Define o e-mail de TODOS os clientes da empresa para o e-mail padrao (NF-e sempre
 * sai com um e-mail, sem depender do cadastro de cada cliente). O padrao pode ter varios
 * enderecos separados por virgula — todos vao para o OMIE. Tambem grava o valor
 * como e-mail padrao. Clientes origem OMIE viram 'hybrid' + needs_push=1 para o e-mail
 * ser empurrado ao OMIE. Retorna quantos clientes foram atualizados.
 */
export function applyDefaultNfeEmailToAllCustomers(
  database: DesktopDatabase,
  companyId: string,
  email: string,
  now: Date = new Date()
): number {
  const normalized = setDefaultNfeEmail(database, email);
  if (!normalized) {
    throw new Error("Informe um e-mail padrao valido antes de aplicar a todos.");
  }
  const nowIso = now.toISOString();
  const result = database
    .prepare(
      `UPDATE customers
       SET email = ?,
           source = CASE WHEN source = 'omie' THEN 'hybrid' ELSE source END,
           needs_push = 1,
           local_updated_at = ?,
           updated_at = ?
       WHERE company_id = ? AND deleted_at IS NULL
         AND (email IS NULL OR email != ?)`
    )
    .run(normalized, nowIso, nowIso, companyId, normalized);
  return result.changes;
}

export function listCustomers(database: DesktopDatabase, companyId: string): CustomerRow[] {
  return database
    .prepare(
      `SELECT * FROM customers
       WHERE company_id = ? AND deleted_at IS NULL
       ORDER BY trade_name ASC`
    )
    .all(companyId) as CustomerRow[];
}

export function getCustomersByCarrier(database: DesktopDatabase, carrierId: string): CustomerRow[] {
  return database
    .prepare(
      `SELECT * FROM customers
       WHERE default_carrier_id = ? AND deleted_at IS NULL AND is_active = 1
       ORDER BY trade_name ASC`
    )
    .all(carrierId) as CustomerRow[];
}
