import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";

type PullBody = {
  deviceId?: string;
  deviceToken?: string;
  /**
   * Quando informado, o cadastro compartilhado volta so com o que mudou depois
   * deste instante. O desktop usa nos pulls frequentes e omite na sincronizacao
   * completa, que reenvia o cadastro inteiro e se auto-corrige.
   */
  cadastroSince?: string;
  /**
   * Mesma ideia para o historico (operacoes, solicitacoes e cupons): o pull
   * frequente do desktop so precisa do que as outras balancas mexeram desde o
   * ciclo anterior, o que deixa a resposta pequena o bastante para rodar a cada
   * poucos segundos. Sem ela a janela recente inteira volta a cada chamada.
   */
  historySince?: string;
  /**
   * Modo leve para a "luz" do carregador: devolve so as solicitacoes de
   * carregamento abertas da unidade (id, status, loader_completed_at,
   * updated_at). O desktop chama com frequencia para refletir concluir/cancelar
   * carga do loader-web quase em tempo real — a leitura direta da tabela nao
   * funciona no desktop porque a RLS de loading_requests so atende o perfil
   * autenticado do carregador.
   */
  loaderCompletionsOnly?: boolean;
};

// PostgREST limita cada resposta (max-rows, 1000 por padrao). Sem paginacao a
// pedreira com mais de mil clientes recebia so o primeiro lote e o desktop novo
// ficava com cadastro pela metade — por isso todo select aqui passa por fetchAll.
const PAGE_SIZE = 1000;
const MAX_PAGES = 200;
// Historico (operacoes, solicitacoes, cupons) cresce sem limite: o desktop so
// precisa da janela recente. Ja o cadastro (clientes, produtos, transportadoras,
// motoristas, veiculos, vinculos, precos) vem inteiro — e o que precisa ficar
// igual em todos os computadores da pedreira.
const HISTORY_MAX_ROWS = 2000;

// Tabela ausente no projeto (migracao nao aplicada). Nao pode derrubar o pull
// inteiro: o desktop ainda precisa receber as demais tabelas.
function isMissingTableError(error: { code?: string | null; message?: string | null }): boolean {
  const code = error.code ?? "";
  if (code === "42P01" || code === "PGRST205" || code === "PGRST204") return true;
  return /schema cache|does not exist|no such table/i.test(error.message ?? "");
}

type FetchResult = { rows: Record<string, unknown>[]; warning: string | null };

type QueryOutcome = {
  data: Record<string, unknown>[] | null;
  error: { code?: string | null; message?: string | null } | null;
};

