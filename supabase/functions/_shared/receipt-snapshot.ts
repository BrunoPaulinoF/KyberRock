/**
 * A logo nao entra no banco, venha ela de que versao vier.
 *
 * `print_receipts.content_snapshot_json` e a copia congelada do cupom, e ela carregava a logo
 * da pedreira em base64 dentro de CADA via impressa: medido em 16/09/2026, 11 kB dos ~11,5 kB
 * de cada linha, 6.310 copias de apenas 3 imagens distintas, 66 MB dos 106 MB do banco.
 *
 * A peneira ja existe no desktop (`archivableReceiptSnapshot` e `snapshotWithoutLogoImage`),
 * mas ela viaja no INSTALADOR: enquanto a balanca nao atualizar, ela continua imprimindo,
 * gravando e enviando o cupom com a imagem. Foi o que aconteceu — nas primeiras 24 h depois da
 * limpeza chegaram 196 cupons novos, TODOS com a logo, e o banco voltou a crescer (46 -> 49 MB).
 * Atualizar a frota resolve, mas uma por uma e quando cada uma quiser.
 *
 * Por isso a ultima peneira fica AQUI, no ponto por onde todo cupom passa antes de virar linha:
 * a nuvem para de depender da versao instalada. E a mesma regra que ja vale para o resumo de
 * saude (`normalizeDeviceHealth`) — o corpo da requisicao e o que o cliente disser que e, e o
 * que nao pode entrar no banco se barra na entrada, nao na origem.
 *
 * Fica a GEOMETRIA (`widthMm`, `heightMm`, `fit`): ela e barata e diz como a via saiu do papel.
 * Apagar o bloco `receiptLogo` inteiro faria o arquivo mentir sobre o layout impresso; o que
 * sai e so o `dataUrl`.
 *
 * Nada mais e tocado: linha sem snapshot, snapshot que nao e objeto, snapshot sem logo — todos
 * passam intactos. Esta funcao tira uma coisa so, e por isso nao precisa saber o formato do
 * resto do cupom, que muda com o modelo de impressao.
 */

/** Tira a imagem da logo de uma lista de cupons a caminho do banco. */
export function receiptRowsWithoutLogoImage(
  rows: readonly Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows.map((row) => {
    const snapshot = row.content_snapshot_json;
    const stripped = snapshotWithoutLogoImage(snapshot);
    return stripped === snapshot ? row : { ...row, content_snapshot_json: stripped };
  });
}

/** Devolve o MESMO objeto quando nao ha imagem a tirar, para a linha nao ser copiada a toa. */
export function snapshotWithoutLogoImage(snapshot: unknown): unknown {
  if (!isPlainObject(snapshot)) return snapshot;
  const logo = snapshot.receiptLogo;
  if (!isPlainObject(logo)) return snapshot;
  if (logo.dataUrl === null || logo.dataUrl === undefined) return snapshot;
  return { ...snapshot, receiptLogo: { ...logo, dataUrl: null } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
