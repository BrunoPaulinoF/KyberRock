import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(rendererDir, "App.tsx"), "utf8");

function sliceBetween(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("fila operacional theming", () => {
  // A tela de Operacoes pintava a linha "acima do tempo medio" com #fef2f2 fixo,
  // mantendo o texto em var(--kr-text) — no tema escuro isso virava cinza claro
  // sobre rosa claro (ilegivel). Tudo que colore a fila precisa vir dos tokens.
  it("keeps the operations queue free of hardcoded light colors", () => {
    const queue = sliceBetween('{activeView === "open-operations" ? (', "{closingOperation ? (");
    const hexes = queue.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];

    // Unica excecao: os pontinhos solidos de status, legiveis nos dois temas.
    expect(hexes.filter((hex) => !["#22c55e", "#f59e0b"].includes(hex))).toEqual([]);
  });

  it("tints the overtime row with the themed danger surface", () => {
    expect(source).toContain('background: "var(--kr-danger-surface)"');
    expect(source).toContain('color: isOvertime ? "var(--kr-danger)" : "var(--kr-muted)"');
  });

  it("renders the loader status light from semantic tokens", () => {
    const light = sliceBetween("function LoaderStatusLight(", "\nfunction ");

    expect(light).toContain("var(--kr-success-border)");
    expect(light).toContain("var(--kr-danger-border)");
    expect(light).toContain(
      'background: completed ? "var(--kr-success-soft)" : "var(--kr-danger-soft)"'
    );
    expect(light).toContain('color: completed ? "var(--kr-success)" : "var(--kr-danger)"');
  });

  it("renders the fiscal billing pill from semantic tokens", () => {
    const pill = sliceBetween("function fiscalBillingPillStyle(", "\nfunction ");

    expect(pill.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it("resolves the plate badge through theme variables", () => {
    expect(source).toContain('background: "var(--kr-plate-bg)"');
    expect(source).toContain('border: "1px solid var(--kr-plate-border)"');
    expect(source).toContain('color: "var(--kr-plate-text)"');
  });

  it("declares every new token in both themes", () => {
    const themes = sliceBetween("function getThemeVariables(", "\nconst styles");

    for (const token of [
      "--kr-plate-bg",
      "--kr-plate-border",
      "--kr-plate-text",
      "--kr-danger-surface"
    ]) {
      expect(themes.match(new RegExp(`"${token}":`, "g"))).toHaveLength(2);
    }
  });
});
