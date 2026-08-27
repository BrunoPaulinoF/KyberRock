import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { readLocalSetting, writeLocalSetting } from "./local-settings";
import {
  applyPriceMasterFromCloud,
  cloudRowWins,
  isPriceMasteredCadastroKey,
  isPriceMasterRepublishPending,
  isPriceMasterResyncPending,
  priceConflictPolicy,
  priceEditBlockedMessage,
  readPriceAuthority,
  resolvePriceAuthorityMode,
  PRICE_MASTER_DEVICE_ID_KEY,
  PRICE_MASTER_DEVICE_IDS_KEY
} from "./price-authority";

/**
 * Balancas principais de precos: quem define o cadastro de preco da pedreira e o que cada
 * maquina faz com essa informacao.
 */
describe("balanca principal de precos", () => {
  it("so trava a edicao na maquina que NAO e principal", () => {
    expect(resolvePriceAuthorityMode(["pc-a"], "pc-a")).toBe("master");
    expect(resolvePriceAuthorityMode(["pc-a"], "pc-b")).toBe("follower");
    // Mais de uma principal e o caso normal: as duas editam preco, as demais espelham.
    expect(resolvePriceAuthorityMode(["pc-a", "pc-b"], "pc-b")).toBe("master");
    expect(resolvePriceAuthorityMode(["pc-a", "pc-b"], "pc-c")).toBe("follower");
    // Pedreira sem principal continua como antes: cada maquina publica o proprio cadastro.
    expect(resolvePriceAuthorityMode([], "pc-b")).toBe("standalone");
    // Sem saber quem e esta maquina, travar seria arriscar travar a propria principal.
    expect(resolvePriceAuthorityMode(["pc-a"], null)).toBe("standalone");
  });

  it("lista como cadastro de preco exatamente as chaves que a principal publica", () => {
    for (const key of [
      "productDefaultPrices",
      "customerSpecialPrices",
      "priceTables",
      "priceTableItems",
      "customerPriceTables",
      "customerFreightRules"
    ]) {
      expect(isPriceMasteredCadastroKey(key)).toBe(true);
    }
    // Cadastro que nao e preco continua sendo publicado por todas as maquinas.
    for (const key of ["customers", "products", "carriers", "paymentMethods"]) {
      expect(isPriceMasteredCadastroKey(key)).toBe(false);
    }
  });

  it("mantem o papel gravado quando a nuvem nao fala de principal", () => {
    const database = createDatabase();
    try {
      writeLocalSetting(database, PRICE_MASTER_DEVICE_IDS_KEY, ["pc-a"]);

      // Funcao antiga (ou migracao ainda nao aplicada): o campo nao vem na resposta.
      applyPriceMasterFromCloud(database, undefined, "pc-b");

      expect(readPriceAuthority(database, "pc-b").mode).toBe("follower");
    } finally {
      database.close();
    }
  });

  /**
   * Uma instalacao que ja rodava com o formato antigo e atualizou sem internet fica com o
   * papel gravado no formato de uma principal so. Ler tambem esse formato e o que impede a
   * secundaria de voltar a aceitar edicao de preco no intervalo ate o primeiro heartbeat.
   */
  it("le o papel gravado no formato antigo, de uma principal so", () => {
    const database = createDatabase();
    try {
      writeLocalSetting(database, PRICE_MASTER_DEVICE_ID_KEY, "pc-a");
      writeLocalSetting(database, "price_master_device_name", "Balanca 1");

      const authority = readPriceAuthority(database, "pc-b");

      expect(authority.mode).toBe("follower");
      expect(authority.masterDeviceNames).toEqual(["Balanca 1"]);
    } finally {
      database.close();
    }
  });

  it("aceita da nuvem a pedreira que dispensou a principal", () => {
    const database = createDatabase();
    try {
      writeLocalSetting(database, PRICE_MASTER_DEVICE_IDS_KEY, ["pc-a"]);

      applyPriceMasterFromCloud(database, [], "pc-b");

      expect(readPriceAuthority(database, "pc-b").mode).toBe("standalone");
    } finally {
      database.close();
    }
  });

  it("arma a republicacao na maquina eleita e o realinhamento nas demais", () => {
    const master = createDatabase();
    const follower = createDatabase();
    const masters = [{ id: "pc-a", name: "Balanca 1" }];
    try {
      applyPriceMasterFromCloud(master, masters, "pc-a");
      applyPriceMasterFromCloud(follower, masters, "pc-b");

      // A principal tem de reenviar o preco que ja tinha antes da eleicao...
      expect(isPriceMasterRepublishPending(master)).toBe(true);
      expect(isPriceMasterResyncPending(master)).toBe(false);
      // ...e a secundaria tem de puxar o conjunto inteiro uma vez.
      expect(isPriceMasterResyncPending(follower)).toBe(true);
      expect(isPriceMasterRepublishPending(follower)).toBe(false);

      // A mesma resposta repetida (o heartbeat roda a cada poucos segundos) nao rearma
      // nada: sem isso a balanca refaria o pull completo o dia inteiro.
      applyPriceMasterFromCloud(follower, masters, "pc-b");
      expect(readLocalSetting(follower, "price_master_resync_pending")).toBe(true);
      expect(readPriceAuthority(follower, "pc-b").masterDeviceNames).toEqual(["Balanca 1"]);
    } finally {
      master.close();
      follower.close();
    }
  });

  /**
   * Uma segunda principal entrando NAO pode rearmar nada em quem ja era principal: o push
   * completo do cadastro de preco a cada eleicao faria a pedreira inteira reenviar preco
   * toda vez que o administrador mexesse na aba.
   */
  it("nao rearma a passada completa de quem ja tinha o mesmo papel", () => {
    const master = createDatabase();
    const follower = createDatabase();
    try {
      applyPriceMasterFromCloud(master, [{ id: "pc-a", name: "Balanca 1" }], "pc-a");
      applyPriceMasterFromCloud(follower, [{ id: "pc-a", name: "Balanca 1" }], "pc-c");
      clearPending(master);
      clearPending(follower);

      const both = [
        { id: "pc-a", name: "Balanca 1" },
        { id: "pc-b", name: "Balanca 2" }
      ];
      applyPriceMasterFromCloud(master, both, "pc-a");
      applyPriceMasterFromCloud(follower, both, "pc-c");

      expect(isPriceMasterRepublishPending(master)).toBe(false);
      expect(isPriceMasterResyncPending(follower)).toBe(false);
      // A segunda principal, essa sim, republica o que ela ja tinha.
      const promoted = createDatabase();
      try {
        applyPriceMasterFromCloud(promoted, both, "pc-b");
        expect(isPriceMasterRepublishPending(promoted)).toBe(true);
      } finally {
        promoted.close();
      }
    } finally {
      master.close();
      follower.close();
    }
  });

  it("diz na recusa onde o preco se altera", () => {
    expect(priceEditBlockedMessage(["Balanca 1"])).toContain('"Balanca 1"');
    expect(priceEditBlockedMessage([])).toContain("computador principal da pedreira");
    // Com duas principais a operadora precisa saber que qualquer uma delas serve.
    const two = priceEditBlockedMessage(["Balanca 1", "Balanca 2"]);
    expect(two).toContain('"Balanca 1" ou "Balanca 2"');
  });
});

