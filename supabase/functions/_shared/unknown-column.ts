/**
 * Coluna que o desktop ja envia e a nuvem ainda nao tem.
 *
 * O desktop e a nuvem sao implantados por caminhos diferentes: a versao nova da
 * balanca chega pelo instalador e as migracoes SQL sao aplicadas a parte. Entre
 * um e outro existe uma janela em que o payload traz um campo que a tabela ainda
 * nao possui — e o PostgREST recusa o lote INTEIRO com PGRST204, nao so a coluna
 * desconhecida.
 *
 * Isso ja parou a pedreira uma vez: `weighing_operations.operation_code` chegou
 * na balanca antes da migracao, todo upsert de operacao passou a falhar e, como
 * `loading_requests.operation_id` referencia a operacao, a solicitacao de
 * carregamento tambem parou de entrar — o carregador ficou sem NENHUMA carga em
 * aberto na tela ate a migracao ser aplicada.
 *
 * A regra aqui e degradar em vez de travar: a coluna que a nuvem nao conhece sai
 * do payload, o resto e gravado e o campo novo chega sozinho no proximo push,
 * depois da migracao. Quem cai fora vira aviso na resposta e no log do projeto.
 */

/** Teto de rodadas: o PostgREST so reporta uma coluna desconhecida por vez. */
export const MAX_UNKNOWN_COLUMN_ROUNDS = 8;

export interface PostgrestLikeError {
  message?: string;
  code?: string;
}

/**
 * Nome da coluna reclamada por um erro do PostgREST, ou null se o erro for de
 * outra natureza (a mensagem e do tipo "Could not find the 'operation_code'
 * column of 'weighing_operations' in the schema cache").
 */
export function unknownColumnFromError(error: PostgrestLikeError | null): string | null {
  if (!error || error.code !== "PGRST204") return null;
  const match = /'([^']+)' column of/.exec(error.message ?? "");
  return match ? match[1] : null;
}

/** As mesmas linhas sem a coluna informada. */
export function stripColumn(
  rows: readonly Record<string, unknown>[],
  column: string
): Record<string, unknown>[] {
  return rows.map((row) => {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key !== column) rest[key] = value;
    }
    return rest;
  });
}

/** Alguma linha do lote ainda carrega a coluna? Se nao, remove-la nao adianta. */
export function rowsHaveColumn(rows: readonly Record<string, unknown>[], column: string): boolean {
  return rows.some((row) => column in row);
}
