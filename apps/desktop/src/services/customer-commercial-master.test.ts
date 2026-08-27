import { beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { writeLocalSetting } from "./local-settings";
import {
  findChangedMasteredCustomerFields,
  isCommercialBlockPublished,
  shouldApplyCloudCommercialBlock
} from "./customer-commercial-master";
import {
  CUSTOMER_COMMERCIAL_REPUBLISH_KEY,
  MASTERED_CUSTOMER_PAYLOAD_COLUMNS,
  PRICE_MASTER_DEVICE_IDS_KEY,
  PRICE_MASTER_DEVICE_NAMES_KEY
} from "./price-authority";
import { pullDesktopDataFromCloud, pushSharedCadastroToCloud } from "./supabase-sync";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    functions: {
      invoke: invokeMock
    }
  }))
}));

/**
 * Cadastro comercial e de credito do cliente com dono unico na pedreira.
 *
 * Antes disso a aba Comercial inteira morria no SQLite de cada balanca: o mesmo cliente
 * podia ter credito habilitado num computador e nao no outro, e o operador refazia a
 * configuracao maquina a maquina. O dono e o mesmo do preco — a balanca principal.
 */
describe("bloco comercial do cliente (decisao)", () => {
  const publishedRow = {
    commercial_published_at: "2026-08-27T10:00:00.000Z",
    nf_required: false
  };
  const clocks = {
    customerId: "cust-1",
    cloudUpdatedAt: "2026-08-27T10:00:00.000Z",
    localUpdatedAt: "2026-08-27T09:00:00.000Z"
  };

  it("a secundaria aceita o bloco publicado, inclusive por cima de edicao local pendente", () => {
    expect(
      shouldApplyCloudCommercialBlock({
        ...clocks,
        policy: "cloud",
        cloudRow: publishedRow,
        localNeedsPush: true
      })
    ).toBe(true);
  });

  /**
   * Entre principais, quem editou por ultimo manda — o mesmo criterio do preco.
   *
   * "A principal nunca adota o que vem da nuvem" seria correto com uma principal so. Com
   * duas devolveria o problema de origem: cada uma ficaria para sempre com a configuracao
   * que ela mesma digitou, que e exatamente o que este recurso existe para acabar.
   */
  it("entre principais, a configuracao editada por ultimo vence", () => {
    expect(
      shouldApplyCloudCommercialBlock({
        ...clocks,
        policy: "newest",
        cloudRow: publishedRow,
        localNeedsPush: false
      })
    ).toBe(true);

    // A edicao daqui e mais nova: a da nuvem nao entra.
    expect(
      shouldApplyCloudCommercialBlock({
        ...clocks,
        localUpdatedAt: "2026-08-27T11:00:00.000Z",
        policy: "newest",
        cloudRow: publishedRow,
        localNeedsPush: false
      })
    ).toBe(false);

    // Empate de relogio e o eco do proprio push: adotar ou nao da no mesmo, e a copia local
    // fica. As duas pontas decidem igual seja qual for a ordem em que sincronizam.
    expect(
      shouldApplyCloudCommercialBlock({
        ...clocks,
        localUpdatedAt: clocks.cloudUpdatedAt,
        policy: "newest",
        cloudRow: publishedRow,
        localNeedsPush: false
      })
    ).toBe(false);
  });

  // `local` aqui NAO e o `local` do preco ("a linha local sempre vence"): e o que as demais
  // colunas do cliente ja fazem, para a mesma tela nao ter duas regras.
  it("sem principal eleita, a projecao vence — menos com edicao local pendente", () => {
    expect(
      shouldApplyCloudCommercialBlock({
        ...clocks,
        policy: "local",
        cloudRow: publishedRow,
        localNeedsPush: false
      })
    ).toBe(true);
    expect(
      shouldApplyCloudCommercialBlock({
        ...clocks,
        policy: "local",
        cloudRow: publishedRow,
        localNeedsPush: true
      })
    ).toBe(false);
  });

  /**
   * O nulo do bloco nao publicado quer dizer "nao sei", nao "vazio". Grava-lo apagaria a
   * configuracao boa da balanca — que e o oposto do que este recurso existe para fazer.
   */
  it("bloco nao publicado nao muda nada, nem na secundaria", () => {
    expect(
      shouldApplyCloudCommercialBlock({
        ...clocks,
        policy: "cloud",
        cloudRow: { commercial_published_at: null, nf_required: null },
        localNeedsPush: false
      })
    ).toBe(false);
    // Migracao da nuvem ainda nao aplicada: a coluna nem vem na resposta.
    expect(
      shouldApplyCloudCommercialBlock({
        ...clocks,
        policy: "cloud",
        cloudRow: { nf_required: null },
        localNeedsPush: false
      })
    ).toBe(false);
  });

  it("reconhece a marca de publicacao", () => {
    expect(isCommercialBlockPublished({})).toBe(false);
    expect(isCommercialBlockPublished({ commercial_published_at: null })).toBe(false);
    expect(isCommercialBlockPublished({ commercial_published_at: "  " })).toBe(false);
    expect(isCommercialBlockPublished({ commercial_published_at: "2026-08-27T10:00:00Z" })).toBe(
      true
    );
  });
});

