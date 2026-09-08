/**
 * Traduz a falha de conexao TCP em uma instrucao que o operador da balanca
 * consegue seguir.
 *
 * O que chegava na tela era o texto cru ("Timeout de conexao (3000ms)",
 * "connect ECONNREFUSED 192.168.5.190:9001"): diz que falhou, nao diz o que
 * conferir. E as causas comuns na pedreira pedem acoes opostas — conversor
 * desligado, IP de outra faixa, porta errada e outro programa segurando a unica
 * sessao do conversor nao se resolvem do mesmo jeito. O codigo do erro ja separa
 * os casos; so faltava dizer isso em portugues de operacao.
 */

export interface TcpConnectFailure {
  host: string;
  port: number;
  /** Codigo do erro de rede (`ECONNREFUSED`, `EHOSTUNREACH`, ...), quando houver. */
  code?: string | undefined;
  /** Tempo de espera esgotado, quando a falha foi o nosso proprio timeout. */
  timeoutMs?: number | undefined;
  /** Mensagem original, usada quando o codigo nao e conhecido. */
  originalMessage?: string | undefined;
}

const CHECK_LIST =
  "Confira se o indicador (ou o conversor de rede) esta ligado, se o IP e a porta " +
  "estao como no aparelho e se este computador esta na mesma rede da balanca.";

/** Erros que significam "ninguem respondeu no endereco". */
const NO_ANSWER_CODES = new Set(["ETIMEDOUT", "EHOSTDOWN"]);

/** Erros que significam "o computador nem sabe por onde mandar o pacote". */
const NO_ROUTE_CODES = new Set(["EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "EADDRNOTAVAIL"]);

/** Erros que significam "o nome do host nao virou endereco". */
const UNRESOLVED_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

/** Erros que significam "a sessao existia e foi derrubada do outro lado". */
const DROPPED_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED"]);

export function describeTcpConnectFailure(failure: TcpConnectFailure): string {
  const target = `${failure.host}:${failure.port}`;
  const code = failure.code?.toUpperCase();

  if (code === "ECONNREFUSED") {
    return (
      `O aparelho em ${failure.host} respondeu, mas recusou a conexao na porta ${failure.port}. ` +
      "O IP esta certo e a porta nao: confira a porta TCP configurada no proprio " +
      "indicador ou no conversor (a mais comum e 4001)."
    );
  }

  if (NO_ROUTE_CODES.has(code ?? "")) {
    return (
      `Este computador nao tem caminho ate ${failure.host}. Normalmente e rede diferente: ` +
      "confira o cabo ou o Wi-Fi e se o IP da balanca e da mesma faixa da rede daqui."
    );
  }

  if (UNRESOLVED_CODES.has(code ?? "")) {
    return `Nao foi possivel descobrir o endereco de "${failure.host}". Use o IP da balanca (ex.: 192.168.1.100).`;
  }

  if (DROPPED_CODES.has(code ?? "")) {
    return (
      `A balanca em ${target} derrubou a conexao. Quase sempre e outro programa (ou outro ` +
      "computador) ocupando a conexao da balanca, que aceita um de cada vez."
    );
  }

  if (failure.timeoutMs !== undefined || NO_ANSWER_CODES.has(code ?? "")) {
    const waited =
      failure.timeoutMs === undefined ? "" : ` em ${formatSeconds(failure.timeoutMs)} segundos`;
    return (
      `A balanca em ${target} nao respondeu${waited}. ${CHECK_LIST} ` +
      "Se estiver tudo certo, verifique se outro programa ou computador nao esta " +
      "ocupando a conexao da balanca — ela aceita um de cada vez."
    );
  }

  const original = failure.originalMessage?.trim();
  return original
    ? `Falha ao conectar em ${target}: ${original}. ${CHECK_LIST}`
    : `Falha ao conectar em ${target}. ${CHECK_LIST}`;
}

/** "10", "1,5" — sem casa decimal desnecessaria e com virgula, como o operador le. */
function formatSeconds(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  const rounded = Math.round(seconds * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
}
