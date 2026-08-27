import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";
import { scopeRowsToDevice } from "../_shared/device-scope.ts";
import {
  MAX_UNKNOWN_COLUMN_ROUNDS,
  type PostgrestLikeError,
  rowsHaveColumn,
  stripColumn,
  unknownColumnFromError
} from "../_shared/unknown-column.ts";
import {
  findRowsToRetire,
  isLiveRow,
  naturalKeyOf,
  PRICE_MASTER_TABLES
} from "../_shared/price-master-conflicts.ts";

type CloudPayload = {
  deviceId?: string;
  deviceToken?: string;
  operations?: Record<string, unknown>[];
  loadingRequests?: Record<string, unknown>[];
  printReceipts?: Record<string, unknown>[];
  customers?: Record<string, unknown>[];
  products?: Record<string, unknown>[];
  carriers?: Record<string, unknown>[];
  drivers?: Record<string, unknown>[];
  vehicles?: Record<string, unknown>[];
  customerCarriers?: Record<string, unknown>[];
  customerVehicles?: Record<string, unknown>[];
  driverCarriers?: Record<string, unknown>[];
  vehicleCarriers?: Record<string, unknown>[];
  productDefaultPrices?: Record<string, unknown>[];
  customerSpecialPrices?: Record<string, unknown>[];
  priceTables?: Record<string, unknown>[];
  priceTableItems?: Record<string, unknown>[];
  customerPriceTables?: Record<string, unknown>[];
  customerFreightRules?: Record<string, unknown>[];
  customerFutureBillingInvoices?: Record<string, unknown>[];
  paymentTerms?: Record<string, unknown>[];
  paymentMethods?: Record<string, unknown>[];
  accounts?: Record<string, unknown>[];
  customerCreditMovements?: Record<string, unknown>[];
  reportRecipients?: Record<string, unknown>[];
  reportChannelSettings?: Record<string, unknown>;
  avgQuarryMinutes?: number;
};

// Cadastro compartilhado da pedreira, na ordem em que precisa ser gravado
// (dependencias de FK antes dos dependentes). Cada desktop empurra o que
// cadastrou e o desktop-pull devolve o conjunto para todas as maquinas.
const CADASTRO_TABLES = [
  { key: "carriers", table: "carriers" },
  { key: "drivers", table: "drivers" },
  { key: "vehicles", table: "vehicles" },
  { key: "customerCarriers", table: "customer_carriers" },
  // Placas do cliente: depois de vehicles, que ela referencia.
  { key: "customerVehicles", table: "customer_vehicles" },
  { key: "driverCarriers", table: "driver_carriers" },
  { key: "vehicleCarriers", table: "vehicle_carriers" },
  { key: "productDefaultPrices", table: "product_default_prices" },
  { key: "customerSpecialPrices", table: "customer_special_prices" },
  { key: "priceTables", table: "price_tables" },
  { key: "priceTableItems", table: "price_table_items" },
  { key: "customerPriceTables", table: "customer_price_tables" },
  { key: "customerFreightRules", table: "customer_freight_rules" },
  { key: "customerFutureBillingInvoices", table: "customer_future_billing_invoices" },
  { key: "paymentTerms", table: "payment_terms" },
  { key: "paymentMethods", table: "payment_methods" },
  { key: "accounts", table: "accounts" },
  // Credito do cliente: sincroniza so o log de movimentos, que e append-only e
  // por isso funde sem conflito. O saldo e recalculado a partir dele em cada
  // maquina — sincronizar o saldo direto faria uma maquina sobrescrever o
  // debito que a outra acabou de lancar.
  { key: "customerCreditMovements", table: "customer_credit_movements" }
] as const;

type SyncDeviceRow = {
  id: string;
  token_hash: string;
  is_active: boolean;
  unit_id: string;
  company_id: string;
  /** Ausente na leitura de emergencia (migracao ainda nao aplicada). */
  is_price_master?: boolean | null;
};

const DEVICE_SYNC_COLUMNS = "id, token_hash, is_active, unit_id, company_id";

