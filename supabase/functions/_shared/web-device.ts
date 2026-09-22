/**
 * O site web como "balanca" da pedreira.
 *
 * Toda integracao com o OMIE entra pela `omie-sync`, e a `omie-sync` autentica por
 * DISPOSITIVO (`deviceId` + `deviceToken` de `device_registrations`). O site nao e uma
 * balanca, mas precisa mandar cliente e transportadora para o OMIE do mesmo jeito que ela —
 * e reaproveitar o caminho que ja existe e mais seguro do que abrir um segundo modo de
 * autenticacao numa funcao de 3 mil linhas.
 *
 * Entao cada empresa ganha UM dispositivo virtual, `web-<company_id>`, criado na primeira
 * vez que o site precisa dele. O token nao e guardado em lugar nenhum: e derivado da chave de
 * servico do Supabase (HMAC), que so as Edge Functions tem. Qualquer funcao consegue
 * recalcula-lo; ninguem de fora consegue.
 *
 * O mesmo registro e o interruptor da Etapa 4 do plano (`docs/plano-migracao-web.md`):
 * marcar `is_price_master = true` NELE faz todas as balancas virarem secundarias de preco no
 * proximo heartbeat, sem mexer no desktop. Por isso este modulo nunca toca `is_price_master`:
 * a virada e um ato explicito, no painel ou por SQL.
 */

import type { PostgrestLikeError } from "./db-read-error.ts";
import { hmacSha256Hex, sha256Hex } from "./crypto.ts";

export const WEB_DEVICE_ID_PREFIX = "web-";
export const WEB_DEVICE_NAME = "Web — Comercial";

export function webDeviceId(companyId: string): string {
  return `${WEB_DEVICE_ID_PREFIX}${companyId}`;
}

export function isWebDeviceId(deviceId: string | null | undefined): boolean {
  return typeof deviceId === "string" && deviceId.startsWith(WEB_DEVICE_ID_PREFIX);
}

/** Token do dispositivo virtual: determinístico a partir da chave de servico, nunca gravado. */
export function webDeviceToken(serviceRoleKey: string, companyId: string): Promise<string> {
  return hmacSha256Hex(serviceRoleKey, `kyberrock:web-device:${companyId}`);
}

export interface WebDeviceClient {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): { maybeSingle(): Promise<{ data: unknown; error: PostgrestLikeError | null }> };
    };
    insert(row: Record<string, unknown>): Promise<{ error: PostgrestLikeError | null }>;
    update(patch: Record<string, unknown>): {
      eq(column: string, value: string): Promise<{ error: PostgrestLikeError | null }>;
    };
  };
}

export interface EnsureWebDeviceInput {
  companyId: string;
  /** Unidade do usuario que esta gravando; o registro precisa de uma (coluna not null). */
  unitId: string;
  serviceRoleKey: string;
  now?: Date;
}

/**
 * Garante o dispositivo virtual da empresa e devolve as credenciais para chamar a `omie-sync`.
 *
 * Se a chave de servico for trocada, o token derivado muda: o hash gravado deixa de bater e e
 * atualizado aqui, sem intervencao. `is_active` NAO e religado: desativar o dispositivo
 * virtual no painel e o jeito de cortar o envio do site para o OMIE, e isso tem de ser
 * respeitado.
 */
export async function ensureWebDevice(
  client: WebDeviceClient,
  input: EnsureWebDeviceInput
): Promise<{ deviceId: string; deviceToken: string }> {
  const deviceId = webDeviceId(input.companyId);
  const deviceToken = await webDeviceToken(input.serviceRoleKey, input.companyId);
  const tokenHash = await sha256Hex(deviceToken);
  const nowIso = (input.now ?? new Date()).toISOString();

  const existing = await client
    .from("device_registrations")
    .select("id, token_hash")
    .eq("id", deviceId)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`Dispositivo web: ${existing.error.message}`);
  }

  const row = existing.data as { id?: string; token_hash?: string } | null;
  if (!row) {
    const { error } = await client.from("device_registrations").insert({
      id: deviceId,
      company_id: input.companyId,
      unit_id: input.unitId,
      name: WEB_DEVICE_NAME,
      token_hash: tokenHash,
      is_active: true,
      is_price_master: false,
      update_channel: "latest",
      // Mesmo valor do id: a ativacao de uma balanca escolhe registro por `installation_id`
      // (`_shared/device-registration.ts`) e nunca pode cair neste.
      installation_id: deviceId,
      created_at: nowIso,
      updated_at: nowIso
    });
    if (error) throw new Error(`Dispositivo web: ${error.message}`);
  } else if (row.token_hash !== tokenHash) {
    const { error } = await client
      .from("device_registrations")
      .update({ token_hash: tokenHash, updated_at: nowIso })
      .eq("id", deviceId);
    if (error) throw new Error(`Dispositivo web: ${error.message}`);
  }

  return { deviceId, deviceToken };
}
