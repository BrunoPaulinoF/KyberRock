// OMIE usa datas no formato "dd/mm/aaaa" em requests e responses das APIs de
// financas (contapagar, contareceber, extrato). Conversao para ISO (yyyy-mm-dd)
// deixa o restante do codebase consistente (SQLite/Postgres usam ISO).

/** Converte "dd/mm/aaaa" (formato OMIE) para "yyyy-mm-dd" (ISO). Retorna null se invalido. */
export function parseOmieDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

/** Converte "yyyy-mm-dd" (ISO) para "dd/mm/aaaa" (formato OMIE). */
export function formatOmieDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/** Converte um valor monetario do OMIE (numero ou string "1234.56"/"1234,56") para centavos. */
export function toCents(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? Math.round(num * 100) : 0;
}
