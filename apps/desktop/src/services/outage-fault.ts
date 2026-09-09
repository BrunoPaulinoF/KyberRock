/**
 * Queda de conexao nao e falha do envio.
 *
 * A fila de sincronizacao desiste de um job depois de 10 tentativas
 * (`markSyncJobFailed`), e a partir dai ele vira `dead_letter`: sai da rotacao
 * automatica e so volta com um clique do operador na tela Cloud. Com o backoff
 * ate 15 min, 10 tentativas cobrem cerca de 2 horas — ou seja, uma queda da
 * nuvem (ou do OMIE) mais longa que isso condenava o fechamento a esperar por
 * alguem que soubesse que precisava clicar.
 *
 * Isso confunde duas coisas diferentes. A falha DETERMINISTICA — cliente sem
 * documento, cadastro incompleto para a NF-e — realmente nao adianta re-tentar,
 * e ja tem tratamento proprio (`markSyncJobBlocked`, que nem gasta tentativa).
 * A falha por INDISPONIBILIDADE nao diz nada sobre o dado: o mesmo envio, sem
 * mudar um byte, funciona quando a outra ponta voltar. Gastar tentativa nela e
 * o mesmo erro que o `desktop-status` cometia ao ler "nao consegui perguntar"
 * como "esta bloqueado".
 *
 * Por isso o reconhecimento e conservador: na duvida o job segue o caminho
 * antigo e morre depois das 10 tentativas. O contrario — classificar como
 * indisponibilidade um erro que e realmente do dado — poria o job para re-tentar
 * para sempre a cada 15 min, que e a tempestade de retry que os classificadores
 * de `omie-fault-classifier.ts` existem para evitar.
 */

function normalize(message: string): string {
  return message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Sinais de rede/transporte: a requisicao nao chegou, nao voltou, ou voltou sem
 * resposta util. Nenhum deles depende do conteudo enviado.
 */
const NETWORK_CUES = [
  "failed to fetch",
  "fetch failed",
  "failed to send a request",
  "network error",
  "networkerror",
  "sem internet",
  "sem conexao",
  "offline",
  "socket hang up",
  "connection terminated",
  "connection timed out",
  "connection refused",
  "connection reset",
  "connection closed",
  "econnrefused",
  "econnreset",
  "enotfound",
  "etimedout",
  "eai_again",
  "ehostunreach",
  "enetunreach",
  "epipe",
  "timed out",
  "timeout",
  "the operation was aborted",
  "aborterror",
  "service unavailable",
  "servico indisponivel",
  "bad gateway",
  "gateway timeout",
  "gateway time-out",
  "temporarily unavailable",
  // Frase fixa das Edge Functions quando a leitura do cadastro falha por
  // indisponibilidade do banco (`_shared/db-read-error.ts`).
  "cadastro indisponivel no momento",
  "nao foi possivel validar o acesso na nuvem agora"
];

/**
 * Status HTTP anotado por `getFunctionErrorMessage` no formato `(HTTP 503)`.
 *
 * Sem ele, a queda de hoje chegava aqui como "Edge Function returned a non-2xx
 * status code", indistinguivel de um 400 causado pelo payload. O 5xx e do
 * servidor por definicao: o cliente nao tem o que corrigir.
 */
const HTTP_STATUS_PATTERN = /\(http (\d{3})\)/;

export function isOutageFault(message: string | null | undefined): boolean {
  if (!message) return false;
  const text = normalize(message);

  const status = HTTP_STATUS_PATTERN.exec(text);
  if (status) {
    const code = Number(status[1]);
    // 5xx (servidor) e 429 (pediram para esperar) voltam sozinhos; 4xx nao.
    if (code >= 500 || code === 429) return true;
  }

  return NETWORK_CUES.some((cue) => text.includes(cue));
}
