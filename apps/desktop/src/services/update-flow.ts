/**
 * Politica de atualizacao automatica do app do operador.
 *
 * - `AUTO_DOWNLOAD_UPDATES`: assim que uma versao nova e detectada, o
 *   `electron-updater` baixa em segundo plano, sem acao do operador.
 * - `AUTO_INSTALL_ON_QUIT`: a atualizacao baixada e aplicada na proxima vez
 *   que o operador fechar o app, sem interromper a operacao em andamento.
 *
 * O instalador em si e gerado e publicado automaticamente pelo pipeline
 * `.github/workflows/desktop-release.yml` a cada mudanca na `main`, entao nao
 * e preciso gerar um instalador novo manualmente.
 */
import type { UpdateRing, UpdateRingOption } from "./update-candidates.js";

export const AUTO_DOWNLOAD_UPDATES = true;
export const AUTO_INSTALL_ON_QUIT = true;

export const UPDATE_STATUSES = [
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "error"
] as const;

export type UpdateStatus = (typeof UPDATE_STATUSES)[number];

export interface UpdateState {
  status: UpdateStatus;
  availableVersion: string | null;
  errorMessage: string | null;
  /**
   * Anel de onde veio `availableVersion`. `null` quando nao ha versao
   * disponivel ou quando a balanca esta em producao — la so existe um anel e
   * dizer "producao" em cada aviso seria ruido.
   */
  availableRing: UpdateRing | null;
  /**
   * As duas versoes que a balanca de TESTE pode instalar agora, quando o anel
   * de teste e o de producao divergem (ver `update-candidates.ts`). Vem vazio
   * na balanca de producao, que nao escolhe versao.
   */
  ringOptions: UpdateRingOption[];
}

export function createInitialUpdateState(): UpdateState {
  return {
    status: "idle",
    availableVersion: null,
    errorMessage: null,
    availableRing: null,
    ringOptions: []
  };
}

/** Como o anel se chama na tela do operador — que nao conhece `beta`/`latest`. */
export function updateRingLabel(ring: UpdateRing): string {
  return ring === "beta" ? "teste" : "producao";
}

/** Ha o que escolher: os dois aneis tem versao instalavel e elas divergem. */
export function hasUpdateRingChoice(state: UpdateState): boolean {
  return state.ringOptions.length > 1;
}

export function getManualUpdateButtonLabel(status: UpdateStatus, hasChoice = false): string {
  if (hasChoice && status !== "checking" && status !== "downloading") {
    // A balanca de teste com os dois aneis novos nao baixa no clique: ela abre
    // a escolha, porque instalar a versao errada aqui e reinstalar do zero.
    return "Escolher versao para instalar";
  }

  if (status === "available") {
    return "Baixar e instalar atualizacao";
  }

  if (status === "downloaded") {
    return "Reiniciar e instalar";
  }

  if (status === "checking") {
    return "Verificando...";
  }

  if (status === "downloading") {
    return "Baixando...";
  }

  return "Verificar atualizacao";
}

/**
 * O clique em "Atualizar agora" nao pode virar uma VERIFICACAO.
 *
 * O aviso de versao nova so aparece porque o processo principal ja anunciou uma
 * versao — e cada verificacao reanuncia a mesma versao para a tela. Enquanto o
 * botao caia na verificacao (o estado da tela chega pelo ciclo de refresh, e
 * dentro dele "baixando" nao contava como versao em maos), o aviso fechava no
 * clique e reabria segundos depois, em loop, ate o operador clicar em "Mais
 * tarde". Estes tres estados sao os que o processo principal aceita instalar.
 */
export function isUpdateInstallable(status: UpdateStatus): boolean {
  return status === "available" || status === "downloading" || status === "downloaded";
}

/** Verificando ou baixando: o botao so conta o que esta acontecendo, nao age. */
export function isUpdateActionBusy(status: UpdateStatus): boolean {
  return status === "checking" || status === "downloading";
}

/**
 * Se o aviso de versao nova deve subir para esta versao anunciada.
 *
 * O processo principal reanuncia a versao a CADA verificacao — inclusive nas do
 * ciclo automatico. Uma versao que o operador ja respondeu ("Atualizar agora"
 * ou "Mais tarde") nao volta a interromper a pesagem; uma versao diferente,
 * sim.
 */
export function shouldAnnounceUpdate(version: string, answeredVersion: string | null): boolean {
  return version.length > 0 && version !== answeredVersion;
}
