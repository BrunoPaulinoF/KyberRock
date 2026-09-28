/**
 * Historico das alteracoes de preco especial (`public.price_change_log`, migracao
 * `202609280005`). A balanca grava a linha no salvamento e manda pelo `desktop-sync` com a
 * chave `priceChangeLog`; o site grava pela `web-api`.
 *
 * Esta funcao decide o que da linha vinda da balanca a nuvem aceita. Empresa, unidade e
 * dispositivo saem do REGISTRO do dispositivo (do token), nunca do payload: uma balanca nao
 * assina alteracao em nome de outra, nem grava historico em outra pedreira. O nome de quem fez
 * e preenchido no banco pelo nome do dispositivo (gatilho `price_change_log_author`).
 */

export type PriceChangeAction = "adicionado" | "alterado" | "removido";

const ACTIONS: readonly PriceChangeAction[] = ["adicionado", "alterado", "removido"];

export interface PriceChangeLogDevice {
  id: string;
  company_id: string;
  unit_id: string;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function timestamp(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function isPriceChangeAction(value: unknown): value is PriceChangeAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

/**
 * Linhas do historico prontas para gravar, a partir do que a balanca enviou. Linha sem id, sem
 * acao conhecida ou sem data e descartada — historico torto e pior do que historico faltando.
 */
export function priceChangeLogRowsFromDevice(
  rows: readonly Record<string, unknown>[],
  device: PriceChangeLogDevice
): Record<string, unknown>[] {
  const accepted: Record<string, unknown>[] = [];
  for (const row of rows) {
    const id = text(row.id);
    const action = row.action;
    const changedAt = timestamp(row.changed_at);
    if (!id || !isPriceChangeAction(action) || !changedAt) continue;
    accepted.push({
      id,
      company_id: device.company_id,
      unit_id: device.unit_id,
      device_id: device.id,
      user_id: null,
      author_name: null,
      source: "balanca",
      kind: "preco_especial",
      action,
      customer_id: text(row.customer_id),
      customer_name: text(row.customer_name),
      product_id: text(row.product_id),
      product_description: text(row.product_description),
      old_price_cents: cents(row.old_price_cents),
      new_price_cents: cents(row.new_price_cents),
      changed_at: changedAt
    });
  }
  return accepted;
}

/**
 * A acao, pelo preco de antes e o de depois. `null` quando nada mudou (salvar o mesmo valor nao
 * e alteracao).
 */
export function priceChangeAction(
  oldPriceCents: number | null,
  newPriceCents: number | null
): PriceChangeAction | null {
  if (oldPriceCents === newPriceCents) return null;
  if (oldPriceCents === null) return "adicionado";
  if (newPriceCents === null) return "removido";
  return "alterado";
}
