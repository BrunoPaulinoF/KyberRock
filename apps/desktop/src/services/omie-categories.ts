import type { DesktopDatabase } from "../database/sqlite.js";
import { readStringLocalSetting, writeLocalSetting } from "./local-settings.js";

/**
 * Categoria do plano gerencial do OMIE espelhada localmente. E o `codigo_categoria`
 * de `informacoes_adicionais` no pedido de venda: classifica a receita no OMIE.
 *
 * Antes esse codigo era fixo ("1.01.01") no edge, entao toda venda caia na mesma
 * categoria — brita, aterro, rachao, tudo junto. Agora cada produto aponta a sua.
 */
export interface OmieCategoryRow {
  id: string;
  code: string;
  description: string;
  category_type: string | null;
  parent_code: string | null;
  is_active: number;
}

export interface OmieCategoryOption {
  code: string;
  description: string;
  categoryType: string | null;
}

/** Codigo usado quando nem o produto nem a unidade definem uma categoria. */
export const FALLBACK_OMIE_CATEGORY_CODE = "1.01.01";

/** Chave em local_settings da categoria padrao da unidade. */
export const DEFAULT_OMIE_CATEGORY_SETTING_KEY = "omie.defaultCategoryCode";

/**
 * Categorias que podem ser escolhidas para um produto. Categorias totalizadoras
 * (`nao_exibir` no OMIE) e inativas ficam de fora — o OMIE recusa o pedido quando o
 * codigo nao e uma categoria lancavel.
 */
export function listOmieCategories(
  database: DesktopDatabase,
  companyId: string
): OmieCategoryOption[] {
  return (
    database
      .prepare(
        `SELECT code, description, category_type
         FROM omie_categories
         WHERE company_id = ? AND is_active = 1
         ORDER BY code ASC`
      )
      .all(companyId) as Array<{
      code: string;
      description: string;
      category_type: string | null;
    }>
  ).map((row) => ({
    code: row.code,
    description: row.description,
    categoryType: row.category_type
  }));
}

/**
 * Define (ou limpa, com null/vazio) a categoria OMIE do produto. Valida contra o
 * espelho para nao gravar um codigo que o OMIE vai recusar no envio do pedido.
 */
export function setProductOmieCategory(
  database: DesktopDatabase,
  companyId: string,
  productId: string,
  categoryCode: string | null,
  now: Date = new Date()
): void {
  const code = categoryCode?.trim() || null;
  if (code) {
    const known = database
      .prepare(
        "SELECT 1 FROM omie_categories WHERE company_id = ? AND code = ? AND is_active = 1"
      )
      .get(companyId, code);
    if (!known) {
      throw new Error(
        `Categoria ${code} nao encontrada no espelho do OMIE. Sincronize o OMIE e tente de novo.`
      );
    }
  }

  const result = database
    .prepare(
      "UPDATE products SET omie_category_code = ?, updated_at = ? WHERE id = ? AND company_id = ? AND deleted_at IS NULL"
    )
    .run(code, now.toISOString(), productId, companyId);
  if (result.changes === 0) {
    throw new Error("Produto nao encontrado.");
  }
}

/**
 * Categoria a enviar no pedido de venda: a do produto, senao a padrao da unidade,
 * senao o codigo historico. Nunca retorna vazio — o OMIE exige a categoria.
 */
export function resolveOrderCategoryCode(
  productCategoryCode: string | null | undefined,
  defaultCategoryCode: string | null | undefined
): string {
  return (
    productCategoryCode?.trim() ||
    defaultCategoryCode?.trim() ||
    FALLBACK_OMIE_CATEGORY_CODE
  );
}

/** Categoria padrao da unidade, usada pelos produtos sem categoria propria. */
export function getDefaultOmieCategory(database: DesktopDatabase): string | null {
  return readStringLocalSetting(database, DEFAULT_OMIE_CATEGORY_SETTING_KEY);
}

export function setDefaultOmieCategory(
  database: DesktopDatabase,
  companyId: string,
  categoryCode: string | null
): string | null {
  const code = categoryCode?.trim() || null;
  if (code) {
    const known = database
      .prepare(
        "SELECT 1 FROM omie_categories WHERE company_id = ? AND code = ? AND is_active = 1"
      )
      .get(companyId, code);
    if (!known) {
      throw new Error(
        `Categoria ${code} nao encontrada no espelho do OMIE. Sincronize o OMIE e tente de novo.`
      );
    }
  }
  writeLocalSetting(database, DEFAULT_OMIE_CATEGORY_SETTING_KEY, code);
  return code;
}