/**
 * A tela de clientes salva o formulario INTEIRO numa chamada so. Recusar por mencao
 * deixaria a secundaria sem conseguir corrigir nem o telefone de um cliente.
 */
describe("bloco comercial do cliente (o que a edicao muda)", () => {
  const existing = {
    default_payment_method_id: "pm-1",
    default_carrier_id: null,
    nf_required: 1,
    credit_mode: "normal",
    credit_account_enabled: 0,
    credit_periodicity: "monthly",
    credit_closing_day: 30,
    credit_second_closing_day: null,
    credit_boleto_days: 10,
    credit_second_boleto_days: null,
    credit_closing_weekday: null
  };

  it("nao acusa mudanca quando o formulario reenvia o que ja esta gravado", () => {
    expect(
      findChangedMasteredCustomerFields(existing, {
        phone: "(31) 99999-0000",
        defaultPaymentMethodId: "pm-1",
        // A tela manda booleano e string; o SQLite guarda 0/1 e NULL.
        nfRequired: true,
        creditAccountEnabled: false,
        defaultCarrierId: "",
        creditPeriodicity: "monthly",
        creditClosingDay: "30",
        creditBoletoDays: 10,
        creditSecondClosingDay: "",
        creditClosingWeekday: null
      })
    ).toEqual([]);
  });

  it("acusa o campo que a edicao realmente mudaria", () => {
    expect(
      findChangedMasteredCustomerFields(existing, {
        defaultPaymentMethodId: "pm-1",
        creditAccountEnabled: true
      })
    ).toEqual(["creditAccountEnabled"]);
  });

  it("ignora o campo que a edicao nem mandou", () => {
    expect(findChangedMasteredCustomerFields(existing, { legalName: "Outro Nome" })).toEqual([]);
  });
});

