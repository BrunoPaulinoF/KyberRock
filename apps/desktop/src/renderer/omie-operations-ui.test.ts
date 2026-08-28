import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(rendererDir, "App.tsx"), "utf8");
const customersSource = readFileSync(resolve(rendererDir, "CustomersView.tsx"), "utf8");

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("tela de operacoes concluidas", () => {
  it("tem a busca por cliente, CNPJ/CPF ou produto", () => {
    const toolbar = sliceBetween(appSource, "value={closedProductFilter}", "showDeviceColors ?");

    expect(toolbar).toContain("Cliente, CNPJ/CPF ou produto");
    // A busca continua pontuando por proximidade em memoria: a ordenacao dela nao tem
    // equivalente em SQL, e paginar antes de pontuar mudaria qual linha aparece primeiro.
    expect(appSource).toContain("filterClosedOperationsBySearch(closedOperations, closedSearch)");
  });

  it("filtra por produto e pagina no banco, nao em memoria", () => {
    // O filtro de produto saiu do `.filter()` em memoria e foi para o SQL junto com a
    // paginacao -- e o que impede a tela de carregar o historico inteiro a cada ciclo.
    // Se alguem trouxer o filtro de volta para a memoria, a lista volta a crescer sem fim.
    expect(appSource).toContain("loadClosedOperationsData(");
    expect(appSource).not.toContain(
      "closedOperations.filter((op) => op.productDescription === closedProductFilter)"
    );
    expect(appSource).toContain("Carregar mais");
  });

  it("a busca espera o operador parar de digitar antes de ir ao banco", () => {
    // Com busca digitada a carga traz o conjunto INTEIRO (a pontuacao por proximidade nao
    // existe em SQL). Se a carga dependesse do valor imediato, cada TECLA releria todo o
    // historico -- pior que antes desta mudanca, quando digitar nao tocava o banco.
    // A tela e a pontuacao seguem com `closedSearch`, sem espera; so a CARGA espera.
    expect(appSource).toContain(
      "const closedSearchForLoad = useDebouncedValue(closedSearch, SEARCH_DEBOUNCE_MS)"
    );
    expect(appSource).toContain("search: closedSearchForLoad,");
    // A pontuacao NAO pode passar a usar o valor com espera: o filtro ficaria travando
    // atras do que o operador acabou de digitar.
    expect(appSource).toContain("filterClosedOperationsBySearch(closedOperations, closedSearch)");
  });

  it("alerta as concluidas que nao chegaram ao OMIE e oferece a edicao dos itens", () => {
    expect(appSource).toContain("<PendingOmieAlert");

    const alert = sliceBetween(appSource, "function PendingOmieAlert(", "\nfunction ");
    expect(alert).toContain("nao foi enviada ao OMIE");
    expect(alert).toContain("Editar itens");
    // O motivo vem do mesmo view model da coluna Fiscal OMIE, entao alerta e tabela
    // nunca divergem.
    expect(alert).toContain("getFiscalBillingStatus(operation)");
  });

  it("abre o dialogo de correcao pela operacao com pendencia", () => {
    const dialog = sliceBetween(appSource, "function FixOmieCadastroDialog(", "\nfunction ");

    expect(dialog).toContain(".operationOmieIssue(operationId)");
    expect(dialog).toContain("Salvar e reenviar ao OMIE");
    // Cadastro vindo do OMIE tambem precisa ser corrigivel aqui, senao a operacao
    // trava sem saida dentro do app.
    expect(dialog).toContain("overrideOmieFields: true");
  });
});

describe("avisos do envio ao OMIE", () => {
  it("mostra os avisos no canto superior direito", () => {
    const toasts = sliceBetween(appSource, "function OmieDeliveryToasts(", "\nfunction ");

    expect(toasts).toContain('position: "fixed"');
    expect(toasts).toContain('top: "16px"');
    expect(toasts).toContain('right: "16px"');
  });

  it("toca um som diferente para sucesso e para falha", () => {
    expect(appSource).toContain('playOmieAlertSound("success")');
    expect(appSource).toContain('playOmieAlertSound("error")');
  });
});

describe("tela cloud", () => {
  it("nao tem mais o botao de limpar e re-sincronizar o OMIE", () => {
    expect(appSource).not.toContain("Limpar tudo e Re-sincronizar OMIE");
    expect(appSource).not.toContain("handleResetOmieMaster");
    expect(appSource).not.toContain("omieResetting");
  });

  it("tem o botao de editar item em cada item da fila OMIE", () => {
    const queue = sliceBetween(
      appSource,
      "Fila OMIE (fechamentos a enviar)",
      'activeView === "insights"'
    );

    expect(queue).toContain('label="Editar item"');
    expect(queue).toContain("setOmieIssueOperationId(item.operationId)");
  });
});

describe("tela de clientes", () => {
  it("nao tem mais o e-mail padrao aplicado a todos os clientes", () => {
    expect(customersSource).not.toContain("Aplicar a todos os clientes");
    expect(customersSource).not.toContain("E-mail padrao de NF-e");
    expect(customersSource).not.toContain("applyDefaultNfeEmailToAll");
  });
});
