import { describe, expect, it } from "vitest";

import {
  accountsPayableTotalsCents,
  buildAccountsPayableTable,
  buildFinancialWhatsappCaption,
  buildStatementTable,
  formatCentsBRL,
  formatDateBr
} from "./financial-report";

describe("formatCentsBRL / formatDateBr", () => {
  it("formata centavos em BRL", () => {
    expect(formatCentsBRL(150000)).toBe("R$ 1.500,00");
  });

  it("formata data ISO em dd/mm/aaaa e trata nulo", () => {
    expect(formatDateBr("2026-07-15")).toBe("15/07/2026");
    expect(formatDateBr(null)).toBe("-");
  });
});

describe("buildAccountsPayableTable", () => {
  it("curado: so as colunas essenciais, ordenado por vencimento, com nome resolvido", () => {
    const table = buildAccountsPayableTable(
      [
        {
          id: 2,
          supplierOmieCode: 20,
          documentNumber: "NF-2",
          dueDate: "2026-08-01",
          amountCents: 10000,
          paidAmountCents: 0,
          status: "open"
        },
        {
          id: 1,
          supplierOmieCode: 10,
          documentNumber: "NF-1",
          dueDate: "2026-07-01",
          amountCents: 50000,
          paidAmountCents: 20000,
          status: "partial"
        }
      ],
      new Map([
        [10, "Fornecedor A"],
        [20, "Fornecedor B"]
      ])
    );

    expect(table.columns.map((c) => c.header)).toEqual([
      "Fornecedor",
      "Documento",
      "Vencimento",
      "Valor em aberto",
      "Status"
    ]);
    expect(table.rows).toEqual([
      ["Fornecedor A", "NF-1", "01/07/2026", "R$ 300,00", "Parcial"],
      ["Fornecedor B", "NF-2", "01/08/2026", "R$ 100,00", "Em aberto"]
    ]);
  });

  it("usa 'Fornecedor #codigo' quando o nome nao foi resolvido", () => {
    const table = buildAccountsPayableTable(
      [
        {
          id: 1,
          supplierOmieCode: 99,
          documentNumber: null,
          dueDate: null,
          amountCents: 1000,
          paidAmountCents: 0,
          status: "overdue"
        }
      ],
      new Map()
    );
    expect(table.rows[0][0]).toBe("Fornecedor #99");
  });
});

describe("accountsPayableTotalsCents", () => {
  it("soma saldo em aberto e separa o total vencido", () => {
    const totals = accountsPayableTotalsCents([
      {
        id: 1,
        supplierOmieCode: null,
        documentNumber: null,
        dueDate: null,
        amountCents: 1000,
        paidAmountCents: 1000,
        status: "paid"
      },
      {
        id: 2,
        supplierOmieCode: null,
        documentNumber: null,
        dueDate: null,
        amountCents: 5000,
        paidAmountCents: 0,
        status: "overdue"
      },
      {
        id: 3,
        supplierOmieCode: null,
        documentNumber: null,
        dueDate: null,
        amountCents: 2000,
        paidAmountCents: 500,
        status: "partial"
      }
    ]);
    expect(totals).toEqual({ openCents: 6500, overdueCents: 5000 });
  });
});

describe("buildStatementTable", () => {
  it("mostra todos os lancamentos, sem filtrar linhas", () => {
    const table = buildStatementTable([
      {
        accountName: "Banco X - CC 1234",
        date: "2026-07-05",
        description: "Deposito cliente X",
        documentNumber: "DOC1",
        nature: "C",
        amountCents: 150000,
        runningBalanceCents: 250000
      },
      {
        accountName: "Banco X - CC 1234",
        date: "2026-07-06",
        description: "Tarifa bancaria",
        documentNumber: null,
        nature: "D",
        amountCents: 5000,
        runningBalanceCents: null
      }
    ]);

    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual([
      "05/07/2026",
      "Banco X - CC 1234",
      "Deposito cliente X",
      "DOC1",
      "Credito",
      "R$ 1.500,00",
      "R$ 2.500,00"
    ]);
    expect(table.rows[1][6]).toBe("-");
  });
});

describe("buildFinancialWhatsappCaption", () => {
  it("inclui totais e so mostra vencidas quando houver", () => {
    const caption = buildFinancialWhatsappCaption({
      companyName: "Pedreira X",
      periodLabel: "15/07/2026",
      accountsPayableCount: 3,
      accountsPayableOpenCents: 10000,
      accountsPayableOverdueCents: 0,
      statementEntriesCount: 5
    });
    expect(caption).not.toContain("Vencidas:");
    expect(caption).toContain("Pedreira X");
    expect(caption).toContain("5 lancamento(s)");
  });
});
