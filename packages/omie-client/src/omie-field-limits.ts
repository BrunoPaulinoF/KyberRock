/**
 * Tamanho maximo de cada campo do cadastro de cliente/fornecedor no OMIE. Estourar o
 * limite faz o OMIE recusar a chamada INTEIRA ("a razao social ultrapassa 60 caracteres"),
 * derrubando o cadastro e o que dependia dele. O KyberRock aceita qualquer tamanho
 * localmente (o cadastro completo continua no SQLite e nos relatorios/cupom) e encurta
 * apenas o que sobe para o OMIE.
 *
 * `nomeFantasia` usa o mesmo limite da razao social de proposito: quando o cadastro nao
 * tem fantasia proprio ele recebe a razao social como fallback, entao um limite maior aqui
 * deixaria passar exatamente o valor que a razao social ja provou ser grande demais. O
 * documento (cnpjCpf) fica de fora: encurtar um CNPJ/CPF mandaria um documento ERRADO
 * para o OMIE, o que e pior do que a recusa.
 *
 * Precisa acompanhar OMIE_CUSTOMER_FIELD_MAX_LENGTHS em
 * `supabase/functions/omie-sync/omie-sync-core.ts` (o edge nao consegue importar deste
 * workspace, entao os dois lados carregam a mesma tabela).
 */
export const OMIE_CUSTOMER_FIELD_MAX_LENGTHS = {
  razaoSocial: 60,
  nomeFantasia: 60,
  email: 250,
  telefone1Ddd: 5,
  telefone1Numero: 15
} as const;

/**
 * Encurta um texto para caber no campo do OMIE. Normaliza espacos, corta na ultima
 * palavra inteira quando isso nao joga fora um pedaco grande demais do limite (assim
 * "... LOGISTICA INTEGRADA LTDA - FILIAL" vira "... LOGISTICA INTEGRADA LTDA", e nao
 * "... LOGISTICA INTEGRADA LTDA - FIL") e limpa a pontuacao que sobra na ponta.
 * Deterministico: a mesma entrada gera sempre a mesma saida, entao reenvios continuam
 * idempotentes no OMIE.
 */
export function clampOmieText(value: string | undefined, maxLength: number): string | undefined {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (text.length === 0) return undefined;
  if (text.length <= maxLength) return text;

  const hardCut = text.slice(0, maxLength);
  const lastSpace = hardCut.lastIndexOf(" ");
  const cut = lastSpace >= Math.floor(maxLength * 0.75) ? hardCut.slice(0, lastSpace) : hardCut;
  return cut.replace(/[\s,;:./-]+$/, "").trim() || hardCut.trim();
}
