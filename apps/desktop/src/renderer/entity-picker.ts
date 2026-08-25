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

/** Os cadastros que o modal de troca sabe listar. */
export type EntityPickerType = "customer" | "carrier" | "product";

const TITLE_FIELDS: Record<EntityPickerType, string[]> = {
  customer: ["tradeName", "legalName", "name"],
  carrier: ["name", "tradeName", "legalName"],
  product: ["description", "name"]
};

const SUBTITLE_FIELDS: Record<EntityPickerType, string[]> = {
  customer: ["legalName"],
  carrier: ["city"],
  // O codigo do produto e o que separa dois materiais de descricao parecida ("Brita 1" e
  // "Brita 1 lavada"), e e por ele que o cadastro conversa com o OMIE.
  product: ["code"]
};

/**
 * Converte as linhas cruas do cache no formato do modal, PRESERVANDO a ordem que veio.
 *
 * A ordem e do cache: alfabetica em repouso, por proximidade com o que foi digitado. Antes
 * a lista era reordenada aqui, em ordem alfabetica, DEPOIS de o cache ja ter pontuado a
 * busca — o cliente que casava melhor voltava para o meio da lista e o operador rolava
 * atras dele.
 *
 * Linhas sem nenhum nome legivel caem para o documento e, em ultimo caso, para o id —
 * assim um cadastro torto continua selecionavel em vez de virar uma linha em branco.
 */
export function buildEntityPickerItems(
  entityType: EntityPickerType,
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

  return items;
}

/**
 * Quantos cadastros o modal mostra ANTES de o operador digitar.
 *
 * Amostra, nao filtro: a pedreira pequena continua escolhendo no clique. A grande nao
 * espera mais o cadastro inteiro atravessar o IPC — o modal lia TUDO ao abrir, em paginas
 * de 500, e uma unidade com milhares de clientes travava a tela por segundos antes de
 * pintar milhares de linhas que ninguem ia rolar.
 */
export const ENTITY_PICKER_PREVIEW_LIMIT = 25;

/** Quantos resultados o modal mostra COM busca digitada. */
export const ENTITY_PICKER_RESULT_LIMIT = 50;

/** O que o modal precisa saber a cada leitura: as linhas e quantas casaram ao todo. */
export interface EntityPickerPage {
  items: EntityPickerItem[];
  /** Quantos cadastros casaram — pode ser mais do que veio em `items`. */
  total: number;
}

/**
 * Le do cache a pagina que o modal vai mostrar.
 *
 * A busca acontece do lado do cache, que e quem tem o cadastro em memoria e sabe pontuar a
 * proximidade. Antes o modal puxava a lista COMPLETA pelo IPC e filtrava na tela: ate 40
 * idas e voltas de 500 linhas so para abrir, e uma comparacao por trecho sem ordem nenhuma.
 */
export async function loadEntityPickerPage(
  desktopApi: Pick<KyberRockDesktopApi, "queryCache">,
  entityType: EntityPickerType,
  search: string,
  options: { activeOnly?: boolean; productFiscalType?: "finished_goods" } = {}
): Promise<EntityPickerPage> {
  const term = search.trim();
  const result = await desktopApi.queryCache({
    entityType,
    search: term,
    activeOnly: options.activeOnly ?? false,
    productFiscalType: options.productFiscalType,
    limit: term ? ENTITY_PICKER_RESULT_LIMIT : ENTITY_PICKER_PREVIEW_LIMIT
  });
  return {
    items: buildEntityPickerItems(
      entityType,
      (result.rows as Array<Record<string, unknown>>) ?? []
    ),
    total: result.total
  };
}