/**
 * Le o registro da balanca tolerando `is_price_master` ainda nao existir (o CI implanta a
 * funcao a cada push, e as migracoes SQL sao aplicadas a parte). Sem a coluna a balanca
 * simplesmente nao e principal, que e o comportamento anterior a ela.
 */
async function selectDeviceForSync(
  supabase: ReturnType<typeof createClient>,
  deviceId: string
): Promise<{ data: Record<string, unknown> | null; error: unknown }> {
  const withMaster = await supabase
    .from("device_registrations")
    .select(`${DEVICE_SYNC_COLUMNS}, is_price_master`)
    .eq("id", deviceId)
    .single();
  if (!withMaster.error) {
    return { data: withMaster.data as Record<string, unknown> | null, error: null };
  }

  const fallback = await supabase
    .from("device_registrations")
    .select(DEVICE_SYNC_COLUMNS)
    .eq("id", deviceId)
    .single();
  return { data: fallback.data as Record<string, unknown> | null, error: fallback.error };
}

/**
 * Tira da frente a linha de outra balanca que ocupa a chave natural que a PRINCIPAL esta
 * enviando — ver `_shared/price-master-conflicts.ts` para o porque.
 *
 * Duas consultas por tabela, nao uma por linha: uma leitura das linhas vivas da empresa
 * restrita a primeira coluna da chave, e um unico UPDATE nos ids que precisam ceder.
 *
 * Falha aqui entra em `stepErrors` como qualquer outra: sem a liberacao o upsert seguinte
 * seria recusado pelo indice unico de qualquer jeito, entao a passada precisa mesmo ser
 * refeita — e o motivo verdadeiro fica registrado em vez de so o 23505 que ele causa.
 */
