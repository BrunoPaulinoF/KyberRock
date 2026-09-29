import { formatPlate } from "./format";

/**
 * A regra da busca rapida (Ctrl+K), sem tela: o que combina com o que foi digitado e em que
 * ordem. Sem acento e sem diferenca de maiuscula — "operacoes", "Operações" e "OPERACOES" acham
 * a mesma tela.
 */
export interface SearchCommand {
  id: string;
  label: string;
  keywords?: string[];
}

export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nota de quanto o comando combina (maior = melhor; `null` = nao aparece): nome que COMECA com
 * o texto, palavra do nome que comeca com ele, nome que contem, e por fim os outros nomes
 * (`keywords`).
 */
export function commandScore(query: string, command: SearchCommand): number | null {
  const wanted = normalizeSearch(query);
  if (!wanted) return 1;
  const label = normalizeSearch(command.label);
  if (label.startsWith(wanted)) return 100 - label.length / 100;
  if (label.split(" ").some((word) => word.startsWith(wanted))) return 80;
  if (label.includes(wanted)) return 60;
  const keywords = (command.keywords ?? []).map(normalizeSearch);
  if (keywords.some((keyword) => keyword.startsWith(wanted))) return 40;
  if (keywords.some((keyword) => keyword.includes(wanted))) return 30;
  return null;
}

export function rankCommands<T extends SearchCommand>(
  query: string,
  commands: T[],
  limit = 8
): T[] {
  return commands
    .map((command, index) => ({ command, index, score: commandScore(query, command) }))
    .filter((item): item is { command: T; index: number; score: number } => item.score !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.command);
}

/** O texto parece uma placa (antiga ABC1234 ou Mercosul ABC1D23)? Devolve normalizada. */
export function plateFromQuery(query: string): string | null {
  const raw = query.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(raw)) return null;
  return raw;
}

/** Como a placa aparece na tela ("ABC-1234" / "ABC1D23"). */
export function plateLabel(plate: string): string {
  return formatPlate(plate);
}

/**
 * O texto parece o numero de um cupom (o "COD 003249" do topo ou o "000004038-4" da copia)?
 * Devolve como a tela Cupons procura.
 */
export function receiptCodeFromQuery(query: string): string | null {
  const text = query
    .trim()
    .replace(/^cod\.?\s*/i, "")
    .trim();
  if (!/^\d[\d-]{2,15}$/.test(text)) return null;
  return text;
}
