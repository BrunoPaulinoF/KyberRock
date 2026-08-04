import type { CacheEntityType } from "../services/cache-store";
import type { KyberRockDesktopApi } from "../preload/api-types";

/**
 * Item de uma lista de escolha (cliente/transportadora) do modal de troca em
 * operacoes. `title` e o nome que o operador procura; `subtitle` traz o dado de
 * apoio (razao social, documento) para diferenciar homonimos.
 */
export interface EntityPickerItem {
  id: string;
  title: string;
  subtitle: string | null;
  isActive: boolean;
  /** Texto ja normalizado usado pela barra de pesquisa. */
  searchText: string;
}

/** Texto comparavel na busca: sem acento e em minusculas ("LEVISA" acha "levisa"). */
function normalizePickerText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Versao so com letras e digitos, para casar "12.345.678/0001-90" com "12345678000190". */
function compactPickerText(value: string): string {
  return normalizePickerText(value).replace(/[^a-z0-9]/g, "");
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Primeiro campo preenchido da lista. Usa string vazia como "ausente" — o cadastro
 * vindo do OMIE costuma trazer `trade_name` em branco (nao nulo), e quem so testava
 * `?? ` acabava rotulando a linha com "" e sumindo com o cliente na lista.
 */
function firstFilled(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = readString(row, key);
    if (value) return value;
  }
  return "";
}

const TITLE_FIELDS: Record<string, string[]> = {
  customer: ["tradeName", "legalName", "name"],
  carrier: ["name", "tradeName", "legalName"]
};

const SUBTITLE_FIELDS: Record<string, string[]> = {
  customer: ["legalName"],
  carrier: ["city"]
};

/**
 * Converte as linhas cruas do cache no formato do modal, ordenadas por nome. Linhas
 * sem nenhum nome legivel caem para o documento e, em ultimo caso, para o id — assim
 * um cadastro torto continua selecionavel em vez de virar uma linha em branco.
 */
export function buildEntityPickerItems(
  entityType: "customer" | "carrier",
  rows: Array<Record<string, unknown>>
): EntityPickerItem[] {
  const titleFields = TITLE_FIELDS[entityType] ?? ["name"];
  const subtitleFields = SUBTITLE_FIELDS[entityType] ?? ["document"];

  const items = rows.map((row) => {
    const id = readString(row, "id");
    const title = firstFilled(row, titleFields) || readString(row, "document") || id;
    const document = readString(row, "document");
    // O documento entra sempre no subtitulo: e por ele que o operador separa homonimos
    // (e e um dos campos que a barra de pesquisa aceita).
    const subtitleParts = [firstFilled(row, subtitleFields), document].filter(
      (part) => part && part !== title
    );
    const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : null;
    const searchSource = [title, subtitle ?? "", document, readString(row, "city")]
      .filter(Boolean)
      .join(" ");

    return {
      id,
      title,
      subtitle,
      isActive: row.isActive !== false,
      searchText: `${normalizePickerText(searchSource)} ${compactPickerText(searchSource)}`
    };
  });

  return sortEntityPickerItems(items);
}

/** Ordem alfabetica pelo nome exibido, com os inativos mantidos no meio da lista. */
export function sortEntityPickerItems(items: EntityPickerItem[]): EntityPickerItem[] {
  return [...items].sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
}

/**
 * Filtra pela barra de pesquisa. Casa por trecho em qualquer posicao ("visa" acha
 * "Levisa") e ignora acento e pontuacao, para o operador digitar do jeito que lembra.
 */
export function filterEntityPickerItems(
  items: EntityPickerItem[],
  search: string
): EntityPickerItem[] {
  const term = normalizePickerText(search.trim());
  if (!term) return items;
  const compactTerm = compactPickerText(search);

  return items.filter((item) => {
    if (item.searchText.includes(term)) return true;
    return compactTerm.length > 0 && item.searchText.includes(compactTerm);
  });
}

/** Tamanho de cada pagina lida do cache ao montar a lista completa. */
export const ENTITY_PICKER_PAGE_SIZE = 500;

/**
 * Guarda contra loop infinito caso o cache devolva `total` inconsistente: 40 paginas
 * de 500 cobrem 20 mil cadastros, muito acima de qualquer unidade real.
 */
const MAX_PAGES = 40;

/**
 * Le a lista COMPLETA de um tipo do cache, paginando ate cobrir `total`.
 *
 * O modal de troca lia uma unica pagina de 500 linhas e so depois ordenava por nome:
 * numa unidade com mais de 500 cadastros, o corte acontecia na ordem do banco e
 * clientes existentes (o caso relatado: "Levisa") simplesmente nao apareciam na lista.
 * Aqui a paginacao vai ate o fim antes de qualquer ordenacao.
 */
export async function loadAllCacheRows(
  desktopApi: Pick<KyberRockDesktopApi, "queryCache">,
  entityType: CacheEntityType,
  options: { activeOnly?: boolean } = {}
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * ENTITY_PICKER_PAGE_SIZE;
    const result = await desktopApi.queryCache({
      entityType,
      activeOnly: options.activeOnly ?? false,
      limit: ENTITY_PICKER_PAGE_SIZE,
      offset
    });
    const pageRows = (result.rows as Array<Record<string, unknown>>) ?? [];
    rows.push(...pageRows);
    if (pageRows.length < ENTITY_PICKER_PAGE_SIZE) break;
    if (rows.length >= result.total) break;
  }

  return rows;
}