describe("bloco comercial do cliente (sincronizacao)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it("na secundaria, a configuracao da principal vence a local", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomer(database);
      // Configuracao feita NESTA maquina antes da eleicao.
      database
        .prepare(
          `UPDATE customers
              SET credit_account_enabled = 1, credit_periodicity = 'weekly', credit_closing_weekday = 5,
                  nf_required = 0, needs_push = 1
            WHERE id = 'cust-1'`
        )
        .run();
      electMasters(database, "desktop-a");

      invokeMock.mockResolvedValueOnce({
        data: { customers: [cloudCustomer({ credit_account_enabled: false, nf_required: true })] },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(commercialOf(database)).toMatchObject({
        credit_account_enabled: 0,
        credit_periodicity: "monthly",
        credit_closing_weekday: null,
        nf_required: 1
      });
    } finally {
      database.close();
    }
  });

  /**
   * Duas principais (a da portaria e a do escritorio) nao podem ficar cada uma com a sua
   * configuracao — seria o empate original de volta, so que entre principais. O desempate e
   * a hora da edicao do cliente, o mesmo criterio do preco.
   */
  it("entre principais, adota a configuracao editada depois da sua", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      seedCustomer(database);
      // As DUAS sao principais. Esta aqui configurou o credito as 09:00.
      database
        .prepare(
          `UPDATE customers
              SET credit_account_enabled = 1, credit_closing_day = 5,
                  updated_at = '2026-08-27T09:00:00.000Z'
            WHERE id = 'cust-1'`
        )
        .run();
      electMasters(database, "desktop-a", "desktop-b");

      // A outra principal editou as 10:00.
      invokeMock.mockResolvedValueOnce({
        data: {
          customers: [cloudCustomer({ credit_account_enabled: true, credit_closing_day: 20 })]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(commercialOf(database).credit_closing_day).toBe(20);
    } finally {
      database.close();
    }
  });

  // ...e o contrario tambem: a edicao mais nova daqui nao e derrubada pela mais velha de la.
  it("entre principais, mantem a sua configuracao quando ela e a mais nova", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      seedCustomer(database);
      database
        .prepare(
          `UPDATE customers
              SET credit_account_enabled = 1, credit_closing_day = 5,
                  updated_at = '2026-08-27T11:00:00.000Z'
            WHERE id = 'cust-1'`
        )
        .run();
      electMasters(database, "desktop-a", "desktop-b");

      invokeMock.mockResolvedValueOnce({
        data: {
          customers: [cloudCustomer({ credit_account_enabled: true, credit_closing_day: 20 })]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(commercialOf(database).credit_closing_day).toBe(5);
    } finally {
      database.close();
    }
  });

  /**
   * A janela que este teste protege: a versao nova chega na balanca pelo instalador e a
   * migracao SQL e aplicada a parte. Enquanto a principal nao republica, a nuvem devolve o
   * bloco todo nulo — e adota-lo apagaria a configuracao boa da secundaria, com caminhao na
   * balanca e ninguem sabendo por que o cliente perdeu o credito.
   */
  it("nao apaga a configuracao local quando a principal ainda nao publicou o bloco", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomer(database);
      database
        .prepare(
          "UPDATE customers SET credit_account_enabled = 1, credit_closing_day = 15 WHERE id = 'cust-1'"
        )
        .run();
      electMasters(database, "desktop-a");

      // Linha antiga: a coluna existe na nuvem, mas ninguem publicou o bloco ainda.
      invokeMock.mockResolvedValueOnce({
        data: {
          customers: [
            {
              ...cloudCustomer(),
              commercial_published_at: null,
              credit_account_enabled: null,
              credit_closing_day: null,
              nf_required: null,
              credit_periodicity: null,
              credit_mode: null
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(commercialOf(database)).toMatchObject({
        credit_account_enabled: 1,
        credit_closing_day: 15,
        nf_required: 1,
        credit_periodicity: "monthly",
        credit_mode: "normal"
      });
    } finally {
      database.close();
    }
  });

  // Nulo depois da marca e informacao legitima: e assim que a principal LIMPA um padrao.
  it("aceita da principal a limpeza da transportadora padrao", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomer(database);
      seedCarrier(database, "carrier-1");
      database
        .prepare("UPDATE customers SET default_carrier_id = 'carrier-1' WHERE id = 'cust-1'")
        .run();
      electMasters(database, "desktop-a");

      invokeMock.mockResolvedValueOnce({
        data: { customers: [cloudCustomer({ default_carrier_id: null })] },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(commercialOf(database).default_carrier_id).toBeNull();
    } finally {
      database.close();
    }
  });

  /**
   * A transportadora chega no mesmo pull, mas a gravacao dela pode ter falhado. Apagar o
   * vinculo por causa de um cadastro atrasado deixaria o cliente sem transportadora padrao
   * ate o proximo ciclo — mesma disciplina de `resolveMirroredId`.
   */
  it("mantem a transportadora local quando a da principal ainda nao foi espelhada", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomer(database);
      seedCarrier(database, "carrier-1");
      database
        .prepare("UPDATE customers SET default_carrier_id = 'carrier-1' WHERE id = 'cust-1'")
        .run();
      electMasters(database, "desktop-a");

      invokeMock.mockResolvedValueOnce({
        data: { customers: [cloudCustomer({ default_carrier_id: "carrier-que-nao-chegou" })] },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(commercialOf(database).default_carrier_id).toBe("carrier-1");
    } finally {
      database.close();
    }
  });

  /**
   * A forma de pagamento padrao do sistema nasce com id SORTEADO em cada balanca, entao o
   * id que a principal publicou nunca existe aqui. Sem a traducao pelo `code`, o cliente
   * chegaria SEM forma de pagamento padrao em todas as secundarias.
   */
  it("traduz a forma de pagamento padrao para a gemea local", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomer(database);
      // A forma padrao do sistema nasce com id sorteado em cada balanca: aqui ela e
      // "pm-daqui", na principal e outra coisa, e as duas tem o mesmo `code`.
      const localCashId = seedPaymentMethod(database, "pm-daqui");
      electMasters(database, "desktop-a");

      invokeMock.mockResolvedValueOnce({
        data: {
          // A forma da principal chega primeiro e registra a equivalencia por `code`.
          paymentMethods: [
            {
              id: "pm-da-principal",
              code: "cash",
              name: "Dinheiro",
              is_system: true,
              sort_order: 1,
              is_active: true,
              updated_at: "2026-08-27T10:00:00.000Z"
            }
          ],
          customers: [cloudCustomer({ default_payment_method_id: "pm-da-principal" })]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(commercialOf(database).default_payment_method_id).toBe(localCashId);
    } finally {
      database.close();
    }
  });

  it("a secundaria publica o cliente, mas sem o bloco comercial", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomer(database);
      electMasters(database, "desktop-a");

      await pushSharedCadastroToCloud(database, identity);

      const pushed = pushedRows("customers");
      expect(pushed).toHaveLength(1);
      // O cadastro dela continua viajando...
      expect(pushed[0]).toHaveProperty("legal_name");
      expect(pushed[0]).toHaveProperty("credit_limit_cents");
      // ...sem NENHUMA coluna com dono. A lista vem da constante de proposito: coluna nova
      // no bloco que alguem esqueca de tirar do payload da secundaria quebra aqui.
      expect(Object.keys(pushed[0])).toEqual(
        expect.not.arrayContaining([...MASTERED_CUSTOMER_PAYLOAD_COLUMNS])
      );
    } finally {
      database.close();
    }
  });

  it("a principal publica o bloco comercial com a marca", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      seedCustomer(database);
      database
        .prepare("UPDATE customers SET credit_account_enabled = 1, nf_required = 0 WHERE id = ?")
        .run("cust-1");
      electMasters(database, "desktop-a");

      await pushSharedCadastroToCloud(database, identity);

      const pushed = pushedRows("customers");
      expect(pushed[0]).toMatchObject({
        credit_account_enabled: true,
        nf_required: false,
        credit_periodicity: "monthly",
        credit_mode: "normal"
      });
      // O bloco vai INTEIRO. Coluna do bloco que alguem esqueca de acrescentar ao SELECT ou
      // ao `map` da entidade quebra aqui, e nao meses depois numa pedreira.
      expect(Object.keys(pushed[0])).toEqual(
        expect.arrayContaining([...MASTERED_CUSTOMER_PAYLOAD_COLUMNS])
      );
      expect(pushed[0].commercial_published_at).toEqual(expect.any(String));
    } finally {
      database.close();
    }
  });

  /**
   * O push do cadastro e incremental por cursor. Sem zerar o cursor dos clientes na
   * atualizacao, o bloco so chegaria na nuvem nos poucos clientes que alguem editasse
   * depois — e as demais balancas seguiriam divergentes, que e o problema de origem.
   */
  it("republica os clientes uma vez para o bloco comercial chegar na nuvem", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      seedCustomer(database);

      // A marca vem da migracao local desta versao.
      expect(readRepublishFlag(database)).toBe(true);
      await pushSharedCadastroToCloud(database, identity);
      expect(pushedRows("customers")).toHaveLength(1);
      expect(readRepublishFlag(database)).toBe(false);

      // Consumida: o ciclo seguinte volta a ser incremental e nao reenvia o mesmo cliente.
      invokeMock.mockClear();
      await pushSharedCadastroToCloud(database, identity);
      expect(pushedRows("customers")).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  // A secundaria nao publica o bloco, entao a marca nao e dela para consumir: ela continua
  // gravada e passa a valer no dia em que esta maquina for eleita principal.
  it("a secundaria nao consome a marca de republicacao", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedCustomer(database);
      electMasters(database, "desktop-a");

      await pushSharedCadastroToCloud(database, identity);

      expect(readRepublishFlag(database)).toBe(true);
    } finally {
      database.close();
    }
  });
});

