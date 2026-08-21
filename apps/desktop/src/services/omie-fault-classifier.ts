/**
 * Classifica mensagens de erro do OMIE para distinguir falhas DETERMINISTICAS de cadastro/NF-e
 * (que nao adianta re-tentar automaticamente ate o operador corrigir o dado) de falhas
 * transientes (offline, timeout, 5xx) que devem seguir o retry normal.
 *
 * Conservador de proposito: exige o contexto de faturamento/NF-e ALEM de um sinal de campo
 * faltante, para nunca classificar erro de rede/transitorio como bloqueio permanente.
 */

function normalize(message: string): string {
  return message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); // remove acentos
}

const FISCAL_CONTEXT = ["nf-e", "nfe", "faturamento", "faturar", "para emitir a nf"];

export function isCadastroIncompleteFault(message: string): boolean {
  if (!message) return false;
  const text = normalize(message);
  const hasFiscalContext = FISCAL_CONTEXT.some((cue) => text.includes(cue));
  if (!hasFiscalContext) return false;
  // Precisa indicar campo/dado faltante para nao pegar erros genericos de faturamento.
  return text.includes("falta preencher") || text.includes("falta ");
}

/**
 * Registro protegido pelo OMIE: o "Cliente Consumidor" (consumidor final padrao) nao aceita
 * AlterarCliente — "Não é possível alterar esse código de integração (Cliente Consumidor)!".
 * Determinstico: re-tentar nunca resolve; o registro pertence ao OMIE e fica como esta.
 */
export function isOmieProtectedRecordFault(message: string): boolean {
  if (!message) return false;
  const text = normalize(message);
  return (
    text.includes("nao e possivel alterar esse codigo de integracao") ||
    text.includes("cliente consumidor")
  );
}

/**
 * IncluirCliente sem CPF/CNPJ: "O preenchimento da tag [cnpj_cpf] é obrigatório!".
 * Deterministico: so resolve quando o operador preencher o documento no cadastro local
 * (o update re-arma needs_push=1).
 */
export function isOmieMissingDocumentFault(message: string): boolean {
  if (!message) return false;
  const text = normalize(message);
  return text.includes("[cnpj_cpf]") && text.includes("obrigat");
}

/**
 * Prefixo que o edge (`omie-sync`) usa quando o OMIE recusa o CADASTRO do cliente no
 * envio do fechamento — o cliente ainda nao existe la e o IncluirCliente foi rejeitado
 * (campo obrigatorio faltando, documento invalido...). Precisa acompanhar
 * CUSTOMER_REGISTRATION_FAULT_PREFIX em supabase/functions/omie-sync/omie-sync-core.ts.
 */
const CUSTOMER_REGISTRATION_FAULT_PREFIX = "cadastro do cliente recusado pelo omie";

/**
 * Prefixo que o edge usa quando o pedido foi recusado porque o codigo OMIE gravado no
 * cadastro local do cliente nao existe (mais) na conta do OMIE — e o edge nao conseguiu
 * refazer o vinculo sozinho. Precisa acompanhar STALE_CUSTOMER_CODE_FAULT_PREFIX em
 * supabase/functions/omie-sync/index.ts.
 */
const STALE_CUSTOMER_CODE_FAULT_PREFIX = "codigo do cliente no omie nao existe mais";

/**
 * Fechamento recusado com "Cliente nao cadastrado para o Codigo [...]": o vinculo local
 * com o OMIE apodreceu (cliente excluido la, codigo de outra conta OMIE, importacao
 * antiga). Deterministico: re-tentar manda o MESMO codigo invalido de novo. O conserto e
 * limpar o codigo local e deixar o cliente subir de novo — ver processOmieSyncQueue.
 */
export function isOmieStaleCustomerCodeFault(message: string): boolean {
  if (!message) return false;
  const text = normalize(message);
  if (text.includes(STALE_CUSTOMER_CODE_FAULT_PREFIX)) return true;
  // Recusa crua do OMIE (fechamento enviado por um edge ainda sem o tratamento acima).
  // A transportadora tem a mesma frase, mas outra tag — e outro conserto.
  return (
    text.includes("cliente nao cadastrado") &&
    text.includes("codigo_cliente") &&
    !text.includes("codigo_transportadora")
  );
}

/**
 * Fechamento que nao foi ao OMIE porque o CLIENTE nao pode ser cadastrado la.
 * Deterministico: re-tentar sem corrigir o cadastro so repete a recusa (e gera retry
 * storm). O envio volta sozinho quando o cliente entra no OMIE — ver
 * rearmOmieBillingForCustomer em supabase-sync.
 */
export function isOmieCustomerRegistrationFault(message: string): boolean {
  if (!message) return false;
  const text = normalize(message);
  return (
    text.includes(CUSTOMER_REGISTRATION_FAULT_PREFIX) ||
    text.includes("sem dados de cadastro para criar no omie") ||
    isOmieMissingDocumentFault(message)
  );
}

/**
 * O OMIE recusou o faturamento porque o pedido JA FOI FATURADO la — tipicamente
 * "Nao e possivel faturar, pois o Pedido de Venda de Produto ja foi autorizado."
 *
 * Isto NAO e falha: e o OMIE dizendo que a nota daquela carga ja saiu, normalmente porque
 * alguem faturou a mao na coluna "Faturar" antes de o fechamento rodar. Tratar como erro
 * pintava de vermelho um fechamento que na verdade estava pronto, e mandava a atendente
 * procurar problema onde nao havia — o certo e reconhecer o estado e reconciliar a
 * situacao da pesagem aqui.
 *
 * "Autorizado" e o vocabulario da NF-e (autorizada pela SEFAZ), e so aparece depois de a
 * nota existir; por isso ele basta como sinal, sem exigir outro contexto.
 */
export function isOmieAlreadyBilledFault(message: string): boolean {
  if (!message) return false;
  const text = normalize(message);
  return (
    text.includes("ja foi autorizado") ||
    text.includes("ja foi faturado") ||
    text.includes("ja esta faturado") ||
    text.includes("ja foi autorizada") ||
    (text.includes("nota fiscal") && text.includes("ja emitida"))
  );
}
