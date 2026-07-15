/**
 * Classifica mensagens de erro do OMIE para distinguir falhas DETERMINISTICAS de cadastro/NF-e
 * (que nao adianta re-tentar automaticamente ate o operador corrigir o dado) de falhas
 * transientes (offline, timeout, 5xx) que devem seguir o retry normal.
 *
 * Conservador de proposito: exige o contexto de faturamento/NF-e ALEM de um sinal de campo
 * faltante, para nunca classificar erro de rede/transitorio como bloqueio permanente.
 */

function normalize(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // remove acentos
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