function pushedRows(key: string): Array<Record<string, unknown>> {
  return invokeMock.mock.calls.flatMap(([, options]) => {
    const rows = options?.body?.[key];
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  });
}

function readRepublishFlag(database: DesktopDatabase): boolean {
  const row = database
    .prepare("SELECT value_json FROM local_settings WHERE key = ?")
    .pluck()
    .get(CUSTOMER_COMMERCIAL_REPUBLISH_KEY) as string | undefined;
  return row ? (JSON.parse(row) as boolean) : false;
}

function commercialOf(database: DesktopDatabase): Record<string, unknown> {
  return database
    .prepare(
      `SELECT default_payment_method_id, default_carrier_id, nf_required, credit_mode,
              credit_account_enabled, credit_periodicity, credit_closing_day,
              credit_second_closing_day, credit_boleto_days, credit_second_boleto_days,
              credit_closing_weekday
         FROM customers WHERE id = 'cust-1'`
    )
    .get() as Record<string, unknown>;
}

/** O cliente como a balanca principal o publica: bloco completo e marca preenchida. */
function cloudCustomer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cust-1",
    legal_name: "Cliente Um LTDA",
    trade_name: "Cliente Um",
    is_active: true,
    default_payment_method_id: null,
    default_carrier_id: null,
    nf_required: true,
    credit_mode: "normal",
    credit_account_enabled: false,
    credit_periodicity: "monthly",
    credit_closing_day: null,
    credit_second_closing_day: null,
    credit_boleto_days: null,
    credit_second_boleto_days: null,
    credit_closing_weekday: null,
    commercial_published_at: "2026-08-27T10:00:00.000Z",
    updated_at: "2026-08-27T10:00:00.000Z",
    ...overrides
  };
}