async function clearPriceMasterConflicts(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  payload: CloudPayload
): Promise<string[]> {
  const warnings: string[] = [];

  for (const entry of PRICE_MASTER_TABLES) {
    const rows = payload[entry.payloadKey as keyof CloudPayload] as
      | Record<string, unknown>[]
      | undefined;
    if (!rows?.length) continue;

    // Linha enviada como excluida nao vai ocupar o indice: nao derruba ninguem.
    const incoming = rows
      .filter(isLiveRow)
      .map((row) => ({ id: String(row.id ?? ""), key: naturalKeyOf(row, entry.naturalKey) }))
      .filter((row) => row.id);
    if (incoming.length === 0) continue;

    const [firstColumn] = entry.naturalKey;
    const firstValues = [
      ...new Set(
        incoming
          .map((row) => row.key[0])
          .filter((value): value is string => typeof value === "string")
      )
    ];
    if (firstValues.length === 0) continue;

    const { data, error } = await supabase
      .from(entry.table)
      .select(`id, ${entry.naturalKey.join(", ")}`)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in(firstColumn, firstValues);
    if (error) {
      warnings.push(`${entry.table}: ${error.message} (code=${error.code ?? "n/a"})`);
      continue;
    }

    const existing = ((data ?? []) as Record<string, unknown>[])
      .map((row) => ({ id: String(row.id ?? ""), key: naturalKeyOf(row, entry.naturalKey) }))
      .filter((row) => row.id);
    const retire = findRowsToRetire(incoming, existing);
    if (retire.length === 0) continue;

    const retiredAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from(entry.table)
      .update({
        deleted_at: retiredAt,
        updated_at: retiredAt,
        ...(entry.hasIsActive ? { is_active: false } : {})
      })
      .in("id", retire);
    if (updateError) {
      warnings.push(`${entry.table}: ${updateError.message} (code=${updateError.code ?? "n/a"})`);
      continue;
    }

    console.info("desktop-sync: cadastro de preco cedeu para a balanca principal", {
      table: entry.table,
      retired: retire.length
    });
  }

  return warnings;
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let body: CloudPayload;
    try {
      body = (await req.json()) as CloudPayload;
    } catch {
      return jsonResponse({ error: "Corpo da requisicao invalido" }, 400);
    }

    const deviceId = String(body.deviceId ?? "");
    const deviceToken = String(body.deviceToken ?? "");
    if (!deviceId || !deviceToken) {
      return jsonResponse({ error: "deviceId e deviceToken sao obrigatorios" }, 400);
    }

    const { data: deviceRow, error: deviceError } = await selectDeviceForSync(supabase, deviceId);
    const device = deviceRow as SyncDeviceRow | null;
    if (deviceError || !device?.is_active) {
      return jsonResponse({ error: "Dispositivo nao autorizado" }, 401);
    }

    const tokenHash = await sha256Hex(deviceToken);
    if (!safeEqual(tokenHash, device.token_hash)) {
      return jsonResponse({ error: "Token de dispositivo invalido" }, 401);
    }

    const counts = {
      customers: 0,
      products: 0,
      operations: 0,
      loadingRequests: 0,
      printReceipts: 0,
      reportRecipients: 0,
      cadastro: 0
    };
    const stepErrors: string[] = [];
    // Colunas que o desktop enviou e a nuvem ainda nao tem (migracao pendente).
    // Saem do payload em vez de derrubar o lote inteiro — ver `_shared/unknown-column.ts`.
    const droppedColumns: string[] = [];
    const upsert = (
      table: string,
      rows: Record<string, unknown>[],
      onConflict: string
    ): Promise<{ error: PostgrestLikeError | null }> =>
      upsertSkippingUnknownColumns(supabase, table, rows, onConflict, droppedColumns);

    // Ordem importa: dependencias antes de dependentes (FK customers/products -> operations/loadingRequests/printReceipts).
    if (body.customers?.length) {
      const { error } = await upsert("customers", body.customers, "id");
      if (error) {
        stepErrors.push(`customers: ${error.message} (code=${error.code ?? "n/a"})`);
      } else {
        counts.customers = body.customers.length;
      }
    }
    if (body.products?.length) {
      const { error } = await upsert("products", body.products, "id");
      if (error) {
        stepErrors.push(`products: ${error.message} (code=${error.code ?? "n/a"})`);
      } else {
        counts.products = body.products.length;
      }
    }
    // Quem envia e a balanca principal de precos: a linha de outra maquina que disputa a
    // mesma chave natural cede ANTES do upsert, senao o indice unico da nuvem recusa
    // justamente o preco que deveria valer para a pedreira inteira.
    if (device.is_price_master === true) {
      stepErrors.push(...(await clearPriceMasterConflicts(supabase, device.company_id, body)));
    }

    for (const { key, table } of CADASTRO_TABLES) {
      const rows = body[key];
      if (!rows?.length) continue;
      // company_id vem sempre do registro do dispositivo: um desktop nunca grava
      // cadastro em outra pedreira, mesmo que envie outro id no payload.
      const scoped = rows.map((row) => ({ ...row, company_id: device.company_id }));
      const { error } = await upsert(table, scoped, "id");
      if (error) {
        stepErrors.push(`${table}: ${error.message} (code=${error.code ?? "n/a"})`);
      } else {
        counts.cadastro += rows.length;
      }
    }
    if (body.operations?.length) {
      // Com varios desktops na mesma pedreira, uma maquina pode re-enviar uma
      // copia desatualizada de operacao criada/fechada em outra. Descarta
      // escritas mais antigas que a versao ja projetada na nuvem e nunca
      // regride um status terminal (fechada/cancelada) para um status aberto.
      const operations = await dropStaleOperationWrites(
        supabase,
        scopeRowsToDevice(body.operations, device)
      );
      if (operations.length) {
        const { error } = await upsert("weighing_operations", operations, "id");
        if (error) {
          stepErrors.push(`weighing_operations: ${error.message} (code=${error.code ?? "n/a"})`);
        } else {
          counts.operations = operations.length;
        }
      }
    }
    if (body.loadingRequests?.length) {
      const loadingRequests = await mergeLoadingRequestWrites(
        supabase,
        scopeRowsToDevice(body.loadingRequests, device)
      );
      if (loadingRequests.length) {
        const { error } = await upsert("loading_requests", loadingRequests, "id");
        if (error) {
          stepErrors.push(`loading_requests: ${error.message} (code=${error.code ?? "n/a"})`);
        } else {
          counts.loadingRequests = loadingRequests.length;
        }
      }
    }
    if (body.printReceipts?.length) {
      const { error } = await upsert("print_receipts", body.printReceipts, "id");
      if (error) {
        stepErrors.push(`print_receipts: ${error.message} (code=${error.code ?? "n/a"})`);
      } else {
        counts.printReceipts = body.printReceipts.length;
      }
    }
    if (body.reportRecipients?.length) {
      const { error } = await upsert("report_recipients", body.reportRecipients, "id");
      if (error) {
        stepErrors.push(`report_recipients: ${error.message} (code=${error.code ?? "n/a"})`);
      } else {
        counts.reportRecipients = body.reportRecipients.length;
      }
    }
    // Configuracao dos canais de envio (SMTP/WhatsApp) da empresa: um registro
    // por empresa, usado pelo daily-report-email no lugar dos envs.
    if (body.reportChannelSettings && typeof body.reportChannelSettings === "object") {
      const { error } = await upsert(
        "report_channel_settings",
        [body.reportChannelSettings],
        "company_id"
      );
      if (error) {
        stepErrors.push(`report_channel_settings: ${error.message} (code=${error.code ?? "n/a"})`);
      }
    }

    // Media de tempo dentro da pedreira: projetada na unidade para o alerta do
    // carregador. So atualiza quando o desktop envia um numero valido.
    if (
      typeof body.avgQuarryMinutes === "number" &&
      Number.isFinite(body.avgQuarryMinutes) &&
      body.avgQuarryMinutes > 0 &&
      device.unit_id
    ) {
      const { error } = await supabase
        .from("units")
        .update({ avg_quarry_minutes: Math.round(body.avgQuarryMinutes) })
        .eq("id", device.unit_id);
      if (error) {
        stepErrors.push(`units.avg_quarry_minutes: ${error.message} (code=${error.code ?? "n/a"})`);
      }
    }

    // Heartbeat sempre: nao perder o last_seen_at mesmo se algum upsert falhou.
    await supabase
      .from("device_registrations")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", deviceId);

    // Migracao pendente: o dado foi gravado sem o campo novo. Nao e erro (o
    // desktop reenvia e o campo entra depois), mas precisa ficar no log do
    // projeto para alguem aplicar a migracao que falta.
    if (droppedColumns.length > 0) {
      console.warn("desktop-sync: colunas ausentes na nuvem foram ignoradas", {
        deviceId,
        droppedColumns
      });
    }

    if (stepErrors.length > 0) {
      // Tambem no log do projeto: o desktop mostra o `details` ao operador, mas
      // sem isto nao havia como investigar depois pelo painel do Supabase — os
      // logs so registravam "POST | 500" sem a causa.
      console.error("desktop-sync: falha ao persistir payloads", {
        deviceId,
        stepErrors
      });
      return jsonResponse(
        {
          error: "Falha ao persistir alguns payloads",
          details: stepErrors,
          counts,
          droppedColumns
        },
        500
      );
    }

    return jsonResponse({ ok: true, counts, droppedColumns });
  } catch (error) {
    return jsonResponse(
      {
        error: "Erro interno no desktop-sync",
        details: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
});

/**
 * Upsert que sobrevive a uma migracao ainda nao aplicada na nuvem.
 *
 * O PostgREST recusa o lote INTEIRO (PGRST204) quando o payload traz uma coluna
 * que a tabela nao tem — e a balanca costuma ser atualizada antes das migracoes.
 * Aqui a coluna desconhecida sai do payload e a gravacao e refeita, uma coluna
 * por rodada (o PostgREST so reporta a primeira). Erro de qualquer outra
 * natureza continua subindo intacto: so a defasagem de schema e tolerada.
 *
 * As colunas descartadas voltam em `droppedColumns` para virarem aviso.
 */
async function upsertSkippingUnknownColumns(
  supabase: SupabaseServiceClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  droppedColumns: string[]
): Promise<{ error: PostgrestLikeError | null }> {
  let payload = rows;
  for (let round = 0; round < MAX_UNKNOWN_COLUMN_ROUNDS; round++) {
    const { error } = await supabase.from(table).upsert(payload, { onConflict });
    if (!error) return { error: null };

    const missing = unknownColumnFromError(error);
    // Coluna que o payload nao envia: reenviar o mesmo lote so repetiria o erro.
    if (!missing || !rowsHaveColumn(payload, missing)) return { error };

    droppedColumns.push(`${table}.${missing}`);
    payload = stripColumn(payload, missing);
  }
  return {
    error: {
      code: "PGRST204",
      message: `${table}: colunas demais ausentes na nuvem (${MAX_UNKNOWN_COLUMN_ROUNDS} rodadas). Aplique as migracoes pendentes de supabase/migrations.`
    }
  };
}

// Status de operacao que nao pode voltar para aberto por um re-envio atrasado.
const TERMINAL_OPERATION_STATUSES = new Set([
  "closed_local",
  "pending_cloud",
  "pending_omie",
  "synced",
  "sync_error",
  "cancelled"
]);

type SupabaseServiceClient = ReturnType<typeof createClient>;

async function dropStaleOperationWrites(
  supabase: SupabaseServiceClient,
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const ids = rows.map((row) => String(row.id ?? "")).filter(Boolean);
  if (!ids.length) return rows;
  const { data: existing, error } = await supabase
    .from("weighing_operations")
    .select("id, status, updated_at")
    .in("id", ids);
  // Sem como comparar, mantem o comportamento antigo (upsert direto).
  if (error || !existing) return rows;
  const currentById = new Map(
    (existing as Array<{ id: string; status: string | null; updated_at: string | null }>).map(
      (row) => [row.id, row]
    )
  );
  return rows.filter((row) => {
    const current = currentById.get(String(row.id ?? ""));
    if (!current) return true;
    const incomingStatus = String(row.status ?? "");
    const currentStatus = String(current.status ?? "");
    if (
      TERMINAL_OPERATION_STATUSES.has(currentStatus) &&
      !TERMINAL_OPERATION_STATUSES.has(incomingStatus)
    ) {
      return false;
    }
    const incomingTs = Date.parse(String(row.updated_at ?? ""));
    const currentTs = Date.parse(String(current.updated_at ?? ""));
    if (Number.isFinite(incomingTs) && Number.isFinite(currentTs) && incomingTs < currentTs) {
      return false;
    }
    return true;
  });
}

async function mergeLoadingRequestWrites(
  supabase: SupabaseServiceClient,
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const ids = rows.map((row) => String(row.id ?? "")).filter(Boolean);
  if (!ids.length) return rows;
  const { data: existing, error } = await supabase
    .from("loading_requests")
    .select("id, status, updated_at, loader_completed_at")
    .in("id", ids);
  if (error || !existing) return rows;
  const currentById = new Map(
    (
      existing as Array<{
        id: string;
        status: string | null;
        updated_at: string | null;
        loader_completed_at: string | null;
      }>
    ).map((row) => [row.id, row])
  );
  const merged: Record<string, unknown>[] = [];
  for (const row of rows) {
    const current = currentById.get(String(row.id ?? ""));
    if (!current) {
      merged.push(row);
      continue;
    }
    const incomingStatus = String(row.status ?? "");
    const currentStatus = String(current.status ?? "");
    if (currentStatus !== "open" && incomingStatus === "open") {
      continue; // fechada/cancelada em outra maquina; nao reabre
    }
    const incomingTs = Date.parse(String(row.updated_at ?? ""));
    const currentTs = Date.parse(String(current.updated_at ?? ""));
    if (Number.isFinite(incomingTs) && Number.isFinite(currentTs) && incomingTs < currentTs) {
      continue;
    }
    // Conclusao do carregador chega direto na nuvem (loader-web); um re-envio do
    // desktop sem esse campo nao pode apaga-la.
    if (!row.loader_completed_at && current.loader_completed_at) {
      merged.push({ ...row, loader_completed_at: current.loader_completed_at });
    } else {
      merged.push(row);
    }
  }
  return merged;
}
