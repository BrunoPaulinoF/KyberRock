import type { DesktopDatabase } from "../database/sqlite.js";
import { getDefaultNfeEmail } from "./customers.js";

/**
 * O que o OMIE exige no cadastro do cliente para a operacao conseguir sair daqui —
 * conferido na ABERTURA, nao no fechamento.
 *
 * Por que na abertura: o fechamento acontece com o caminhao carregado em cima da balanca.
 * Recusar ali seria pior que o problema (a operacao TEM que fechar local — e o principio
 * offline-first), entao a unica hora em que dizer "nao" ainda e barato e antes do caminhao
 * entrar. Foi o que faltou no caso que originou esta regra: cliente novo sem endereco, o
 * OMIE aceitou criar o cadastro (razao social + CNPJ/CPF bastam no IncluirCliente) e
 * recusou o PEDIDO, porque o destinatario da NF-e precisa do endereco inteiro. A venda
 * ficou pesada, impressa e sem pedido no OMIE.
 *
 * Regra do bloqueio, deliberadamente estreita — travar a balanca a toa custa mais caro que
 * o problema que a trava evita:
 *
 *  1. **So cliente que ainda nao existe no OMIE.** Com codigo OMIE o cadastro que o pedido
 *     usa e o de la, e o espelho local pode estar vazio por motivos que nada tem a ver com
 *     o OMIE (ver `evaluateOmieCustomerReadiness`).
 *  2. **So campo que o OMIE exige.** Telefone e complemento ficam de fora.
 *  3. **So na abertura.** Nunca no fechamento.
 */

export type OmieCustomerFieldKey =
  | "document"
  | "email"
  | "zipcode"
  | "addressStreet"
  | "addressNumber"
  | "neighborhood"
  | "city"
  | "state";

export const OMIE_CUSTOMER_FIELD_LABELS: Record<OmieCustomerFieldKey, string> = {
  document: "CNPJ/CPF",
  email: "E-mail",
  zipcode: "CEP",
  addressStreet: "Endereco",
  addressNumber: "Numero",
  neighborhood: "Bairro",
  city: "Cidade",
  state: "Estado (UF)"
};

/** Tipo da operacao como ela e escolhida na entrada. */
export type OmieReadinessOperationType = "invoice" | "internal";

/**
 * Sem CNPJ/CPF o OMIE nao cadastra o cliente e o fechamento nem chega a gerar job
 * (`buildOmieBillingJob` devolve null). Vale para os DOIS tipos de operacao.
 */
const ALWAYS_REQUIRED: readonly OmieCustomerFieldKey[] = ["document"];

/**
 * Venda com nota: alem do documento, o bloco do destinatario da NF-e. O OMIE aceita criar
 * o cliente sem esses campos (o edge remove os vazios do payload) e recusa depois, no
 * pedido — por isso eles precisam ser cobrados aqui, e nao no cadastro do cliente.
 */
const INVOICE_REQUIRED: readonly OmieCustomerFieldKey[] = [
  "document",
  "email",
  "zipcode",
  "addressStreet",
  "addressNumber",
  "neighborhood",
  "city",
  "state"
];

/**
 * Campos exigidos pelo tipo de operacao. A operacao interna vira ordem de servico, nao
 * emite NF-e: cobrar endereco dela travaria a balanca por um dado que o OMIE nao pede.
 */
export function omieRequiredCustomerFields(
  operationType: OmieReadinessOperationType
): readonly OmieCustomerFieldKey[] {
  return operationType === "invoice" ? INVOICE_REQUIRED : ALWAYS_REQUIRED;
}

/** Cadastro do cliente na forma que a regra le — sem depender do SQLite. */
export interface OmieCustomerCadastro {
  /**
   * Codigo do cliente no OMIE. Quando existe, o cadastro que o pedido usa mora LA: o
   * fechamento envia `customerOmieId` e o edge nem olha para o bloco local (ver
   * `buildOmieBillingJob`). Ver `evaluateOmieCustomerReadiness` para o porque disso
   * dispensar a conferencia.
   */
  omieCustomerId: number | null;
  document: string | null;
  email: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  /** `omie` = cadastro governado pelo OMIE: a correcao local exige override. */
  source: string | null;
}

export interface OmieCustomerReadiness {
  ready: boolean;
  /** Campos exigidos pelo OMIE ainda em branco, na ordem em que o operador preenche. */
  missing: OmieCustomerFieldKey[];
  missingLabels: string[];
  /** Cadastro do OMIE: avisa que a correcao tambem precisa subir para la. */
  omieOwned: boolean;
  /** Frase pronta para a tela e para o erro da abertura. Null quando esta tudo certo. */
  message: string | null;
}

