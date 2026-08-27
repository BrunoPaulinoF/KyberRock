import { beforeEach, describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { resolveCustomerFutureBillingInvoice } from "./customer-future-billing";
import {
  pullDesktopDataFromCloud,
  pushSharedCadastroToCloud,
  resetSharedCadastroPushState
} from "./supabase-sync";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    functions: {
      invoke: invokeMock
    }
  }))
}));

/**
 * Cadastro compartilhado entre os computadores da mesma pedreira: o que uma
 * maquina cadastra (transportadora, motorista, veiculo, vinculo, preco) tem de
 * chegar as outras pela nuvem, sem depender de refazer o pull do OMIE.
 */
describe("cadastro compartilhado da pedreira", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it("nao reintroduz nem ressuscita um cadastro que ja existe localmente pelo documento", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      const companyId = identity.companyId;
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, is_active, created_at, updated_at)
           VALUES ('local-uuid', ?, 'local', 'Apenas Teste LTDA', 'Apenas Teste', '26463463000183', 1, ?, ?)`
        )
        .run(companyId, "2026-07-27T10:00:00.000Z", "2026-07-27T10:00:00.000Z");
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, name, document, source, is_active, created_at, updated_at)
           VALUES ('carrier-uuid', ?, 'Transportes Alfa', '11222333000144', 'local', 1, ?, ?)`
        )
        .run(companyId, "2026-07-27T10:00:00.000Z", "2026-07-27T10:00:00.000Z");

      // A nuvem devolve o MESMO cadastro sob outro id (o gemeo que ja existiu la).
      invokeMock.mockResolvedValueOnce({
        data: {
          customers: [
            {
              id: "omie_777",
              legal_name: "Apenas Teste LTDA",
              trade_name: "Apenas Teste",
              document: "26463463000183",
              is_active: true,
              updated_at: "2026-07-28T10:00:00.000Z"
            }
          ],
          carriers: [
            {
              id: "omie_supplier_888",
              name: "Transportes Alfa",
              document: "11222333000144",
              source: "local",
              is_active: true,
              updated_at: "2026-07-28T10:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      // O upsert casava so por id (e limpava deleted_at): a linha da nuvem entrava
      // ao lado da local, deixando a lista duplicada de novo depois de cada pull.
      expect(
        database.prepare("SELECT id FROM customers WHERE deleted_at IS NULL").pluck().all()
      ).toEqual(["local-uuid"]);
      expect(
        database.prepare("SELECT id FROM carriers WHERE deleted_at IS NULL").pluck().all()
      ).toEqual(["carrier-uuid"]);
    } finally {
      database.close();
    }
  });

  // O cliente cadastrado aqui e o gemeo que veio do OMIE sao o mesmo CNPJ/CPF. Descartar
  // a linha da nuvem sem aproveitar o codigo deixava o cadastro local para sempre sem
  // omie_customer_id: todo fechamento dele repetia um IncluirCliente de um cadastro que ja
  // existe no OMIE ("Cliente ja cadastrado") e a operacao nunca subia.
  it("adota no cadastro local o codigo OMIE do gemeo que veio da nuvem", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document,
                                  omie_customer_id, needs_push, is_active, created_at, updated_at)
           VALUES ('local-uuid', ?, 'local', 'Multicom LTDA', 'Multicom', '19345178000100',
                   NULL, 1, 1, ?, ?)`
        )
        .run(identity.companyId, "2026-08-03T09:00:00.000Z", "2026-08-03T09:00:00.000Z");
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, name, document, source, omie_customer_id,
                                 is_active, created_at, updated_at)
           VALUES ('carrier-uuid', ?, 'Transportes Alfa', '11222333000144', 'local', NULL, 1, ?, ?)`
        )
        .run(identity.companyId, "2026-08-03T09:00:00.000Z", "2026-08-03T09:00:00.000Z");

      // O mesmo documento chega da nuvem sob o id do OMIE, ja com o codigo de la.
      invokeMock.mockResolvedValueOnce({
        data: {
          customers: [
            {
              id: "omie_11489512176",
              omie_customer_id: 11489512176,
              legal_name: "MULTICOM COMERCIO DE MATERAIS DE CONSTRUCAO LTDA",
              trade_name: "MULTICOM",
              document: "19.345.178/0001-00",
              is_active: true,
              updated_at: "2026-08-03T09:44:34.000Z"
            }
          ],
          carriers: [
            {
              id: "omie_555",
              omie_customer_id: 555,
              name: "Transportes Alfa",
              document: "11.222.333/0001-44",
              source: "omie",
              is_active: true,
              updated_at: "2026-08-03T09:44:34.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      // A linha da nuvem continua descartada (nada de cadastro duplicado na lista)...
      expect(
        database.prepare("SELECT id FROM customers WHERE deleted_at IS NULL").pluck().all()
      ).toEqual(["local-uuid"]);
      // ...mas o codigo do OMIE foi aproveitado: o proximo envio vira AlterarCliente.
      expect(
        database
          .prepare("SELECT omie_customer_id FROM customers WHERE id = 'local-uuid'")
          .pluck()
          .get()
      ).toBe(11489512176);
      // O envio ao OMIE segue armado: agora ele tem como se vincular ao cadastro de la.
      expect(
        database.prepare("SELECT needs_push FROM customers WHERE id = 'local-uuid'").pluck().get()
      ).toBe(1);
      expect(
        database
          .prepare("SELECT omie_customer_id FROM carriers WHERE id = 'carrier-uuid'")
          .pluck()
          .get()
      ).toBe(555);
    } finally {
      database.close();
    }
  });

  // O CPF/CNPJ que o operador digita fica com needs_push = 1 esperando o envio ao OMIE.
  // O pull do cadastro sobrescrevia a linha inteira com a versao (mais velha) da nuvem e
  // ainda zerava o needs_push: o documento sumia da tela e o cadastro nunca chegava ao
  // OMIE — "o KyberRock nao esta cadastrando o CPF do cliente".
  it("nao sobrescreve o cadastro do cliente editado aqui e ainda nao enviado ao OMIE", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      database
        .prepare(
          `INSERT INTO customers (
             id, company_id, omie_customer_id, source, legal_name, trade_name, document, phone, email,
             sync_status, needs_push, is_active, created_at, updated_at
           ) VALUES ('cust-1', ?, 4242, 'hybrid', 'Jose da Silva', 'Jose', '45648723890',
                     '31988887777', 'jose@exemplo.com', 'pending', 1, 1, ?, ?)`
        )
        .run(identity.companyId, "2026-07-27T10:00:00.000Z", "2026-08-03T09:00:00.000Z");

      // A nuvem ainda tem a versao velha (sem CPF, sem telefone) e sem o codigo OMIE.
      invokeMock.mockResolvedValueOnce({
        data: {
          customers: [
            {
              id: "cust-1",
              omie_customer_id: null,
              legal_name: "Jose da Silva",
              trade_name: "Jose",
              document: null,
              phone: null,
              email: null,
              open_receivables_cents: 15000,
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      const row = database
        .prepare(
          "SELECT document, phone, email, omie_customer_id, needs_push, open_receivables_cents FROM customers WHERE id = 'cust-1'"
        )
        .get() as {
        document: string | null;
        phone: string | null;
        email: string | null;
        omie_customer_id: number | null;
        needs_push: number;
        open_receivables_cents: number;
      };
      expect(row.document).toBe("45648723890");
      expect(row.phone).toBe("31988887777");
      expect(row.email).toBe("jose@exemplo.com");
      // O codigo do OMIE que ja temos nunca e apagado: sem ele o proximo push tentaria
      // um IncluirCliente de um cadastro que ja existe la.
      expect(row.omie_customer_id).toBe(4242);
      // O envio ao OMIE continua armado.
      expect(row.needs_push).toBe(1);
      // Saldo em aberto e projecao da nuvem: esse sim vem de la.
      expect(row.open_receivables_cents).toBe(15000);
    } finally {
      database.close();
    }
  });

  it("aplica o cadastro da nuvem quando nao ha edicao local pendente", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      database
        .prepare(
          `INSERT INTO customers (
             id, company_id, source, legal_name, trade_name, document, sync_status, needs_push,
             is_active, created_at, updated_at
           ) VALUES ('cust-2', ?, 'hybrid', 'Construtora Beta', 'Beta', NULL, 'synced', 0, 1, ?, ?)`
        )
        .run(identity.companyId, "2026-07-27T10:00:00.000Z", "2026-07-27T10:00:00.000Z");

      invokeMock.mockResolvedValueOnce({
        data: {
          customers: [
            {
              id: "cust-2",
              legal_name: "Construtora Beta LTDA",
              trade_name: "Beta",
              document: "26463463000183",
              is_active: true,
              updated_at: "2026-08-03T09:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      const row = database
        .prepare("SELECT legal_name, document FROM customers WHERE id = 'cust-2'")
        .get() as { legal_name: string; document: string | null };
      expect(row.legal_name).toBe("Construtora Beta LTDA");
      expect(row.document).toBe("26463463000183");
    } finally {
      database.close();
    }
  });

  it("projeta no SQLite o cadastro que veio do desktop-pull", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      invokeMock.mockResolvedValueOnce({
        data: {
          customers: [
            {
              id: "cust-1",
              legal_name: "Construtora Alfa",
              trade_name: "Alfa",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          products: [
            {
              id: "prod-1",
              code: "B1",
              description: "Brita 1",
              unit: "KG",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          carriers: [
            {
              id: "carrier-1",
              name: "Transportes Beta",
              document: "12345678000199",
              source: "local",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          drivers: [
            {
              id: "driver-1",
              name: "Joao Motorista",
              document: "12345678901",
              is_independent: false,
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          vehicles: [
            {
              id: "vehicle-1",
              plate: "abc1d23",
              carrier_id: "carrier-1",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          customerCarriers: [
            {
              id: "cc-1",
              customer_id: "cust-1",
              carrier_id: "carrier-1",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          driverCarriers: [
            {
              id: "dc-1",
              driver_id: "driver-1",
              carrier_id: "carrier-1",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          vehicleCarriers: [
            {
              id: "vc-1",
              vehicle_id: "vehicle-1",
              carrier_id: "carrier-1",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          productDefaultPrices: [
            {
              id: "price-1",
              product_id: "prod-1",
              unit_price_cents: 9_000,
              unit: "ton",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          customerSpecialPrices: [
            {
              id: "special-1",
              customer_id: "cust-1",
              product_id: "prod-1",
              unit_price_cents: 8_500,
              unit: "ton",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          reportRecipients: [
            {
              id: "recipient-1",
              email: "dono@example.com",
              send_email: true,
              send_whatsapp: false,
              schedule_frequency: "daily",
              schedule_time: "20:00",
              report_types: "both",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ]
        },
        error: null
      });

      const pulled = await pullDesktopDataFromCloud(database, identity);

      expect(pulled.cadastro).toBe(9);
      expect(count(database, "carriers")).toBe(1);
      expect(count(database, "drivers")).toBe(1);
      expect(count(database, "customer_carriers")).toBe(1);
      expect(count(database, "driver_carriers")).toBe(1);
      expect(count(database, "vehicle_carriers")).toBe(1);
      expect(count(database, "product_default_prices")).toBe(1);
      expect(count(database, "customer_special_prices")).toBe(1);
      expect(count(database, "report_recipients")).toBe(1);
      // Placa normalizada alimenta a busca por placa nas telas de pesagem.
      expect(
        database
          .prepare("SELECT plate_normalized FROM vehicles WHERE id = 'vehicle-1'")
          .pluck()
          .get()
      ).toBe("ABC1D23");
    } finally {
      database.close();
    }
  });

  it("soma o credito lancado na outra maquina em vez de sobrescrever o saldo", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      seedLocalCadastro(database);
      // Debito lancado nesta maquina: saldo local ja reflete -30,00.
      insertCreditMovement(database, {
        id: "mov-local",
        movementType: "debit_product",
        amountCents: 3_000,
        balanceAfterCents: 7_000,
        createdAt: "2026-07-27T12:00:00.000Z"
      });
      database
        .prepare(
          `INSERT INTO customer_credit_balances (customer_id, balance_cents, updated_at)
           VALUES ('cust-1', 7000, '2026-07-27T12:00:00.000Z')`
        )
        .run();

      // A outra balanca lancou um debito de 20,00 no mesmo cliente.
      invokeMock.mockResolvedValueOnce({
        data: {
          customerCreditMovements: [
            {
              id: "mov-remoto",
              customer_id: "cust-1",
              operation_id: "op-que-nao-existe-aqui",
              movement_type: "debit_freight",
              amount_cents: 2_000,
              balance_after_cents: 8_000,
              created_at: "2026-07-27T12:05:00.000Z"
            },
            {
              id: "mov-credito",
              customer_id: "cust-1",
              movement_type: "credit",
              amount_cents: 10_000,
              balance_after_cents: 10_000,
              created_at: "2026-07-27T11:00:00.000Z"
            }
          ]
        },
        error: null
      });

      const pulled = await pullDesktopDataFromCloud(database, identity);

      expect(pulled.cadastro).toBe(2);
      // Saldo recalculado pelo log inteiro: +100,00 -30,00 -20,00 = 50,00.
      expect(
        database
          .prepare(
            "SELECT balance_cents FROM customer_credit_balances WHERE customer_id = 'cust-1'"
          )
          .pluck()
          .get()
      ).toBe(5_000);
      // Movimento de operacao que nao existe nesta maquina entra sem o vinculo.
      expect(
        database
          .prepare("SELECT operation_id FROM customer_credit_movements WHERE id = 'mov-remoto'")
          .pluck()
          .get()
      ).toBeNull();
    } finally {
      database.close();
    }
  });

  it("projeta tabelas de preco, frete, condicoes/formas de pagamento e contas", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedLocalCadastro(database);
      invokeMock.mockResolvedValueOnce({
        data: {
          priceTables: [
            {
              id: "pt-1",
              name: "Tabela 2026",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          priceTableItems: [
            {
              id: "pti-1",
              price_table_id: "pt-1",
              product_id: "prod-1",
              unit_price_cents: 9_500,
              unit: "ton",
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          customerPriceTables: [
            {
              id: "cpt-1",
              customer_id: "cust-1",
              price_table_id: "pt-1",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          customerFreightRules: [
            {
              id: "fr-1",
              customer_id: "cust-1",
              product_id: null,
              rule_json: { mode: "per_ton", price_cents: 1_200 },
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          customerFutureBillingInvoices: [
            {
              id: "fb-1",
              customer_id: "cust-1",
              product_id: "prod-1",
              nfe_number: "12345",
              total_weight_kg: 500000,
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          paymentTerms: [
            {
              id: "term-1",
              name: "30 dias",
              omie_code: "30",
              rules_json: { installments: 1 },
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          paymentMethods: [
            {
              id: "pm-remoto",
              code: "boleto_especial",
              name: "Boleto especial",
              is_system: false,
              is_customer_credit: false,
              sort_order: 9,
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ],
          accounts: [
            {
              id: "acc-1",
              code: "CX2",
              name: "Caixa 2",
              is_system: false,
              sort_order: 2,
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ]
        },
        error: null
      });

      const pulled = await pullDesktopDataFromCloud(database, identity);

      expect(pulled.cadastro).toBe(8);
      expect(count(database, "price_tables")).toBe(1);
      expect(count(database, "price_table_items")).toBe(1);
      expect(count(database, "customer_price_tables")).toBe(1);
      expect(count(database, "customer_freight_rules")).toBe(1);
      expect(count(database, "customer_future_billing_invoices")).toBe(1);
      expect(count(database, "payment_terms")).toBe(1);
      expect(count(database, "accounts")).toBe(1);
      expect(
        database
          .prepare("SELECT rule_json FROM customer_freight_rules WHERE id = 'fr-1'")
          .pluck()
          .get()
      ).toBe('{"mode":"per_ton","price_cents":1200}');
      // A balanca B resolve a nota que a balanca A cadastrou: e isso que faz as duas
      // faturarem o mesmo cliente com a mesma referencia.
      expect(resolveCustomerFutureBillingInvoice(database, "cust-1", "prod-1")?.nfeNumber).toBe(
        "12345"
      );
      // O total tambem atravessa: sem ele a balanca B somaria retiradas contra um teto
      // que nao conhece e o saldo das duas maquinas nunca bateria.
      expect(
        database
          .prepare("SELECT total_weight_kg FROM customer_future_billing_invoices WHERE id = 'fb-1'")
          .pluck()
          .get()
      ).toBe(500000);
    } finally {
      database.close();
    }
  });

  it("ignora vinculo cuja ponta ainda nao chegou em vez de derrubar o pull", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      invokeMock.mockResolvedValueOnce({
        data: {
          customerCarriers: [
            {
              id: "cc-orfao",
              customer_id: "cliente-inexistente",
              carrier_id: "carrier-inexistente",
              is_active: true,
              updated_at: "2026-07-27T10:00:00.000Z"
            }
          ]
        },
        error: null
      });

      const pulled = await pullDesktopDataFromCloud(database, identity);

      expect(pulled.cadastro).toBe(0);
      expect(count(database, "customer_carriers")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("repassa os avisos por tabela do desktop-pull (ex.: migracao pendente na nuvem)", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      invokeMock.mockResolvedValueOnce({
        data: {
          warnings: ["customer_carriers: tabela ausente na nuvem"]
        },
        error: null
      });

      const pulled = await pullDesktopDataFromCloud(database, identity);

      expect(pulled.warnings).toEqual(["customer_carriers: tabela ausente na nuvem"]);
    } finally {
      database.close();
    }
  });

  it("pede so o cadastro alterado no pull incremental e o cadastro inteiro na varredura completa", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      invokeMock.mockResolvedValueOnce({
        data: { serverTime: "2026-07-28T10:00:00.000Z" },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);
      // Varredura completa nunca manda cadastroSince: reenvia tudo e corrige
      // qualquer registro que um incremento tenha deixado passar.
      expect(invokeMock.mock.calls[0][1].body.cadastroSince).toBeUndefined();

      invokeMock.mockClear();
      invokeMock.mockResolvedValueOnce({ data: {}, error: null });
      await pullDesktopDataFromCloud(database, identity, { incremental: true });

      // Marca do relogio do servidor com a janela de sobreposicao de 5 minutos.
      expect(invokeMock.mock.calls[0][1].body.cadastroSince).toBe("2026-07-28T09:55:00.000Z");
    } finally {
      database.close();
    }
  });

  it("nao avanca a marca do incremento quando alguma tabela veio com aviso", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      invokeMock.mockResolvedValueOnce({
        data: { serverTime: "2026-07-28T10:00:00.000Z", warnings: ["carriers: tabela ausente"] },
        error: null
      });
      await pullDesktopDataFromCloud(database, identity);

      invokeMock.mockClear();
      invokeMock.mockResolvedValueOnce({ data: {}, error: null });
      await pullDesktopDataFromCloud(database, identity, { incremental: true });

      expect(invokeMock.mock.calls[0][1].body.cadastroSince).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("publica o cadastro local por ordem de dependencia e so reenvia o que mudou", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      seedLocalCadastro(database);

      const first = await pushSharedCadastroToCloud(database, identity);

      expect(first.errors).toEqual([]);
      const pushedKeys = invokeMock.mock.calls.map(
        ([, options]) =>
          Object.keys(options.body).find((key) => Array.isArray(options.body[key])) ?? ""
      );
      // Dependencias antes dos dependentes: transportadora antes do vinculo.
      expect(pushedKeys).toContain("carriers");
      expect(pushedKeys).toContain("customerCarriers");
      expect(pushedKeys.indexOf("carriers")).toBeLessThan(pushedKeys.indexOf("customerCarriers"));
      expect(payloadFor("carriers")).toHaveLength(1);
      expect(payloadFor("customerCarriers")).toHaveLength(1);
      // A nota de entrega futura sobe junto do resto do cadastro, depois do cliente e do
      // produto que ela referencia.
      expect(payloadFor("customerFutureBillingInvoices")).toMatchObject([
        {
          id: "fb-1",
          customer_id: "cust-1",
          product_id: "prod-1",
          nfe_number: "12345",
          total_weight_kg: 500000
        }
      ]);

      // Segundo ciclo sem alteracao local: nada a reenviar.
      invokeMock.mockClear();
      const second = await pushSharedCadastroToCloud(database, identity);
      expect(second.pushed).toBe(0);
      expect(invokeMock).not.toHaveBeenCalled();

      // Alteracao local volta a ser enviada.
      database
        .prepare("UPDATE carriers SET name = 'Transportes Beta LTDA', updated_at = ? WHERE id = ?")
        .run("2026-07-28T12:00:00.000Z", "carrier-1");
      invokeMock.mockClear();
      const third = await pushSharedCadastroToCloud(database, identity);
      expect(third.pushed).toBe(1);
      expect(payloadFor("carriers")).toMatchObject([
        { id: "carrier-1", name: "Transportes Beta LTDA" }
      ]);
    } finally {
      database.close();
    }
  });

  it("envia registro apagado localmente como inativo para as outras maquinas", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      seedLocalCadastro(database);
      await pushSharedCadastroToCloud(database, identity);

      database
        .prepare("UPDATE carriers SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .run("2026-07-28T13:00:00.000Z", "2026-07-28T13:00:00.000Z", "carrier-1");
      invokeMock.mockClear();

      await pushSharedCadastroToCloud(database, identity);

      expect(payloadFor("carriers")).toMatchObject([{ id: "carrier-1", is_active: false }]);
    } finally {
      database.close();
    }
  });

  it("isola registro rejeitado pela nuvem sem travar o resto do cadastro", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      seedLocalCadastro(database);
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, name, source, is_active, created_at, updated_at)
           VALUES ('carrier-2', 'company-1', 'Transportes Gama', 'local', 1, ?, ?)`
        )
        .run("2026-07-27T11:00:00.000Z", "2026-07-27T11:00:00.000Z");

      invokeMock.mockImplementation((_name: string, options: { body: Record<string, unknown> }) => {
        const carriers = options.body.carriers as Array<{ id: string }> | undefined;
        if (carriers?.some((carrier) => carrier.id === "carrier-1")) {
          return Promise.resolve({ data: null, error: new Error("registro invalido") });
        }
        return Promise.resolve({ data: { ok: true }, error: null });
      });

      const result = await pushSharedCadastroToCloud(database, identity);

      // A transportadora valida passou; so a rejeitada virou erro.
      expect(result.errors.join(" ")).toContain("carrier-1");
      expect(result.errors.join(" ")).not.toContain("carrier-2");
      // Cursor avancou: o proximo ciclo nao repete o lote inteiro por causa dela.
      invokeMock.mockClear();
      invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
      const second = await pushSharedCadastroToCloud(database, identity);
      expect(second.pushed).toBe(0);
    } finally {
      database.close();
    }
  });

  it("nao avanca o cursor quando a nuvem esta indisponivel", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      seedLocalCadastro(database);
      invokeMock.mockResolvedValue({ data: null, error: new Error("Failed to fetch") });

      const offline = await pushSharedCadastroToCloud(database, identity);
      expect(offline.pushed).toBe(0);

      // Nuvem de volta: o cadastro inteiro ainda esta pendente e e enviado.
      invokeMock.mockReset();
      invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
      const recovered = await pushSharedCadastroToCloud(database, identity);
      expect(recovered.errors).toEqual([]);
      expect(recovered.pushed).toBe(8);
    } finally {
      database.close();
    }
  });

  it("reset do estado faz a maquina republicar todo o cadastro", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      seedLocalCadastro(database);
      await pushSharedCadastroToCloud(database, identity);

      resetSharedCadastroPushState(database);
      invokeMock.mockClear();
      const again = await pushSharedCadastroToCloud(database, identity);

      expect(again.pushed).toBeGreaterThan(0);
      expect(payloadFor("carriers")).toHaveLength(1);
    } finally {
      database.close();
    }
  });
  it("publica as placas do cliente depois do cliente e do veiculo que elas ligam", async () => {
    const database = createMachine("desktop-a");

    try {
      const identity = readIdentity(database);
      seedLocalCadastro(database);
      seedCustomerVehicle(database);

      await pushSharedCadastroToCloud(database, identity);

      const pushedKeys = invokeMock.mock.calls.map(
        ([, options]) =>
          Object.keys(options.body).find((key) => Array.isArray(options.body[key])) ?? ""
      );
      expect(pushedKeys.indexOf("customers")).toBeLessThan(pushedKeys.indexOf("customerVehicles"));
      expect(pushedKeys.indexOf("vehicles")).toBeLessThan(pushedKeys.indexOf("customerVehicles"));
      expect(payloadFor("customerVehicles")).toMatchObject([
        { id: "cv-1", customer_id: "cust-1", vehicle_id: "veh-1", is_active: true }
      ]);
    } finally {
      database.close();
    }
  });

  it("recebe da nuvem a placa vinculada em outra balanca", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedLocalCadastro(database);
      database
        .prepare(
          `INSERT INTO vehicles (id, company_id, plate, is_active, created_at, updated_at)
           VALUES ('veh-1', 'company-1', 'HJI-0517', 1, ?, ?)`
        )
        .run("2026-08-27T10:00:00.000Z", "2026-08-27T10:00:00.000Z");

      invokeMock.mockResolvedValueOnce({
        data: {
          customerVehicles: [
            {
              id: "cv-remoto",
              customer_id: "cust-1",
              vehicle_id: "veh-1",
              is_active: true,
              updated_at: "2026-08-27T11:00:00.000Z"
            }
          ]
        },
        error: null
      });

      await pullDesktopDataFromCloud(database, identity);

      expect(
        database
          .prepare("SELECT vehicle_id FROM customer_vehicles WHERE deleted_at IS NULL")
          .pluck()
          .all()
      ).toEqual(["veh-1"]);
    } finally {
      database.close();
    }
  });

  // O vinculo nao tem valor a disputar: o que nao pode e a segunda copia derrubar o pull
  // inteiro no indice unico (cliente, placa).
  it("o mesmo vinculo vindo com outro id nao duplica nem derruba o pull", async () => {
    const database = createMachine("desktop-b");

    try {
      const identity = readIdentity(database);
      seedLocalCadastro(database);
      seedCustomerVehicle(database);

      invokeMock.mockResolvedValueOnce({
        data: {
          customerVehicles: [
            {
              id: "cv-gemeo",
              customer_id: "cust-1",
              vehicle_id: "veh-1",
              is_active: true,
              updated_at: "2026-08-27T11:00:00.000Z"
            }
          ]
        },
        error: null
      });

      const pulled = await pullDesktopDataFromCloud(database, identity);

      expect(pulled.warnings).toEqual([]);
      expect(
        database.prepare("SELECT id FROM customer_vehicles WHERE deleted_at IS NULL").pluck().all()
      ).toEqual(["cv-1"]);
    } finally {
      database.close();
    }
  });
});

function payloadFor(key: string): Array<Record<string, unknown>> {
  const call = invokeMock.mock.calls.find(([, options]) => Array.isArray(options?.body?.[key]));
  return (call?.[1].body[key] ?? []) as Array<Record<string, unknown>>;
}

function insertCreditMovement(
  database: DesktopDatabase,
  movement: {
    id: string;
    movementType: string;
    amountCents: number;
    balanceAfterCents: number;
    createdAt: string;
  }
): void {
  database
    .prepare(
      `INSERT INTO customer_credit_movements (
         id, company_id, customer_id, operation_id, movement_type, amount_cents,
         balance_after_cents, reason, created_at
       ) VALUES (?, 'company-1', 'cust-1', NULL, ?, ?, ?, NULL, ?)`
    )
    .run(
      movement.id,
      movement.movementType,
      movement.amountCents,
      movement.balanceAfterCents,
      movement.createdAt
    );
}

function count(database: DesktopDatabase, table: string): number {
  return database.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
}

/** Cadastro minimo criado "na maquina A" para ser publicado na nuvem. */
function seedLocalCadastro(database: DesktopDatabase): void {
  const now = "2026-07-27T10:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
       VALUES ('cust-1', 'company-1', 'local', 'Construtora Alfa', 'Alfa', 1, ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO products (id, company_id, code, description, unit, is_active, created_at, updated_at)
       VALUES ('prod-1', 'company-1', 'B1', 'Brita 1', 'KG', 1, ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO carriers (id, company_id, name, document, source, is_active, created_at, updated_at)
       VALUES ('carrier-1', 'company-1', 'Transportes Beta', '12345678000199', 'local', 1, ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO drivers (id, company_id, name, document, is_active, created_at, updated_at)
       VALUES ('driver-1', 'company-1', 'Joao Motorista', '12345678901', 1, ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO vehicles (id, company_id, plate, plate_normalized, carrier_id, is_active, created_at, updated_at)
       VALUES ('vehicle-1', 'company-1', 'ABC1D23', 'ABC1D23', 'carrier-1', 1, ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO customer_carriers (id, customer_id, carrier_id, is_active, created_at, updated_at)
       VALUES ('cc-1', 'cust-1', 'carrier-1', 1, ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO product_default_prices (id, company_id, product_id, unit_price_cents, unit, is_active, created_at, updated_at)
       VALUES ('price-1', 'company-1', 'prod-1', 9000, 'ton', 1, ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO customer_future_billing_invoices (id, customer_id, product_id, nfe_number, total_weight_kg, is_active, created_at, updated_at)
       VALUES ('fb-1', 'cust-1', 'prod-1', '12345', 500000, 1, ?, ?)`
    )
    .run(now, now);
}

/**
 * As placas do cliente (aba Transporte) sao cadastro compartilhado como qualquer outro: a
 * balanca que nao recebesse o vinculo filtraria o campo Placa por uma lista vazia.
 */
function seedCustomerVehicle(database: DesktopDatabase): void {
  const now = "2026-08-27T10:00:00.000Z";
  database
    .prepare(
      `INSERT INTO vehicles (id, company_id, plate, is_active, created_at, updated_at)
       VALUES ('veh-1', 'company-1', 'HJI-0517', 1, ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO customer_vehicles (id, customer_id, vehicle_id, is_active, created_at, updated_at)
       VALUES ('cv-1', 'cust-1', 'veh-1', 1, ?, ?)`
    )
    .run(now, now);
}

/** Cria o SQLite de uma maquina ja ativada na nuvem com o id de dispositivo dado. */
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
  const now = "2026-07-22T10:00:00.000Z";
  const settings: Array<[string, string]> = [
    ["cloud_company_id", "company-1"],
    ["cloud_unit_id", "unit-1"],
    ["cloud_device_id", deviceId],
    ["cloud_device_token", `token-${deviceId}`]
  ];
  for (const [key, value] of settings) {
    database
      .prepare("INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)")
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
