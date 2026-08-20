/**
 * Nome (apelido) de uma balanca no painel administrativo.
 *
 * O nome e o rotulo que TODAS as maquinas da pedreira exibem para aquele
 * computador: legenda de cores da tela de Operacoes e o campo "Computador" do
 * detalhe da operacao saem do espelho local `devices` de cada desktop, que e
 * reescrito com o `device_registrations` da nuvem.
 *
 * Esta e a mesma regra de `supabase/functions/_shared/device-name.ts`, repetida
 * de proposito: o loader-web nao consegue importar um modulo Deno das Edge
 * Functions (o Dockerfile so instala e builda este workspace). Quem decide de
 * verdade continua sendo a Edge Function — aqui a validacao existe so para a
 * tela avisar antes de fazer a chamada. Se um dos dois lados mudar, mude os
 * dois; os limites estao cobertos por teste nos dois lugares.
 */
export const DEVICE_NAME_MAX_LENGTH = 60;

export type DeviceNameResult = { ok: true; name: string } | { ok: false; error: string };

/** Forma canonica do nome: sem espacos nas pontas nem repetidos no meio. */
export function normalizeDeviceName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Normaliza e valida o nome digitado no painel antes de mandar para a nuvem. */
export function parseDeviceName(raw: string): DeviceNameResult {
  const name = normalizeDeviceName(raw);
  if (!name) {
    return { ok: false, error: "Informe o nome do computador." };
  }
  if (name.length > DEVICE_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `O nome do computador deve ter no maximo ${DEVICE_NAME_MAX_LENGTH} caracteres.`
    };
  }
  return { ok: true, name };
}
