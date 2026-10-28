import { describe, expect, it } from "vitest";

import {
  bankMovementFilename,
  bankMovementFootnote,
  bankMovementSummaryLines,
  buildBankMovementCaption,
  buildBankMovementTable,
  decodeHtmlEntities,
  parseBankStatement,
  parseStatementMovement,
  summarizeBankMovement
} from "./bank-movement";
import { STATEMENT_LIST_KEYS } from "./financial-report";

// Recorte do ListarExtrato real da conta Santander da Pedreira Ibiuna em 27/10/2026
// (nomes trocados, formato e valores mantidos).
const santanderResponse = {
  nCodCC: 11455922450,
  cDescricao: "Santander",
  nSaldoAnterior: 3895.4,
  nSaldoAtual: 3404.97,
  listaMovimentos: [
    {
      nSaldo: 3895.4,
      cDesCliente: "SALDO ANTERIOR",
      nCodLancamento: 1,
      dDataLancamento: "26/10/2026",
      nValorDocumento: 0
    },
    {
      nSaldo: 3894.8,
      cNumero: "26102026",
      cNatureza: "P",
      cSituacao: "Conciliado",
      cDesCliente: "",
      cObservacoes: "TARIFA AVULSA ENVIO PIX 26102026",
      cDesCategoria: "Tarifas Bancárias",
      dDataLancamento: "27/10/2026",
      nValorDocumento: -0.6
    },
    {
      nSaldo: 17092.04,
      cNumero: "pix.20261027.094928",
      cNatureza: "R",
      cSituacao: "Conciliado",
      cDesCliente: "Transf. Omie.CASH &gt;&gt; Santander",
      cObservacoes: "Gerado automaticamente.||Transferência via PIX|",
      cDesCategoria: "Entrada de Transferência",
      dDataLancamento: "27/10/2026",
      nValorDocumento: 13197.24
    },
    {
      nSaldo: 3592.04,
      cNatureza: "P",
      cSituacao: "Conciliado",
      cDesCliente: "TRANSPORTADORA EXEMPLO LTDA",
      cObservacoes: "|PIX ENVIADO TRANSPORTADORA",
      cDesCategoria: "Materiais Para Obras",
      dDataLancamento: "27/10/2026",
      nValorDocumento: -13500
    },
    {
      nSaldo: 3404.97,
      cNatureza: "P",
      cSituacao: "Não conciliado",
      cDesCliente: "POSTO EXEMPLO",
      cDesCategoria: "Combustível",
      dDataLancamento: "27/10/2026",
      nValorDocumento: -187.07
    },
    {
      nSaldo: 3404.97,
      cNatureza: "P",
      cSituacao: "Previsto",
      cDesCliente: "FORNECEDOR EM ABERTO",
      cDesCategoria: "Manutenção",
      dDataLancamento: "27/10/2026",
      nValorDocumento: -6068.53
    },
    {
      nSaldo: 3404.97,
      cDesCliente: "SALDO",
      nCodLancamento: 2,
      dDataLancamento: "27/10/2026",
      nValorDocumento: 0
    }
  ]
};

const account = { code: 11455922450, name: "Santander (painel)" };

describe("parseStatementMovement", () => {
  it("le os campos que o OMIE manda de verdade", () => {
    expect(parseStatementMovement(santanderResponse.listaMovimentos[3])).toEqual({
      date: "2026-10-27",
      counterpart: "TRANSPORTADORA EXEMPLO LTDA",
      category: "Materiais Para Obras",
      notes: "PIX ENVIADO TRANSPORTADORA",
      documentNumber: null,
      amountCents: -1350000,
      runningBalanceCents: 359204,
      status: "Conciliado",
      isBalanceLine: false,
      isForecast: false
    });
  });

  it("decodifica entidades HTML e junta os trechos da observacao", () => {
    const movement = parseStatementMovement(santanderResponse.listaMovimentos[2]);
    expect(movement.counterpart).toBe("Transf. Omie.CASH >> Santander");
    expect(movement.notes).toBe("Gerado automaticamente. - Transferência via PIX");
    expect(movement.amountCents).toBe(1319724);
  });

  it("usa a natureza para dar sinal a valor que veio sem sinal", () => {
    expect(
      parseStatementMovement({ cNatureza: "P", nValorDocumento: 50, dDataLancamento: "01/10/2026" })
        .amountCents
    ).toBe(-5000);
    expect(parseStatementMovement({ cNatureza: "R", nValorDocumento: -50 }).amountCents).toBe(5000);
  });

  it("reconhece as linhas de saldo e os previstos", () => {
    const rows = santanderResponse.listaMovimentos.map(parseStatementMovement);
    expect(rows.map((row) => row.isBalanceLine)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      true
    ]);
    expect(rows.filter((row) => row.isForecast)).toHaveLength(1);
  });
});