const READY: OmieCustomerReadiness = {
  ready: true,
  missing: [],
  missingLabels: [],
  omieOwned: false,
  message: null
};

/**
 * Confere o cadastro contra o que o OMIE exige para esse tipo de operacao.
 *
 * `defaultNfeEmail` cobre o e-mail: quando a unidade tem e-mail padrao de NF-e, o
 * fechamento ja preenche o do cliente sozinho (`autoCompleteCustomerForNfe`) — cobrar o
 * campo aqui bloquearia a balanca por algo que o sistema resolve.
 */
export function evaluateOmieCustomerReadiness(
  cadastro: OmieCustomerCadastro | null,
  operationType: OmieReadinessOperationType,
  options: { defaultNfeEmail?: string | null } = {}
): OmieCustomerReadiness {
  if (!cadastro) {
    return {
      ready: false,
      missing: [],
      missingLabels: [],
      omieOwned: false,
      message: "Cliente nao encontrado no cadastro local."
    };
  }

  // Cliente que JA existe no OMIE: o cadastro que o pedido usa e o de la, nao este.
  // Conferir os campos locais aqui so produz bloqueio errado, porque o espelho local pode
  // estar vazio por motivos que nada tem a ver com o OMIE:
  //
  //   - multi-balanca: o push do cadastro para a nuvem NAO leva endereco (ver
  //     CADASTRO_PUSH_ENTITIES), entao o cliente cadastrado completo na balanca A chega
  //     na balanca B sem endereco nenhum. Barrar ali pararia caminhao por um dado que
  //     existe no OMIE e na outra balanca;
  //   - cliente que entrou por `upsertCloudCustomers`, que nem escreve as colunas de
  //     endereco.
  //
  // A trava existe para o caso em que o cadastro local E o que vai ao OMIE — o cliente
  // novo, sem codigo. Foi exatamente esse o fechamento que se perdeu.
  if (cadastro.omieCustomerId && cadastro.omieCustomerId > 0) return READY;

  const hasDefaultNfeEmail = Boolean((options.defaultNfeEmail ?? "").trim());
  const filled = (value: string | null): boolean => Boolean((value ?? "").trim());

  const missing = omieRequiredCustomerFields(operationType).filter((field) => {
    if (field === "email" && hasDefaultNfeEmail) return false;
    return !filled(cadastro[field]);
  });

  if (missing.length === 0) return READY;

  const missingLabels = missing.map((field) => OMIE_CUSTOMER_FIELD_LABELS[field]);
  const omieOwned = cadastro.source === "omie";
  const message =
    `Cadastro do cliente incompleto para o OMIE: falta ${formatFieldList(missingLabels)}. ` +
    (operationType === "invoice"
      ? "Sem esses dados o OMIE recusa o pedido da venda com nota. "
      : "Sem esses dados o OMIE nao cadastra o cliente. ") +
    "Complete o cadastro do cliente para registrar a entrada." +
    (omieOwned ? " Cliente de origem OMIE: corrija tambem no portal do OMIE." : "");

  return { ready: false, missing, missingLabels, omieOwned, message };
}

/** Le o cadastro no SQLite e aplica a regra. */
export function checkCustomerOmieReadiness(
  database: DesktopDatabase,
  customerId: string | null,
  operationType: OmieReadinessOperationType
): OmieCustomerReadiness {
  if (!customerId?.trim()) {
    return {
      ready: false,
      missing: [],
      missingLabels: [],
      omieOwned: false,
      message: "Selecione o cliente da operacao."
    };
  }

  const row = database
    .prepare(
      `SELECT omie_customer_id, document, email, zipcode, address_street, address_number,
              neighborhood, city, state, source
         FROM customers
        WHERE id = ? AND deleted_at IS NULL`
    )
    .get(customerId) as
    | {
        omie_customer_id: number | null;
        document: string | null;
        email: string | null;
        zipcode: string | null;
        address_street: string | null;
        address_number: string | null;
        neighborhood: string | null;
        city: string | null;
        state: string | null;
        source: string | null;
      }
    | undefined;

  if (!row) return evaluateOmieCustomerReadiness(null, operationType);

  return evaluateOmieCustomerReadiness(
    {
      omieCustomerId: row.omie_customer_id,
      document: row.document,
      email: row.email,
      zipcode: row.zipcode,
      addressStreet: row.address_street,
      addressNumber: row.address_number,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
      source: row.source
    },
    operationType,
    { defaultNfeEmail: readDefaultNfeEmail(database) }
  );
}

/** O e-mail padrao e conveniencia: falha na leitura nao pode derrubar a abertura. */
function readDefaultNfeEmail(database: DesktopDatabase): string | null {
  try {
    return getDefaultNfeEmail(database);
  } catch {
    return null;
  }
}

function formatFieldList(labels: string[]): string {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}
