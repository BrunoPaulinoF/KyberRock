import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DesktopDataAccessError, ensureDesktopDataAccess } from "./data-access.js";
import { getDesktopDataPaths } from "./paths.js";

describe("ensureDesktopDataAccess", () => {
  let baseDirectory: string;

  beforeEach(() => {
    baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-data-access-"));
  });

  afterEach(() => {
    rmSync(baseDirectory, { recursive: true, force: true });
  });

  it("cria a arvore de dados na primeira execucao", () => {
    const paths = getDesktopDataPaths(baseDirectory);

    ensureDesktopDataAccess(paths);

    expect(existsSync(paths.dataDirectory)).toBe(true);
    expect(existsSync(paths.backupDirectory)).toBe(true);
    expect(existsSync(paths.logDirectory)).toBe(true);
    expect(existsSync(paths.configDirectory)).toBe(true);
  });

  it("e idempotente quando a pasta ja existe e esta gravavel", () => {
    const paths = getDesktopDataPaths(baseDirectory);

    ensureDesktopDataAccess(paths);

    expect(() => ensureDesktopDataAccess(paths)).not.toThrow();
  });

  it("nao deixa lixo do teste de escrita na pasta de dados", () => {
    const paths = getDesktopDataPaths(baseDirectory);

    ensureDesktopDataAccess(paths);

    expect(existsSync(path.join(paths.dataDirectory, ".kyberrock-write-probe"))).toBe(false);
  });

  it("explica o reparo ao operador quando a pasta nao aceita escrita", () => {
    const paths = getDesktopDataPaths(baseDirectory);
    ensureDesktopDataAccess(paths);

    // Ocupar o caminho do probe com um diretorio faz a escrita falhar do mesmo jeito
    // que a ACL do ProgramData faz na maquina da balanca, sem depender do usuario
    // que roda os testes.
    mkdirSync(path.join(paths.dataDirectory, ".kyberrock-write-probe"));

    try {
      ensureDesktopDataAccess(paths);
      expect.unreachable("deveria ter falhado sem permissao de escrita");
    } catch (error) {
      expect(error).toBeInstanceOf(DesktopDataAccessError);
      const message = (error as DesktopDataAccessError).message;
      expect(message).toContain(paths.databasePath);
      expect(message).toContain("icacls");
      expect(message).toContain("*S-1-5-32-545:(OI)(CI)F");
    }
  });
});