describe("parseBankStatement / summarizeBankMovement", () => {
  const statement = parseBankStatement(santanderResponse, account, STATEMENT_LIST_KEYS);
  const summary = summarizeBankMovement(statement);

  it("usa o nome da conta que o OMIE devolveu e os saldos dele", () => {
    expect(statement.accountName).toBe("Santander");
    expect(statement.openingBalanceCents).toBe(389540);
    expect(statement.closingBalanceCents).toBe(340497);
    expect(statement.movements).toHaveLength(5);
  });

  it("soma entradas e saidas do realizado, conciliado ou nao, e separa o previsto", () => {
    expect(summary).toEqual({
      inflowCents: 1319724,
      inflowCount: 1,
      outflowCents: 60 + 1350000 + 18707,
      outflowCount: 3,
      forecastCount: 1,
      forecastCents: -606853
    });
  });

  it("fecha com o saldo do OMIE: anterior + entradas - saidas = final", () => {
    expect((statement.openingBalanceCents ?? 0) + summary.inflowCents - summary.outflowCents).toBe(
      statement.closingBalanceCents
    );
  });

  it("cai nas linhas de saldo quando o topo nao traz os saldos", () => {
    const withoutTotals: Record<string, unknown> = { ...santanderResponse };
    delete withoutTotals.nSaldoAnterior;
    delete withoutTotals.nSaldoAtual;
    const fallback = parseBankStatement(withoutTotals, account, STATEMENT_LIST_KEYS);
    expect(fallback.openingBalanceCents).toBe(389540);
    expect(fallback.closingBalanceCents).toBe(340497);
  });

  it("dia sem movimento: lista vazia, saldo mantido", () => {
    const empty = parseBankStatement(
      {
        cDescricao: "Caixinha",
        nSaldoAnterior: 1300,
        nSaldoAtual: 1300,
        listaMovimentos: [
          { cDesCliente: "SALDO ANTERIOR", nSaldo: 1300, nValorDocumento: 0 },
          { cDesCliente: "SALDO", nSaldo: 1300, nValorDocumento: 0 }
        ]
      },
      { code: 1, name: "Caixinha" },
      STATEMENT_LIST_KEYS
    );
    expect(empty.movements).toEqual([]);
    expect(bankMovementSummaryLines(empty, summarizeBankMovement(empty))).toEqual([
      "Saldo anterior: R$ 1.300,00",
      "Entradas: R$ 0,00 (0)",
      "Saídas: R$ 0,00 (0)",
      "Saldo final: R$ 1.300,00"
    ]);
  });

  it("sem resposta legivel nao inventa saldo", () => {
    const broken = parseBankStatement({}, account, STATEMENT_LIST_KEYS);
    expect(broken.accountName).toBe("Santander (painel)");
    expect(broken.openingBalanceCents).toBeNull();
    expect(bankMovementSummaryLines(broken, summarizeBankMovement(broken))[0]).toBe(
      "Saldo anterior: -"
    );
  });
});

describe("relatorio da conta", () => {
  const statement = parseBankStatement(santanderResponse, account, STATEMENT_LIST_KEYS);
  const summary = summarizeBankMovement(statement);

  it("a tabela lista so o realizado, com valor com sinal e saldo da linha", () => {
    const table = buildBankMovementTable(statement);
    expect(table.columns.reduce((total, column) => total + column.width, 0)).toBeCloseTo(523.28);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[0]).toEqual([
      "27/10/2026",
      "-",
      "Tarifas Bancárias",
      "TARIFA AVULSA ENVIO PIX 26102026",
      "-R$ 0,60",
      "R$ 3.894,80"
    ]);
    expect(table.rows[1][4]).toBe("R$ 13.197,24");
  });

  it("o rodape avisa o previsto que ficou fora do saldo", () => {
    expect(bankMovementFootnote(summary)).toBe(
      "Fora do saldo: 1 lançamento(s) só previsto(s) no OMIE (-R$ 6.068,53)."
    );
    expect(
      bankMovementFootnote({ ...summary, forecastCount: 0, forecastCents: 0 })
    ).toBeUndefined();
  });

  it("a legenda do WhatsApp traz a conta, o dia e o resumo", () => {
    expect(
      buildBankMovementCaption({
        companyName: "Pedreira X",
        periodLabel: "27/10/2026",
        statement,
        summary
      })
    ).toBe(
      [
        "*Movimentação bancária - Santander - 27/10/2026*",
        "Pedreira X",
        "Saldo anterior: R$ 3.895,40",
        "Entradas: R$ 13.197,24 (1)",
        "Saídas: R$ 13.687,67 (3)",
        "Saldo final: R$ 3.404,97"
      ].join("\n")
    );
  });

  it("nome do arquivo sem acento nem espaco", () => {
    expect(bankMovementFilename("Itaú Unibanco", "2026-10-27")).toBe(
      "movimentacao-itau-unibanco-2026-10-27.pdf"
    );
    expect(bankMovementFilename("***", "2026-10-27")).toBe("movimentacao-conta-2026-10-27.pdf");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodifica nomeadas e numericas e deixa o resto como esta", () => {
    expect(decodeHtmlEntities("A &amp; B &#233; &#xE7; &foo; &#0;")).toBe("A & B é ç &foo; &#0;");
  });
});
