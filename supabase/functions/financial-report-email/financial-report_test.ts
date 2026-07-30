import { describe, expect, it } from "vitest";

import {
  accountsPayableTotalsCents,
  buildAccountsPayableTable,
  buildFinancialWhatsappCaption,
  buildStatementRequestParam,
  buildStatementTable,
  dispatchFailureReason,
  formatCentsBRL,
  formatDateBr,
  hasActiveChannel,
  STATEMENT_LIST_KEYS
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

describe("hasActiveChannel", () => {
  const base = { email: null, whatsappPhone: null, sendEmail: false, sendWhatsapp: false };

  it("aceita e-mail ligado com endereco e WhatsApp ligado com numero", () => {
    expect(hasActiveChannel({ ...base, sendEmail: true, email: "dono@pedreira.com" })).toBe(true);
    expect(hasActiveChannel({ ...base, sendWhatsapp: true, whatsappPhone: "5511999999999" })).toBe(
      true
    );
  });

  it("recusa canal ligado sem destino e destino sem canal ligado", () => {
    expect(hasActiveChannel({ ...base, sendEmail: true })).toBe(false);
    expect(hasActiveChannel({ ...base, sendWhatsapp: true })).toBe(false);
    expect(hasActiveChannel({ ...base, email: "dono@pedreira.com" })).toBe(false);
    expect(hasActiveChannel(base)).toBe(false);
  });
});

describe("dispatchFailureReason", () => {
  it("preserva o erro real em vez de culpar os canais", () => {
    expect(dispatchFailureReason(["omie: ListarContasPagar falhou (500)"])).toBe(
      "omie: ListarContasPagar falhou (500)"
    );
    expect(dispatchFailureReason(["omie: falhou", "email x@y.com: SMTP recusou"])).toBe(
      "omie: falhou | email x@y.com: SMTP recusou"
    );
  });

  it("cai num motivo generico so quando nao ha erro coletado", () => {
    expect(dispatchFailureReason([])).toBe("Falha ao montar o relatorio financeiro do OMIE");
    expect(dispatchFailureReason(["", "   "])).toBe(
      "Falha ao montar o relatorio financeiro do OMIE"
    );
  });
});

describe("buildStatementRequestParam", () => {
  const param = buildStatementRequestParam({
    accountCode: 4321,
    startDateBr: "01/07/2026",
    endDateBr: "30/07/2026"
  });

  it("manda conta e periodo no formato da OMIE", () => {
    expect(param).toEqual({
      nCodCC: 4321,
      dPeriodoInicial: "01/07/2026",
      dPeriodoFinal: "30/07/2026"
    });
  });

  it("nao manda paginacao: eccListarExtratoRequest recusa a chamada inteira", () => {
    // "Tag [PAGINA] nao faz parte da estrutura do tipo complexo
    // [eccListarExtratoRequest]" derrubava o relatorio financeiro todo dia.
    expect(Object.keys(param)).not.toContain("pagina");
    expect(Object.keys(param)).not.toContain("registros_por_pagina");
  });
});

describe("STATEMENT_LIST_KEYS", () => {
  it("procura primeiro o nome documentado do array de movimentos", () => {
    expect(STATEMENT_LIST_KEYS[0]).toBe("listaMovimentos");
  });
});
