/**
 * Leitura que FALHOU nao e decisao do administrador.
 *
 * O `desktop-status` decidia o acesso da pedreira com `if (error || !row)`: com
 * isso, uma queda do banco — o PostgREST devolvendo 522/5xx ao runtime das Edge
 * Functions — virava uma resposta **200** dizendo `invalid_device`,
 * `unit_blocked` ou `company_blocked`. Do lado da balanca isso e pior do que um
 * erro: resposta valida da nuvem vale como verdade, entao ela NAO entra no prazo
 * offline de 7 dias — grava o bloqueio, para de operar, e continua bloqueada
 * mesmo sem internet (`isBlockingStatus` em `desktop-activation.ts`). Foi assim
 * que a nuvem fora do ar bloqueou a frota inteira "do nada", sem ninguem ter
 * bloqueado nada.
 *
 * A regra e separar as tres coisas diferentes que um erro de leitura pode ser:
 *
 * - **a linha nao existe** (`PGRST116`, o `.single()` sem resultado) — resposta
 *   legitima do banco: o cadastro realmente sumiu, e negar acesso e correto;
 * - **a coluna nao existe** (`42703`) — janela entre o deploy da funcao e a
 *   aplicacao da migracao, ja tratada relendo sem a coluna nova;
 * - **qualquer outra coisa** — a nuvem nao consegue responder AGORA. Dizer
 *   "bloqueado" aqui e mentira, e uma mentira que para pedreira. Nesse caso a
 *   funcao devolve 5xx e a balanca cai no prazo offline, que existe exatamente
 *   para isso.
 *
 * O padrao e deliberadamente o lado seguro: erro que nao sabemos classificar
 * conta como indisponibilidade. O pior caso disso e uma balanca de fato
 * bloqueada seguir operando ate a nuvem voltar; o pior caso do contrario e a
 * frota inteira parar por causa de um soluco de infraestrutura.
 */

export interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string;
}

/** `.single()` sem nenhuma linha: o cadastro nao existe mesmo. */
export function isMissingRowError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST116") return true;
  // Instalacoes antigas do PostgREST descrevem o mesmo caso na mensagem.
  return /0 rows|no rows|results contain 0 rows/i.test(
    `${error.message ?? ""} ${error.details ?? ""}`
  );
}

/** Coluna pedida no select que a tabela ainda nao tem (migracao pendente). */
export function isUnknownColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /does not exist|column .* of .* in the schema cache/i.test(error.message ?? "");
}

/**
 * O banco nao respondeu: a resposta nao pode virar bloqueio.
 *
 * Vale para queda de conexao, timeout, 5xx do gateway e tambem para erro sem
 * codigo conhecido — ver a nota do topo sobre por que o desconhecido cai aqui.
 */
export function isReadUnavailable(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  return !isMissingRowError(error) && !isUnknownColumnError(error);
}
