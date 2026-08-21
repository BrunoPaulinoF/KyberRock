import { describe, expect, it } from "vitest";

import {
  arrangeReleases,
  hasBuildInProgress,
  isPromotionApplied,
  isPromotionStale,
  nextRefreshDelayMs,
  rollbackActionFor,
  PROMOTION_TIMEOUT_MS
} from "./desktop-updates";
import type { PendingPromotion, ReleaseLike, ReleaseState } from "./desktop-updates";

function release(
  version: string,
  state: ReleaseState,
  options: { current?: boolean; older?: boolean; newer?: boolean } = {}
): ReleaseLike {
  return {
    version,
    state,
    isCurrentProduction: options.current ?? false,
    isOlderThanProduction: options.older ?? false,
    isNewerThanProduction: options.newer ?? false
  };
}

function pending(
  version: string,
  target: PendingPromotion["target"],
  startedAt = 1_000
): PendingPromotion {
  return { version, target, startedAt };
}

describe("isPromotionApplied", () => {
  it("aguarda enquanto a versao continua parada apos o envio para teste", () => {
    const releases = [release("0.8.200", "parado"), release("0.8.199", "producao")];

    expect(isPromotionApplied(releases, pending("0.8.200", "beta"))).toBe(false);
  });

  it("conclui quando a versao aparece em teste", () => {
    const releases = [release("0.8.200", "teste"), release("0.8.199", "producao")];

    expect(isPromotionApplied(releases, pending("0.8.200", "beta"))).toBe(true);
  });

  it("conclui a liberacao para producao so quando a versao vira A producao atual", () => {
    const naoChegou = [
      release("0.8.200", "teste"),
      release("0.8.199", "producao", { current: true })
    ];
    const chegou = [
      release("0.8.200", "producao", { current: true }),
      release("0.8.199", "parado")
    ];

    expect(isPromotionApplied(naoChegou, pending("0.8.200", "latest"))).toBe(false);
    expect(isPromotionApplied(chegou, pending("0.8.200", "latest"))).toBe(true);
  });

  it("numa volta atras nao da a regressao por concluida so porque a versao ja era estavel", () => {
    // 0.8.193 e uma release estavel antiga: o estado dela e "producao" desde
    // antes do clique. Sem olhar o /releases/latest a tela daria o gesto por
    // feito no primeiro recarregamento, com a frota ainda na versao nova.
    const antes = [
      release("0.8.200", "producao", { current: true }),
      release("0.8.193", "producao", { older: true })
    ];
    const depois = [
      release("0.8.200", "producao", { newer: true }),
      release("0.8.193", "producao", { current: true })
    ];

    expect(isPromotionApplied(antes, pending("0.8.193", "latest"))).toBe(false);
    expect(isPromotionApplied(depois, pending("0.8.193", "latest"))).toBe(true);
  });

  it("conclui a reprovacao quando o marcador aparece", () => {
    expect(
      isPromotionApplied([release("0.8.200", "reprovada")], pending("0.8.200", "reprovar"))
    ).toBe(true);
  });

  it("nao confunde a mudanca de outra versao com a promocao pedida", () => {
    const releases = [release("0.8.200", "parado"), release("0.8.199", "teste")];

    expect(isPromotionApplied(releases, pending("0.8.200", "beta"))).toBe(false);
  });

  it("continua aguardando quando a versao sumiu da lista", () => {
    expect(isPromotionApplied([release("0.8.199", "producao")], pending("0.8.200", "beta"))).toBe(
      false
    );
  });

  it("nao ha promocao a concluir sem promocao pendente", () => {
    expect(isPromotionApplied([release("0.8.200", "teste")], null)).toBe(false);
  });
});