/** O painel marcou estas balancas como principais da pedreira. */
function electMasters(database: DesktopDatabase, ...masterDeviceIds: string[]): void {
  writeLocalSetting(database, PRICE_MASTER_DEVICE_IDS_KEY, masterDeviceIds);
  writeLocalSetting(
    database,
    PRICE_MASTER_DEVICE_NAMES_KEY,
    masterDeviceIds.map((id) => `PC ${id}`)
  );
}

function seedCustomer(database: DesktopDatabase): void {
  const now = "2026-08-20T10:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
       VALUES ('cust-1', 'company-1', 'local', 'Cliente Um LTDA', 'Cliente Um', 1, ?, ?)`
    )
    .run(now, now);
}

function seedPaymentMethod(database: DesktopDatabase, id: string): string {
  const now = "2026-08-20T10:00:00.000Z";
  database
    .prepare(
      `INSERT INTO payment_methods (id, company_id, code, name, is_system, is_customer_credit, sort_order, is_active, created_at, updated_at)
       VALUES (?, 'company-1', 'cash', 'Dinheiro', 1, 0, 1, 1, ?, ?)`
    )
    .run(id, now, now);
  return id;
}

function seedCarrier(database: DesktopDatabase, id: string): void {
  const now = "2026-08-20T10:00:00.000Z";
  database
    .prepare(
      `INSERT INTO carriers (id, company_id, name, source, is_active, created_at, updated_at)
       VALUES (?, 'company-1', 'Transportadora Um', 'local', 1, ?, ?)`
    )
    .run(id, now, now);
}

function createMachine(deviceId: string): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId,
    deviceName: `PC ${deviceId}`,
    installationId: `install-${deviceId}`,
    adoptDeviceId: true
  });
  const now = "2026-08-20T10:00:00.000Z";
  const settings: Array<[string, string]> = [
    ["cloud_company_id", "company-1"],
    ["cloud_unit_id", "unit-1"],
    ["cloud_device_id", deviceId],
    ["cloud_device_token", `token-${deviceId}`]
  ];
  for (const [key, value] of settings) {
    database
      .prepare(
        `INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
      )
      .run(key, JSON.stringify(value), now);
  }
  return database;
}

function readIdentity(database: DesktopDatabase): LocalDesktopIdentity {
  const deviceId = database
    .prepare("SELECT value_json FROM local_settings WHERE key = 'active_device_id'")
    .pluck()
    .get() as string;
  return {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    companyTradeName: "KyberRock",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: JSON.parse(deviceId) as string,
    deviceName: "PC",
    installationId: "install"
  } as LocalDesktopIdentity;
}