/** Executa a consulta em faixas sucessivas ate a ultima pagina parcial. */
async function fetchAll(
  table: string,
  run: (from: number, to: number) => PromiseLike<QueryOutcome>,
  maxRows = Number.POSITIVE_INFINITY
): Promise<FetchResult> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    if (from >= maxRows) break;
    const { data, error } = await run(from, Math.min(from + PAGE_SIZE, maxRows) - 1);
    if (error) {
      if (isMissingTableError(error)) {
        return {
          rows,
          warning: `${table}: tabela ausente na nuvem (aplique as migracoes do Supabase) — ${error.message}`
        };
      }
      return { rows, warning: `${table}: ${error.message} (code=${error.code ?? "n/a"})` };
    }
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { rows, warning: null };
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let body: PullBody;
    try {
      body = (await req.json()) as PullBody;
    } catch {
      return jsonResponse({ error: "Corpo da requisicao invalido" }, 400);
    }

    const deviceId = String(body.deviceId ?? "");
    const deviceToken = String(body.deviceToken ?? "");
    if (!deviceId || !deviceToken) {
      return jsonResponse({ error: "deviceId e deviceToken sao obrigatorios" }, 400);
    }

    const { data: device, error: deviceError } = await supabase
      .from("device_registrations")
      .select("id, company_id, unit_id, token_hash, is_active")
      .eq("id", deviceId)
      .single();
    if (deviceError || !device?.is_active) {
      return jsonResponse({ error: "Dispositivo nao autorizado" }, 401);
    }

    const tokenHash = await sha256Hex(deviceToken);
    if (!safeEqual(tokenHash, device.token_hash)) {
      return jsonResponse({ error: "Token de dispositivo invalido" }, 401);
    }

    const companyId = device.company_id;
    const unitId = device.unit_id;

    if (body.loaderCompletionsOnly) {
      const loaderCompletions = await fetchAll(
        "loading_requests",
        (from, to) =>
          supabase
            .from("loading_requests")
            .select("id, status, loader_completed_at, updated_at")
            .eq("unit_id", unitId)
            .eq("status", "open")
            .order("id", { ascending: true })
            .range(from, to),
        HISTORY_MAX_ROWS
      );
      return jsonResponse({
        ok: true,
        serverTime: new Date().toISOString(),
        loadingRequests: loaderCompletions.rows,
        warnings: loaderCompletions.warning ? [loaderCompletions.warning] : []
      });
    }

    const cadastroSince =
      typeof body.cadastroSince === "string" && body.cadastroSince.trim()
        ? body.cadastroSince.trim()
        : null;
    const historySince =
      typeof body.historySince === "string" && body.historySince.trim()
        ? body.historySince.trim()
        : null;

    // Ordenacao por id garante paginacao estavel (sem pular/repetir linha entre
    // faixas quando varios registros tem o mesmo created_at).
    const byCompany = (table: string) =>
      fetchAll(table, (from, to) => {
        const query = supabase
          .from(table)
          .select("*")
          .eq("company_id", companyId)
          .order("id", { ascending: true });
        return (cadastroSince ? query.gt("updated_at", cadastroSince) : query).range(from, to);
      });

    const [
      customers,
      products,
      operations,
      loadingRequests,
      printReceipts,
      devices,
      carriers,
      drivers,
      vehicles,
      customerCarriers,
      driverCarriers,
      vehicleCarriers,
      productDefaultPrices,
      customerSpecialPrices,
      priceTables,
      priceTableItems,
      customerPriceTables,
      customerFreightRules,
      paymentTerms,
      paymentMethods,
      accounts,
      customerCreditMovements,
      reportRecipients
    ] = await Promise.all([
      byCompany("customers"),
      byCompany("products"),
      fetchAll(
        "weighing_operations",
        (from, to) => {
          const query = supabase
            .from("weighing_operations")
            .select("*")
            .eq("company_id", companyId)
            .eq("unit_id", unitId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: true });
          return (historySince ? query.gt("updated_at", historySince) : query).range(from, to);
        },
        HISTORY_MAX_ROWS
      ),
      fetchAll(
        "loading_requests",
        (from, to) => {
          const query = supabase
            .from("loading_requests")
            .select("*")
            .eq("company_id", companyId)
            .eq("unit_id", unitId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: true });
          return (historySince ? query.gt("updated_at", historySince) : query).range(from, to);
        },
        HISTORY_MAX_ROWS
      ),
      fetchAll(
        "print_receipts",
        (from, to) => {
          const query = supabase
            .from("print_receipts")
            .select("*")
            .eq("unit_id", unitId)
            .order("printed_at", { ascending: false })
            .order("id", { ascending: true });
          return (historySince ? query.gt("updated_at", historySince) : query).range(from, to);
        },
        HISTORY_MAX_ROWS
      ),
      // Dispositivos da unidade: nome + cor para a legenda multi-desktop e para
      // satisfazer a FK local device_id das operacoes criadas em outras maquinas.
      fetchAll("device_registrations", (from, to) =>
        supabase
          .from("device_registrations")
          .select(
            "id, company_id, unit_id, name, color, device_number, installation_id, is_active, created_at, updated_at"
          )
          .eq("unit_id", unitId)
          .order("id", { ascending: true })
          .range(from, to)
      ),
      // Cadastro compartilhado da pedreira: sem ele um desktop novo entrava sem
      // transportadoras/motoristas/veiculos/precos ate refazer todo o pull do OMIE
      // (e mesmo assim perdia o que foi cadastrado localmente na outra maquina).
      byCompany("carriers"),
      byCompany("drivers"),
      byCompany("vehicles"),
      byCompany("customer_carriers"),
      byCompany("driver_carriers"),
      byCompany("vehicle_carriers"),
      byCompany("product_default_prices"),
      byCompany("customer_special_prices"),
      byCompany("price_tables"),
      byCompany("price_table_items"),
      byCompany("customer_price_tables"),
      byCompany("customer_freight_rules"),
      byCompany("payment_terms"),
      byCompany("payment_methods"),
      byCompany("accounts"),
      // Log de credito (fiado): append-only, fonte do saldo recalculado localmente.
      byCompany("customer_credit_movements"),
      byCompany("report_recipients")
    ]);

    // Falha por tabela nao derruba o pull: o desktop recebe o que deu certo e a
    // lista de avisos (mostrada nos erros de sincronizacao) diz o que faltou.
    const warnings = [
      customers,
      products,
      operations,
      loadingRequests,
      printReceipts,
      devices,
      carriers,
      drivers,
      vehicles,
      customerCarriers,
      driverCarriers,
      vehicleCarriers,
      productDefaultPrices,
      customerSpecialPrices,
      priceTables,
      priceTableItems,
      customerPriceTables,
      customerFreightRules,
      paymentTerms,
      paymentMethods,
      accounts,
      customerCreditMovements,
      reportRecipients
    ]
      .map((result) => result.warning)
      .filter((warning): warning is string => Boolean(warning));

    await supabase
      .from("device_registrations")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", deviceId);

    return jsonResponse({
      ok: true,
      // Relogio do servidor: o desktop guarda para pedir o proximo incremento do
      // cadastro sem depender do relogio local da maquina.
      serverTime: new Date().toISOString(),
      customers: customers.rows,
      products: products.rows,
      operations: operations.rows,
      loadingRequests: loadingRequests.rows,
      printReceipts: printReceipts.rows,
      devices: devices.rows,
      carriers: carriers.rows,
      drivers: drivers.rows,
      vehicles: vehicles.rows,
      customerCarriers: customerCarriers.rows,
      driverCarriers: driverCarriers.rows,
      vehicleCarriers: vehicleCarriers.rows,
      productDefaultPrices: productDefaultPrices.rows,
      customerSpecialPrices: customerSpecialPrices.rows,
      priceTables: priceTables.rows,
      priceTableItems: priceTableItems.rows,
      customerPriceTables: customerPriceTables.rows,
      customerFreightRules: customerFreightRules.rows,
      paymentTerms: paymentTerms.rows,
      paymentMethods: paymentMethods.rows,
      accounts: accounts.rows,
      customerCreditMovements: customerCreditMovements.rows,
      reportRecipients: reportRecipients.rows,
      warnings
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "Erro interno no desktop-pull",
        details: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
});
