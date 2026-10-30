import type { DesktopDatabase } from "../database/sqlite.js";

/**
 * Foto do cadastro da pesagem tirada no FECHAMENTO.
 *
 * A operacao sempre guardou peso, preco e frete, mas cliente, placa, motorista e produto
 * eram so ids: o cupom lia o cadastro de AGORA. Trocar a razao social do cliente, a placa
 * do caminhao, o motorista ou a descricao do produto reescrevia todo cupom antigo
 * reimpresso — a 2a via de hoje citava um nome que nao estava na 1a, a que o cliente tem
 * em maos.
 *
 * A foto e tirada uma vez, dentro da transacao do fechamento, e nunca e reescrita: o pull
 * da nuvem so a preenche quando esta maquina nao tem (`COALESCE` com a copia local na
 * frente), e e assim que a pesagem fechada na outra balanca da pedreira chega com a foto
 * de la. Operacao fechada antes desta versao nao tem foto — para ela a reimpressao usa a
 * copia guardada da 1a via (`print_receipts.content_snapshot_json`) e so na falta das duas
 * cai no cadastro atual, que era o comportamento de sempre.
 */
export interface OperationClosingSnapshot {
  customerName: string | null;
  customerDocument: string | null;
  customerPhone: string | null;
  customerZipCode: string | null;
  customerCity: string | null;
  customerState: string | null;
  plate: string | null;
  driverName: string | null;
  carrierName: string | null;
  productCode: string | null;
  productDescription: string | null;
  paymentTermName: string | null;
  paymentMethodName: string | null;
  capturedAt: string;
}

/** Campos da foto que o cupom usa no lugar do cadastro atual. */
export type FrozenCadastro = Partial<Omit<OperationClosingSnapshot, "capturedAt">>;

const FROZEN_CADASTRO_KEYS = [
  "customerName",
  "customerDocument",
  "customerPhone",
  "customerZipCode",
  "customerCity",
  "customerState",
  "plate",
  "driverName",
  "carrierName",
  "productCode",
  "productDescription",
  "paymentTermName",
  "paymentMethodName"
] as const satisfies ReadonlyArray<keyof FrozenCadastro>;

interface LiveCadastroRow {
  customer_name: string | null;
  customer_document: string | null;
  customer_phone: string | null;
  customer_zipcode: string | null;
  customer_city: string | null;
  customer_state: string | null;
  plate: string | null;
  driver_name: string | null;
  carrier_name: string | null;
  product_code: string | null;
  product_description: string | null;
  payment_term_name: string | null;
  payment_method_name: string | null;
}

/**
 * Le o cadastro da operacao do jeito que o cupom o le (mesmos `COALESCE` com o texto que
 * veio da nuvem e a mesma regra das parcelas manuais), para a foto valer exatamente o que
 * a 1a via imprime.
 */
function readLiveCadastro(
  database: DesktopDatabase,
  operationId: string
): LiveCadastroRow | undefined {
  return database
    .prepare(
      `SELECT
        COALESCE(c.trade_name, o.remote_customer_name) AS customer_name,
        c.document AS customer_document,
        c.phone AS customer_phone, c.zipcode AS customer_zipcode, c.city AS customer_city,
        c.state AS customer_state,
        COALESCE(v.plate, o.remote_plate) AS plate,
        COALESCE(d.name, o.remote_driver_name) AS driver_name,
        ca.name AS carrier_name,
        p.code AS product_code,
        COALESCE(p.description, o.remote_product_description) AS product_description,
        CASE
          WHEN o.manual_installments = 1 THEN '1 parcela'
          WHEN o.manual_installments > 1 THEN CAST(o.manual_installments AS TEXT) || ' parcelas'
          ELSE pt.name
        END AS payment_term_name,
        pm.name AS payment_method_name
       FROM weighing_operations o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN carriers ca ON ca.id = o.carrier_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
       LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id
       WHERE o.id = ?`
    )
    .get(operationId) as LiveCadastroRow | undefined;
}

/**
 * Tira a foto do cadastro da operacao, se ela ainda nao tem uma. Chamada no fechamento,
 * dentro da mesma transacao que grava o peso de saida: a foto e do instante em que a carga
 * foi vendida.
 */
export function captureOperationClosingSnapshot(
  database: DesktopDatabase,
  operationId: string,
  capturedAt: string
): void {
  const row = readLiveCadastro(database, operationId);
  if (!row) return;

  const snapshot: OperationClosingSnapshot = {
    customerName: row.customer_name,
    customerDocument: row.customer_document,
    customerPhone: row.customer_phone,
    customerZipCode: row.customer_zipcode,
    customerCity: row.customer_city,
    customerState: row.customer_state,
    plate: row.plate,
    driverName: row.driver_name,
    carrierName: row.carrier_name,
    productCode: row.product_code,
    productDescription: row.product_description,
    paymentTermName: row.payment_term_name,
    paymentMethodName: row.payment_method_name,
    capturedAt
  };

  database
    .prepare(
      `UPDATE weighing_operations SET closing_snapshot_json = ?
       WHERE id = ? AND closing_snapshot_json IS NULL`
    )
    .run(JSON.stringify(snapshot), operationId);
}

/**
 * Foto gravada no fechamento. Texto corrompido vira `null` (o cupom cai na copia da 1a via
 * ou no cadastro atual): foto quebrada nunca pode impedir a reimpressao.
 */
export function parseOperationClosingSnapshot(
  json: string | null | undefined
): FrozenCadastro | null {
  return pickFrozenCadastro(parseObject(json));
}

/**
 * O mesmo recorte a partir da copia guardada de um cupom ja impresso. E a foto possivel
 * das pesagens fechadas antes de existir `closing_snapshot_json`: a 1a via congelou o
 * cadastro com os mesmos nomes de campo (`ReceiptTemplateInput`).
 */
export function frozenCadastroFromArchivedReceipt(
  json: string | null | undefined
): FrozenCadastro | null {
  return pickFrozenCadastro(parseObject(json));
}

/**
 * Valor congelado de um campo, ou o atual quando a foto nao tem aquele campo.
 *
 * So texto preenchido congela. Um vazio na foto e quase sempre falta de dado, nao escolha:
 * a 1a via de uma pesagem que chegou da nuvem antes do cadastro saiu com o cliente em
 * branco, e reimprimir o branco perpetuaria o defeito agora que o vinculo existe.
 */
export function frozenValue<K extends keyof FrozenCadastro>(
  frozen: FrozenCadastro | null,
  key: K,
  live: string | null
): string | null {
  return frozen?.[key] ?? live;
}

function pickFrozenCadastro(value: Record<string, unknown> | null): FrozenCadastro | null {
  if (!value) return null;
  const picked: FrozenCadastro = {};
  for (const key of FROZEN_CADASTRO_KEYS) {
    const field = value[key];
    if (typeof field === "string" && field.trim()) {
      picked[key] = field;
    }
  }
  return Object.keys(picked).length > 0 ? picked : null;
}

function parseObject(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
