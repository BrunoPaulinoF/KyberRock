import { describe, expect, it } from "vitest";

import { intentsFor, PROMOTION_ACTIONS } from "./DesktopUpdates";
import type { ReleaseRow } from "./DesktopUpdates";
import type { ReleaseState } from "../lib/desktop-updates";

function row(
  version: string,
  state: ReleaseState,
  overrides: Partial<ReleaseRow> = {}
): ReleaseRow {
  return {
    version,
    tag: `v${version}`,
    state,
    isCurrentProduction: false,
    publishedAt: "2026-08-20T10:00:00.000Z",
    installerName: `KyberRock-Desktop-Setup-${version}.exe`,
    isOlderThanProduction: false,
    isNewerThanProduction: false,
    canSendToTest: false,
    canReleaseToProduction: false,
    canReject: false,
    ...overrides
  };
}

describe("intentsFor", () => {
  it("build novo parado: enviar para teste e reprovar", () => {
    const build = row("0.8.201", "parado", {
      isNewerThanProduction: true,
      canSendToTest: true,
      canReject: true
    });

    expect(intentsFor(build)).toEqual(["beta", "reprovar"]);
  });

  it("versao em teste no caminho normal: liberar para producao e reprovar", () => {
    const teste = row("0.8.201", "teste", {
      isNewerThanProduction: true,
      canReleaseToProduction: true,
      canReject: true
    });

    expect(intentsFor(teste)).toEqual(["latest", "reprovar"]);
  });

  it("a producao atual nao oferece gesto nenhum", () => {
    expect(intentsFor(row("0.8.200", "producao", { isCurrentProduction: true }))).toEqual([]);
  });

  it("versao anterior oferece so a volta atras, mesmo podendo ser reprovada", () => {
    // Reprovar aqui travaria para sempre a versao que existe para ser o porto
    // seguro da frota.
    const anterior = row("0.8.193", "parado", {
      isOlderThanProduction: true,
      canSendToTest: true,
      canReject: true
    });

    expect(intentsFor(anterior)).toEqual(["rollback-test"]);
  });

  it("versao anterior ja em teste oferece regredir a producao", () => {
    const emTeste = row("0.8.193", "teste", { isOlderThanProduction: true, canReject: true });

    expect(intentsFor(emTeste)).toEqual(["rollback-production"]);
  });

  it("versao de onde se voltou oferece retomar a producao", () => {
    const regredida = row("0.8.200", "producao", { isNewerThanProduction: true });

    expect(intentsFor(regredida)).toEqual(["resume"]);
  });

  it("versao anterior reprovada ou incompleta nao volta a circular", () => {
    expect(intentsFor(row("0.8.193", "reprovada", { isOlderThanProduction: true }))).toEqual([]);
    expect(intentsFor(row("0.8.193", "incompleto", { isOlderThanProduction: true }))).toEqual([]);
  });
});

describe("PROMOTION_ACTIONS", () => {
  it("a volta atras comeca no anel de teste, sem forcar nada", () => {
    expect(PROMOTION_ACTIONS["rollback-test"].target).toBe("beta");
    expect(PROMOTION_ACTIONS["rollback-test"].force).toBe(false);
  });

  it("regredir e retomar producao precisam de force: o workflow recusa sem ele", () => {
    // Guardas 3a (producao sem passar pelo teste) e 3b (versao mais antiga) do
    // `desktop-promote.yml` so cedem com force.
    expect(PROMOTION_ACTIONS["rollback-production"].target).toBe("latest");
    expect(PROMOTION_ACTIONS["rollback-production"].force).toBe(true);
    expect(PROMOTION_ACTIONS.resume.target).toBe("latest");
    expect(PROMOTION_ACTIONS.resume.force).toBe(true);
  });

  it("os gestos do caminho normal nunca forcam", () => {
    expect(PROMOTION_ACTIONS.beta.force).toBe(false);
    expect(PROMOTION_ACTIONS.latest.force).toBe(false);
    expect(PROMOTION_ACTIONS.reprovar.force).toBe(false);
  });

  it("os gestos que andam para tras sao laranja, e so eles", () => {
    expect(PROMOTION_ACTIONS["rollback-test"].variant).toBe("warn");
    expect(PROMOTION_ACTIONS["rollback-production"].variant).toBe("warn");
    expect(PROMOTION_ACTIONS.beta.variant).not.toBe("warn");
    expect(PROMOTION_ACTIONS.latest.variant).not.toBe("warn");
    expect(PROMOTION_ACTIONS.resume.variant).not.toBe("warn");
  });

  it("todo gesto perigoso pergunta antes", () => {
    expect(PROMOTION_ACTIONS.reprovar.confirm).not.toBeNull();
    expect(PROMOTION_ACTIONS["rollback-test"].confirm).not.toBeNull();
    expect(PROMOTION_ACTIONS["rollback-production"].confirm).not.toBeNull();
    expect(PROMOTION_ACTIONS.resume.confirm).not.toBeNull();
  });

  it("a confirmacao de regredir avisa que quem ja atualizou nao volta", () => {
    const text = PROMOTION_ACTIONS["rollback-production"].confirm?.("0.8.193", "0.8.200") ?? "";

    expect(text).toContain("0.8.193");
    expect(text).toContain("0.8.200");
    expect(text.toLowerCase()).toContain("nao volta sozinha");
  });
});
