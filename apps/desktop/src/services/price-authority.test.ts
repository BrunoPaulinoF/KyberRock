import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { readLocalSetting, writeLocalSetting } from "./local-settings";
import {
  applyPriceMasterFromCloud,
  isPriceMasteredCadastroKey,
  isPriceMasterRepublishPending,
  isPriceMasterResyncPending,
  priceEditBlockedMessage,
  readPriceAuthority,
  resolvePriceAuthorityMode,
  PRICE_MASTER_DEVICE_ID_KEY
} from "./price-authority";

/**
 * Balanca principal de precos: quem define o cadastro de preco da pedreira e o que cada
 * maquina faz com essa informacao.
 */
describe("balanca principal de precos", () => {
  it("so trava a edicao na maquina que NAO e a principal", () => {
    expect(resolvePriceAuthorityMode("pc-a", "pc-a")).toBe("master");
    expect(resolvePriceAuthorityMode("pc-a", "pc-b")).toBe("follower");
    // Pedreira sem principal continua como antes: cada maquina publica o proprio cadastro.
    expect(resolvePriceAuthorityMode(null, "pc-b")).toBe("standalone");
    // Sem saber quem e esta maquina, travar seria arriscar travar a propria principal.
    expect(resolvePriceAuthorityMode("pc-a", null)).toBe("standalone");
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
      writeLocalSetting(database, PRICE_MASTER_DEVICE_ID_KEY, "pc-a");

      // Funcao antiga (ou migracao ainda nao aplicada): o campo nao vem na resposta.
      applyPriceMasterFromCloud(database, undefined, "pc-b");

      expect(readPriceAuthority(database, "pc-b").mode).toBe("follower");
    } finally {
      database.close();
    }
  });

  it("aceita da nuvem a pedreira que dispensou a principal", () => {
    const database = createDatabase();
    try {
      writeLocalSetting(database, PRICE_MASTER_DEVICE_ID_KEY, "pc-a");

      applyPriceMasterFromCloud(database, { id: null, name: null }, "pc-b");

      expect(readPriceAuthority(database, "pc-b").mode).toBe("standalone");
    } finally {
      database.close();
    }
  });

  it("arma a republicacao na maquina eleita e o realinhamento nas demais", () => {
    const master = createDatabase();
    const follower = createDatabase();
    try {
      applyPriceMasterFromCloud(master, { id: "pc-a", name: "Balanca 1" }, "pc-a");
      applyPriceMasterFromCloud(follower, { id: "pc-a", name: "Balanca 1" }, "pc-b");

      // A principal tem de reenviar o preco que ja tinha antes da eleicao...
      expect(isPriceMasterRepublishPending(master)).toBe(true);
      expect(isPriceMasterResyncPending(master)).toBe(false);
      // ...e a secundaria tem de puxar o conjunto inteiro uma vez.
      expect(isPriceMasterResyncPending(follower)).toBe(true);
      expect(isPriceMasterRepublishPending(follower)).toBe(false);

      // A mesma resposta repetida (o heartbeat roda a cada poucos segundos) nao rearma
      // nada: sem isso a balanca refaria o pull completo o dia inteiro.
      applyPriceMasterFromCloud(follower, { id: "pc-a", name: "Balanca 1" }, "pc-b");
      expect(readLocalSetting(follower, "price_master_resync_pending")).toBe(true);
      expect(readPriceAuthority(follower, "pc-b").masterDeviceName).toBe("Balanca 1");
    } finally {
      master.close();
      follower.close();
    }
  });

  it("diz na recusa onde o preco se altera", () => {
    expect(priceEditBlockedMessage("Balanca 1")).toContain('"Balanca 1"');
    expect(priceEditBlockedMessage(null)).toContain("computador principal da pedreira");
  });
});

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  return database;
}