describe("isPromotionStale", () => {
  it("espera o prazo inteiro antes de desistir do run", () => {
    const promotion = pending("0.8.200", "beta", 1_000);

    expect(isPromotionStale(promotion, 1_000 + PROMOTION_TIMEOUT_MS - 1)).toBe(false);
    expect(isPromotionStale(promotion, 1_000 + PROMOTION_TIMEOUT_MS)).toBe(true);
  });

  it("sem promocao pendente nao ha prazo vencido", () => {
    expect(isPromotionStale(null, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe("nextRefreshDelayMs", () => {
  it("nao verifica nada com a aba escondida", () => {
    expect(
      nextRefreshDelayMs({ isVisible: false, hasPendingPromotion: true, isBuilding: true })
    ).toBeNull();
  });

  it("verifica mais rapido enquanto uma promocao esta a caminho", () => {
    const comPromocao = nextRefreshDelayMs({
      isVisible: true,
      hasPendingPromotion: true,
      isBuilding: false
    });
    const compilando = nextRefreshDelayMs({
      isVisible: true,
      hasPendingPromotion: false,
      isBuilding: true
    });
    const parado = nextRefreshDelayMs({
      isVisible: true,
      hasPendingPromotion: false,
      isBuilding: false
    });

    expect(comPromocao).not.toBeNull();
    expect(compilando).not.toBeNull();
    expect(parado).not.toBeNull();
    expect(comPromocao!).toBeLessThan(compilando!);
    expect(compilando!).toBeLessThan(parado!);
  });

  it("a promocao a caminho manda mais que o build em curso", () => {
    expect(
      nextRefreshDelayMs({ isVisible: true, hasPendingPromotion: true, isBuilding: true })
    ).toBe(nextRefreshDelayMs({ isVisible: true, hasPendingPromotion: true, isBuilding: false }));
  });
});

describe("hasBuildInProgress", () => {
  it("reconhece uma versao compilando", () => {
    expect(hasBuildInProgress([release("0.8.200", "compilando")])).toBe(true);
  });

  it("release incompleta nao e build em curso", () => {
    expect(hasBuildInProgress([release("0.8.200", "incompleto")])).toBe(false);
  });

  it("lista vazia nao tem build em curso", () => {
    expect(hasBuildInProgress([])).toBe(false);
  });
});

describe("rollbackActionFor", () => {
  it("a versao anterior volta primeiro para o anel de teste", () => {
    expect(rollbackActionFor(release("0.8.193", "producao", { older: true }))).toBe("test");
    expect(rollbackActionFor(release("0.8.193", "parado", { older: true }))).toBe("test");
  });

  it("so depois de estar em teste oferece regredir a producao", () => {
    expect(rollbackActionFor(release("0.8.193", "teste", { older: true }))).toBe("production");
  });

  it("oferece retomar a producao na versao de onde se voltou", () => {
    // Estavel e mais nova que a producao: so acontece com uma regressao em
    // vigor, e e o caminho de volta para a frente.
    expect(rollbackActionFor(release("0.8.200", "producao", { newer: true }))).toBe("resume");
  });

  it("nao oferece volta atras na versao que a frota esta recebendo", () => {
    expect(rollbackActionFor(release("0.8.200", "producao", { current: true }))).toBeNull();
  });

  it("nao oferece volta atras no que nao pode circular", () => {
    expect(rollbackActionFor(release("0.8.193", "reprovada", { older: true }))).toBeNull();
    expect(rollbackActionFor(release("0.8.193", "incompleto", { older: true }))).toBeNull();
    expect(rollbackActionFor(release("0.8.193", "compilando", { older: true }))).toBeNull();
  });

  it("funcao antiga (sem isNewerThanProduction) nao inventa botao de retomar", () => {
    const semCampo = {
      version: "0.8.200",
      state: "producao",
      isCurrentProduction: false,
      isOlderThanProduction: false
    } satisfies ReleaseLike;

    expect(rollbackActionFor(semCampo)).toBeNull();
  });
});

describe("arrangeReleases", () => {
  const build = release("0.8.201", "parado", { newer: true });
  const producao = release("0.8.200", "producao", { current: true });
  const anterior = release("0.8.193", "producao", { older: true });
  const antiga = release("0.8.190", "producao", { older: true });

  it("poe a producao atual no topo, depois o ultimo build e a versao anterior", () => {
    const { ordered, highlights } = arrangeReleases([build, producao, anterior, antiga]);

    expect(ordered.map((row) => row.version)).toEqual(["0.8.200", "0.8.201", "0.8.193", "0.8.190"]);
    expect(highlights).toEqual({
      "0.8.200": "atual",
      "0.8.201": "ultima",
      "0.8.193": "anterior"
    });
  });

  it("mantem a ordem do GitHub no resto da lista", () => {
    const { ordered } = arrangeReleases([build, producao, anterior, antiga]);

    expect(ordered.slice(3).map((row) => row.version)).toEqual(["0.8.190"]);
  });

  it("o ultimo build e o mais novo que ainda nao foi distribuido", () => {
    const emTeste = release("0.8.202", "teste", { newer: true });
    const { highlights } = arrangeReleases([emTeste, build, producao, anterior]);

    expect(highlights["0.8.202"]).toBeUndefined();
    expect(highlights["0.8.201"]).toBe("ultima");
  });

  it("build ainda compilando ja conta como o ultimo lancado", () => {
    const compilando = release("0.8.202", "compilando", { newer: true });
    const { highlights } = arrangeReleases([compilando, producao, anterior]);

    expect(highlights["0.8.202"]).toBe("ultima");
  });

  it("cada versao ganha um selo so", () => {
    // Sem build novo, a versao anterior tambem seria a candidata a "ultima".
    const paradoAntigo = release("0.8.193", "parado", { older: true });
    const { ordered, highlights } = arrangeReleases([producao, paradoAntigo]);

    expect(highlights["0.8.193"]).toBe("ultima");
    expect(ordered.map((row) => row.version)).toEqual(["0.8.200", "0.8.193"]);
  });

  it("sem producao atual a lista continua de pe", () => {
    const { ordered, highlights } = arrangeReleases([build, release("0.8.199", "parado")]);

    expect(ordered.map((row) => row.version)).toEqual(["0.8.201", "0.8.199"]);
    expect(highlights).toEqual({ "0.8.201": "ultima" });
  });

  it("lista vazia nao quebra", () => {
    expect(arrangeReleases([])).toEqual({ ordered: [], highlights: {} });
  });
});
