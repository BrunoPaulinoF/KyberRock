/**
 * Nome (apelido) de um desktop ja ativado.
 *
 * O nome nao e enfeite do painel: e o rotulo que TODAS as maquinas da pedreira
 * exibem para aquela balanca — a legenda de cores da tela de Operacoes e o campo
 * "Computador" do detalhe da operacao saem do espelho local `devices`, que o
 * `desktop-status`/`desktop-pull` reescrevem a partir de `device_registrations`.
 *
 * Por isso a validacao mora aqui, pura e testada, em vez de solta no handler:
 *
 * - **vazio nunca chega ao banco** — o espelho local troca nome vazio pelo
 *   generico "Computador" (`apps/desktop/src/services/unit-devices.ts`), entao
 *   salvar em branco pelo painel apagaria a identificacao em todas as maquinas
 *   sem nenhum aviso de erro;
 * - **espacos sao colapsados** — "Balanca   2" e "Balanca 2" viram o mesmo rotulo,
 *   e o nome nao entra na legenda com buraco no meio;
 * - **tamanho e limitado** — a legenda e uma linha so; um nome colado de outro
 *   lugar empurraria as demais balancas para fora da tela.
 */
export const DEVICE_NAME_MAX_LENGTH = 60;

export type DeviceNameResult = { ok: true; name: string } | { ok: false; error: string };

/** Forma canonica do nome: sem espacos nas pontas nem repetidos no meio. */
export function normalizeDeviceName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim();
}

/** Normaliza e valida o nome vindo do painel administrativo. */
export function parseDeviceName(raw: unknown): DeviceNameResult {
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
