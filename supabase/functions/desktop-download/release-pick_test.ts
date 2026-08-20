import { describe, expect, it } from "vitest";

import { pickPublicInstaller, type ReleaseLike } from "./release-pick.ts";

const exe = (id: number, name = `KyberRock-Desktop-Setup-0.8.${id}.exe`) => ({ id, name });

describe("pickPublicInstaller", () => {
  it("entrega o instalador da release estavel mais recente", () => {
    const releases: ReleaseLike[] = [
      { prerelease: false, assets: [exe(150)] },
      { prerelease: false, assets: [exe(149)] }
    ];

    expect(pickPublicInstaller(releases)?.id).toBe(150);
  });

  it("NUNCA entrega um pre-release, mesmo sendo o mais recente", () => {
    // O caso que importa: com o fluxo de dois passos, todo build novo e
    // pre-release. O link publico tem que continuar na ultima versao liberada.
    const releases: ReleaseLike[] = [
      { prerelease: true, assets: [exe(152)] },
      { prerelease: true, assets: [exe(151)] },
      { prerelease: false, assets: [exe(149)] }
    ];

    expect(pickPublicInstaller(releases)?.id).toBe(149);
  });

  it("ignora draft", () => {
    const releases: ReleaseLike[] = [
      { draft: true, assets: [exe(150)] },
      { prerelease: false, assets: [exe(149)] }
    ];

    expect(pickPublicInstaller(releases)?.id).toBe(149);
  });

  it("pula release estavel sem .exe em vez de derrubar o link", () => {
    const releases: ReleaseLike[] = [
      { prerelease: false, assets: [{ id: 1, name: "latest.yml" }] },
      { prerelease: false, assets: [] },
      { prerelease: false, assets: [{ id: 2, name: "build.yml" }, exe(149)] }
    ];

    expect(pickPublicInstaller(releases)?.id).toBe(149);
  });

  it("reconhece .EXE em maiuscula", () => {
    expect(
      pickPublicInstaller([{ prerelease: false, assets: [{ id: 7, name: "Setup.EXE" }] }])?.id
    ).toBe(7);
  });

  it("devolve undefined quando so ha pre-release", () => {
    expect(pickPublicInstaller([{ prerelease: true, assets: [exe(150)] }])).toBeUndefined();
  });

  it("aguenta resposta inesperada da API sem estourar", () => {
    expect(pickPublicInstaller(null)).toBeUndefined();
    expect(pickPublicInstaller({ message: "Not Found" })).toBeUndefined();
    expect(pickPublicInstaller([null, undefined])).toBeUndefined();
  });
});
