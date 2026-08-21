import { describe, expect, it } from "vitest";

import {
  hasBuildInProgress,
  isPromotionApplied,
  isPromotionStale,
  nextRefreshDelayMs,
  PROMOTION_TIMEOUT_MS
} from "./desktop-updates";
import type { PendingPromotion, ReleaseState } from "./desktop-updates";

function release(version: string, state: ReleaseState) {
  return { version, state };
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

  it("conclui a liberacao para producao so quando a propria versao vira producao", () => {
    const naoChegou = [release("0.8.200", "teste"), release("0.8.199", "producao")];
    const chegou = [release("0.8.200", "producao"), release("0.8.199", "parado")];

    expect(isPromotionApplied(naoChegou, pending("0.8.200", "latest"))).toBe(false);
    expect(isPromotionApplied(chegou, pending("0.8.200", "latest"))).toBe(true);
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