/**
 * O desempate entre duas principais. E o que impede o preco de oscilar: as duas pontas
 * decidem igual seja qual for a ordem em que sincronizam, porque comparam a hora da EDICAO
 * e nao a ordem de chegada.
 */
describe("quem vence a chave natural disputada", () => {
  it("traduz o papel da balanca na politica de conflito", () => {
    expect(priceConflictPolicy("follower")).toBe("cloud");
    expect(priceConflictPolicy("master")).toBe("newest");
    expect(priceConflictPolicy("standalone")).toBe("local");
  });

  it("na secundaria a nuvem sempre vence; sem principal, nunca", () => {
    const cloud = { id: "pc-a", updatedAt: "2026-08-27T10:00:00.000Z" };
    const local = { id: "pc-b", updatedAt: "2026-08-27T12:00:00.000Z" };

    expect(cloudRowWins("cloud", cloud, local)).toBe(true);
    expect(cloudRowWins("local", cloud, local)).toBe(false);
  });

  it("entre principais vence quem editou por ultimo, com empate no id", () => {
    const antiga = { id: "pc-a", updatedAt: "2026-08-27T10:00:00.000Z" };
    const nova = { id: "pc-b", updatedAt: "2026-08-27T12:00:00.000Z" };

    expect(cloudRowWins("newest", nova, antiga)).toBe(true);
    expect(cloudRowWins("newest", antiga, nova)).toBe(false);

    const mesmaHora = "2026-08-27T12:00:00.000Z";
    expect(
      cloudRowWins(
        "newest",
        { id: "pc-b", updatedAt: mesmaHora },
        { id: "pc-a", updatedAt: mesmaHora }
      )
    ).toBe(true);
    expect(
      cloudRowWins(
        "newest",
        { id: "pc-a", updatedAt: mesmaHora },
        { id: "pc-b", updatedAt: mesmaHora }
      )
    ).toBe(false);
  });

  it("hora ausente ou invalida vale como a mais antiga, nunca como vitoria por acidente", () => {
    const valida = { id: "pc-b", updatedAt: "2026-08-27T10:00:00.000Z" };

    expect(cloudRowWins("newest", { id: "pc-a", updatedAt: null }, valida)).toBe(false);
    expect(cloudRowWins("newest", { id: "pc-a", updatedAt: "isto nao e uma data" }, valida)).toBe(
      false
    );
  });
});

function clearPending(database: DesktopDatabase): void {
  database
    .prepare("DELETE FROM local_settings WHERE key IN (?, ?)")
    .run("price_master_republish_pending", "price_master_resync_pending");
}

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  return database;
}
