import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import {
  DEFAULT_UPDATE_CHANNEL,
  normalizeUpdateChannel,
  readUpdateChannel,
  updaterChannelSettings,
  writeUpdateChannel
} from "./update-channel";

const temporaryDirectories: string[] = [];

function openTemporaryDatabase(): DesktopDatabase {
  const directory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-update-channel-"));
  temporaryDirectories.push(directory);
  const database = openDesktopDatabase({
    databasePath: path.join(directory, "data", "kyberrock.sqlite3")
  });
  runDesktopMigrations(database);
  return database;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true });
  }
});

describe("normalizeUpdateChannel", () => {
  it("reconhece o canal de teste", () => {
    expect(normalizeUpdateChannel("beta")).toBe("beta");
    expect(normalizeUpdateChannel(" BETA ")).toBe("beta");
  });

  it("manda TUDO que nao for beta para producao", () => {
    // A regra que protege a frota: um valor estranho — coluna que a nuvem ainda
    // nao tem, erro de digitacao, resposta truncada — nunca pode tirar uma
    // balanca de cliente do canal estavel.
    for (const value of [
      "latest",
      "",
      "   ",
      "Beta2",
      "producao",
      null,
      undefined,
      42,
      {},
      ["beta"]
    ]) {
      expect(normalizeUpdateChannel(value)).toBe(DEFAULT_UPDATE_CHANNEL);
    }
  });
});

describe("updaterChannelSettings", () => {
  it("so o canal de teste enxerga pre-release", () => {
    // O anel de teste vive dentro do pre-release; sem allowPrerelease a balanca
    // de teste ignoraria justamente as releases que deveria receber.
    expect(updaterChannelSettings("beta")).toEqual({ allowPrerelease: true });
    expect(updaterChannelSettings("latest")).toEqual({ allowPrerelease: false });
  });

  it("nao devolve `channel` — nem para producao", () => {
    // Regressao real: a primeira versao deste codigo definia
    // `autoUpdater.channel` e o anel de teste simplesmente nao funcionava.
    //
    // 1. Em repo privado o `PrivateGitHubProvider` resolve o metadado por
    //    `getDefaultChannelName()`, que e fixo em "latest" — `updater.channel`
    //    nunca e lido, entao o `beta.yml` que o painel publicava nao era lido
    //    por maquina nenhuma.
    // 2. O setter de `channel` liga `allowDowngrade = true`, o que autorizaria
    //    a balanca a instalar uma versao mais VELHA que a instalada.
    //
    // Se alguem reintroduzir o campo, este teste cai antes de virar release.
    for (const channel of ["beta", "latest"] as const) {
      expect(updaterChannelSettings(channel)).not.toHaveProperty("channel");
    }
  });
});

describe("update channel no banco local", () => {
  it("balanca sem nada gravado fica em producao", () => {
    const database = openTemporaryDatabase();
    try {
      expect(readUpdateChannel(database)).toBe("latest");
    } finally {
      database.close();
    }
  });

  it("grava, le de volta e sobrevive a reabertura do banco", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-update-channel-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "data", "kyberrock.sqlite3");

    const first = openDesktopDatabase({ databasePath });
    try {
      runDesktopMigrations(first);
      expect(writeUpdateChannel(first, "beta")).toBe("beta");
      expect(readUpdateChannel(first)).toBe("beta");
    } finally {
      first.close();
    }

    const second = openDesktopDatabase({ databasePath });
    try {
      expect(readUpdateChannel(second)).toBe("beta");
    } finally {
      second.close();
    }
  });

  it("grava normalizado: lixo vira producao em vez de ficar no banco", () => {
    const database = openTemporaryDatabase();
    try {
      writeUpdateChannel(database, "beta");
      expect(writeUpdateChannel(database, "canal-inventado")).toBe("latest");
      expect(readUpdateChannel(database)).toBe("latest");
    } finally {
      database.close();
    }
  });
});
