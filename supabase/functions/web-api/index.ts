/**
 * Entrada Deno da `web-api`: liga o handler (`handler.ts`, testavel) ao Supabase de verdade.
 *
 * `verify_jwt = false` no `config.toml` de proposito: quem valida o usuario e
 * `resolveWebSession` (token da sessao -> `auth.getUser` -> `user_profiles`), e o preflight
 * CORS do navegador (OPTIONS, sem Authorization) precisa passar pelo gateway.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveWebSession, type WebSessionClient } from "../_shared/web-session.ts";
import { ensureWebDevice, type WebDeviceClient } from "../_shared/web-device.ts";
import {
  handleWebApiRequest,
  type OmieBridge,
  type Row,
  type RowFilter,
  type WebApiStore
} from "./handler.ts";

/** Mesmo motivo do `admin-api`: sem um tipo `Database` gerado, o retorno concreto engessa. */
type Client = SupabaseClient;

function throwIf(table: string, error: { message: string; code?: string } | null): void {
  if (error) throw new Error(`${table}: ${error.message} (code=${error.code ?? "n/a"})`);
}

function supabaseStore(client: Client): WebApiStore {
  return {
    async getRow(table, companyId, id) {
      const { data, error } = await client
        .from(table)
        .select("*")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      throwIf(table, error);
      return (data as Row | null) ?? null;
    },
    async listRows(table, companyId, columns, filters: RowFilter[], options) {
      let query = client.from(table).select(columns);
      if (!options?.anyCompany) query = query.eq("company_id", companyId);
      for (const filter of filters) {
        if (filter.op === "in") {
          query = query.in(filter.column, filter.value as unknown[]);
        } else if (filter.op === "gte") {
          query = query.gte(filter.column, filter.value);
        } else if (filter.op === "lte") {
          query = query.lte(filter.column, filter.value);
        } else {
          query =
            filter.value === null
              ? query.is(filter.column, null)
              : query.eq(filter.column, filter.value);
        }
      }
      if (options?.live) query = query.is("deleted_at", null);
      if (options?.orderBy) {
        query = query.order(options.orderBy.column, { ascending: options.orderBy.ascending });
      }
      if (options?.limit) query = query.limit(options.limit);
      const { data, error } = await query;
      throwIf(table, error);
      return (data as Row[] | null) ?? [];
    },
    async insertRow(table, row) {
      const { error } = await client.from(table).insert(row);
      throwIf(table, error);
    },
    async updateRow(table, companyId, id, patch) {
      // Vinculos antigos tem `company_id` nulo (ver `ListRowsOptions.anyCompany`); o filtro
      // por empresa aqui ignoraria a linha. O id ja veio de uma leitura escopada.
      let query = client.from(table).update(patch).eq("id", id);
      if (!LINK_TABLES.has(table)) query = query.eq("company_id", companyId);
      const { error } = await query;
      throwIf(table, error);
    }
  };
}

const LINK_TABLES: ReadonlySet<string> = new Set([
  "customer_carriers",
  "customer_vehicles",
  "driver_carriers",
  "vehicle_carriers"
]);

/**
 * Chama a `omie-sync` como o dispositivo virtual da empresa. E uma chamada HTTP entre
 * funcoes de proposito: a `omie-sync` continua com um unico modo de autenticacao (por
 * dispositivo), e o site herda todo o comportamento que a balanca ja tem la — reaproveitar
 * cadastro que existe por CNPJ, codigo de integracao, tags.
 */
function omieBridge(client: Client, supabaseUrl: string, serviceRoleKey: string): OmieBridge {
  return {
    async push(action, payload, scope) {
      const device = await ensureWebDevice(client as unknown as WebDeviceClient, {
        companyId: scope.companyId,
        unitId: scope.unitId,
        serviceRoleKey
      });
      const response = await fetch(`${supabaseUrl}/functions/v1/omie-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey
        },
        body: JSON.stringify({
          deviceId: device.deviceId,
          deviceToken: device.deviceToken,
          action,
          payload
        })
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        omieCustomerId?: unknown;
      };
      const omieCustomerId = Number(body.omieCustomerId);
      if (!response.ok || !body.ok || !Number.isFinite(omieCustomerId) || omieCustomerId <= 0) {
        throw new Error(body.error ?? `OMIE respondeu ${response.status}`);
      }
      return { omieCustomerId };
    }
  };
}

Deno.serve((req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const client = createClient(supabaseUrl, serviceRoleKey);
  return handleWebApiRequest(req, {
    store: supabaseStore(client),
    resolveSession: (authorization) =>
      resolveWebSession(client as unknown as WebSessionClient, authorization),
    omie: omieBridge(client, supabaseUrl, serviceRoleKey)
  });
});
