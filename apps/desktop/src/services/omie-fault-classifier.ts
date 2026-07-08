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
