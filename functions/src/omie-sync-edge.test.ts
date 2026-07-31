import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourcePath = resolve(process.cwd(), "supabase/functions/omie-sync/index.ts");
const corePath = resolve(process.cwd(), "supabase/functions/omie-sync/omie-sync-core.ts");

function getOmieSyncSource(): string {
  return `${readFileSync(sourcePath, "utf8")}\n${readFileSync(corePath, "utf8")}`;
}

function getPullReferenceDataBlock(): string {
  const source = readFileSync(sourcePath, "utf8");
  const start = source.indexOf('if (action === "pull_reference_data") {');
  const end = source.indexOf('if (action === "create_order") {', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe("omie-sync Edge Function", () => {
  it("pull_reference_data fetches products and payment terms from OMIE", () => {
    const block = getPullReferenceDataBlock();
    const source = getOmieSyncSource();

    expect(source).toContain("listProductsPage(credentials, productsPage)");
    expect(source).toContain("listOptionalPaymentTermsPage(credentials, paymentTermsPage)");
    expect(block).not.toContain("const productsResult = emptyPage<OmieProduct>(1)");
    expect(block).not.toContain("const paymentTermsResult = emptyPage<OmiePaymentTerm>(1)");
  });

  it("does not abort pull_reference_data when payment terms endpoint is unavailable", () => {
    const source = getOmieSyncSource();

    expect(source).toContain("function isPaymentTermsUnavailableError");
    expect(source).toContain("return emptyPage<OmiePaymentTerm>(page)");
  });

  it("classifica cliente e transportadora pela regra compartilhada", () => {
    // A regra estrita anterior (so entrava quem tinha a tag "cliente")
    // descartava em silencio a maior parte do cadastro de uma pedreira que nao
    // usa tags no OMIE. A regra agora vive em _shared, com testes proprios.
    const source = getOmieSyncSource();

    expect(source).toContain(
      'import { classifyOmieCustomer } from "../_shared/omie-customer-classification.ts";'
    );
    // O tipo do OMIE (`cliente_fornecedor`) entra junto das tags: e o campo que
    // classifica o cadastro em quem nao usa tags.
    expect(source).toContain(
      "classifyOmieCustomer(customer.tagsJson, customer.customerType).isCustomer"
    );
    expect(source).toContain(
      "classifyOmieCustomer(customer.tagsJson, customer.customerType).isCarrier"
    );
    expect(source).toContain("items.filter(isOmieCustomer)");
    expect(source).toContain("items.filter(isOmieCarrier).map(mapCustomerToCarrier)");
  });

  it("uses a resilient queue manager with throttling and backoff for OMIE calls", () => {
    const source = getOmieSyncSource();

    expect(source).toContain("class OmieQueueManager");
    expect(source).toContain("isOmieLimitError");
    expect(source).toContain("error.status === 429");
    expect(source).toContain("await this.sleepFn(retryDelayMs)");
    expect(source).toContain("Math.pow(2, attempt)");
  });

  it("supports a paginated pull/push sync action", () => {
    const source = getOmieSyncSource();

    expect(source).toContain('if (action === "sync") {');
    expect(source).toContain("pullReferenceDataPage(credentials, resume)");
    expect(source).toContain("pushLocalQueuePage(credentials, body.payload as SyncPayload)");
    expect(source).toContain("takePushPage(payload.customers)");
    expect(source).toContain("takePushPage(payload.carriers)");
    expect(source).toContain("takePushPage(payload.orders).sort(comparePushOrdersChronologically)");
  });

  it("forces the transportadora tag when pushing carriers", () => {
    const source = getOmieSyncSource();

    expect(source).toContain("function pushCarrierToOmie");
    expect(source).toContain('forceOmieTag(payload.tags, "transportadora")');
    expect(source).toContain("buildCarrierPayload(payload)");
  });

  it("uses the account selected on desktop before falling back to the first tenant account", () => {
    const source = getOmieSyncSource();

    // Payload carrega o meio e a conta escolhidos na operacao do desktop.
    expect(source).toContain("paymentMethodOmieCode?: string;");
    expect(source).toContain("accountOmieCode?: string | number;");
    // A conta selecionada tem precedencia; sem ela, resolve pelo nome (do desktop ou
    // padrao do meio de pagamento) e, por ultimo, o fallback historico da primeira conta.
    expect(source).toContain(
      "const selectedAccountCode = toNumber(payload.accountOmieCode ?? null);"
    );
    expect(source).toContain("? selectedAccountCode");
    expect(source).toContain("resolveOmieAccountCodeByName(credentials, payload.accountName)");
    expect(source).toContain("(await resolveOmieAccountCode(credentials))");
  });

  it("creates orders at the 'Faturar' stage so billing happens inside OMIE", () => {
    const source = getOmieSyncSource();

    // Pedido de venda e OS nascem na etapa 50 (coluna "Faturar" do kanban).
    expect(source).toContain('etapa: "50"');
    expect(source).toContain('cEtapa: "50"');
    expect(source).not.toContain('etapa: "10"');
    expect(source).not.toContain('cEtapa: "10"');
  });

  it("sends installments + payment method inline via lista_parcelas (codigo_parcela 999)", () => {
    const source = getOmieSyncSource();

    // Pedido de venda leva o parcelamento informado e o meio de pagamento por parcela.
    expect(source).toContain("function buildOrderParcelamento");
    expect(source).toContain('codigo_parcela: "999"');
    // "qtde_parcelas" e o nome aceito pelo OMIE no cabecalho; "quantidade_parcelas"
    // e rejeitado ("Tag [QUANTIDADE_PARCELAS] nao faz parte da estrutura ... [cabecalho]").
    expect(source).toContain("qtde_parcelas: count");
    expect(source).not.toContain("quantidade_parcelas: count");
    expect(source).toContain("lista_parcelas: parcelamento.listaParcelas");
    expect(source).toContain("meio_pagamento: meio");
    // Os vencimentos saem do plano de parcelas compartilhado com a OS.
    expect(source).toContain("function buildInstallmentPlan");
    expect(source).toContain("dueDate: addDaysToIsoDate(payload.issueDate, dueInDays)");
    expect(source).toContain("data_vencimento: toOmieDate(item.dueDate)");
  });

  it("sends the typed installments inline in the service order (Parcelas block)", () => {
    const source = getOmieSyncSource();

    // A OS leva o parcelamento INFORMADO: cCodParc "999" + bloco Parcelas com os
    // vencimentos digitados, o mesmo plano usado no pedido de venda. Sem isso a OS
    // dependia do cadastro de parcelas do OMIE e caia em "000" (a vista).
    expect(source).toContain("installmentDays?: number[];");
    expect(source).toContain("function buildServiceOrderParcelas");
    expect(source).toContain(
      "linkedParcelaCode === null || isBoletoPaymentMethod(payload.paymentMethodOmieCode)"
    );
    expect(source).toContain("? buildServiceOrderParcelas(payload)");
    expect(source).toContain("dDtVenc: toOmieDate(item.dueDate)");
    expect(source).toContain("nParcela: item.number");
    expect(source).toContain("nDias: item.dueInDays");
    expect(source).toContain("{ Parcelas: parcelas }");
    expect(source).toContain('osParcelas !== null ? "999"');
    expect(source).toContain("nQtdeParc: parcelas !== null ? parcelas.length : installmentCount");
  });

  it("liga o gerar boleto do OMIE quando a forma de pagamento e boleto", () => {
    const source = getOmieSyncSource();

    // O campo do OMIE e NEGATIVO e ASSIMETRICO: "S" NAO gera o boleto, e o padrao ja e
    // "N" — ou seja, o "N" nao LIGA nada, so deixa de suprimir. Boleto ("15") -> "N";
    // qualquer outro meio conhecido -> "S" (e este "S" que faz o boleto seguir a forma
    // escolhida); sem meio (fiado/desktop antigo) -> nada, vale o padrao do OMIE.
    expect(source).toContain('const OMIE_BOLETO_PAYMENT_METHOD_CODE = "15";');
    expect(source).toContain('const OMIE_BOLETO_DOCUMENT_TYPE = "BOL";');
    expect(source).toContain("function boletoGenerationFlag");
    expect(source).toContain('return meio === OMIE_BOLETO_PAYMENT_METHOD_CODE ? "N" : "S";');
    expect(source).toContain("function buildBoletoParcelaFields");
    expect(source).toContain("nao_gerar_boleto: naoGerarBoleto");
    expect(source).toContain("{ tipo_documento: OMIE_BOLETO_DOCUMENT_TYPE }");
    // O mesmo flag vai no pedido de venda (cabecalho + lista_parcelas) e na OS (Parcelas).
    expect(source).toContain("const boletoFields = buildBoletoParcelaFields(meio)");
    expect(source).toContain(
      "const boletoFields = buildBoletoParcelaFields(payload.paymentMethodOmieCode)"
    );
    expect(source).toContain("...cabecalhoBoleto");
    expect(source).toContain("...boletoFields");
  });

  it("liga o gerar boletos no cadastro do cliente antes do pedido em boleto", () => {
    const source = getOmieSyncSource();

    // Quem LIGA o boleto e a recomendacao do cadastro do cliente ("Por padrao: Gerar
    // Boletos ao Emitir NF-e" -> recomendacoes.gerar_boletos). O pedido so consegue
    // suprimir, entao sem este passo a parcela nascia "Gerar Boleto: Nao".
    expect(source).toContain("async function ensureCustomerGeneratesBoleto");
    expect(source).toContain('"/geral/clientes/", "ConsultarCliente"');
    expect(source).toContain('recomendacoes: { ...recomendacoes, gerar_boletos: "S" }');
    // So em boleto: ligar a recomendacao em todo cliente mudaria a cobranca de quem
    // nunca usa boleto.
    expect(source).toContain(
      "if (isBoletoPaymentMethod(payload.paymentMethodOmieCode)) {\n    await ensureCustomerGeneratesBoleto(credentials, customerOmieId);"
    );
    // Ja ligado -> nao gasta uma chamada de alteracao no caminho quente do fechamento.
    expect(source).toContain("if (isYesFlag(recomendacoes.gerar_boletos)) return;");
  });

  it("manda a venda em carteira como '99 - outros', sem boleto e pela OMIE Cash", () => {
    const source = getOmieSyncSource();

    // "Em carteira" e a venda que fecha sem forma de recebimento definida: ela sai com o
    // meio "99" (outros), que cai no ramo generico do boletoGenerationFlag ("S", sem
    // boleto) — a cobranca so nasce no fechamento da carteira, no desktop. A conta
    // acompanha o seed local do meio (payment_methods.account_id -> OMIE Cash).
    expect(source).toContain('["99", "omiecash"]');
    expect(source).toContain("function defaultAccountNameForMethod");
  });

  it("falls back to the OMIE parcelas cadastro when the OS structure is rejected", () => {
    const source = getOmieSyncSource();

    // Se o OMIE recusar o formato do parcelamento informado, a OS ainda nasce pelo
    // caminho historico (codigo vinculado -> cadastro -> "000") em vez de falhar.
    expect(source).toContain("function isOmieStructureRejection");
    expect(source).toContain("osParcelas !== null && isOmieStructureRejection(error)");
    expect(source).toContain("async function ensureOmieParcelaCode");
    expect(source).toContain('"IncluirParcela"');
    expect(source).toContain("await ensureOmieParcelaCode(credentials, payload)");
    expect(source).toContain(
      "const linkedParcelaCode = normalizeParcelaCode(payload.paymentTermOmieCode);"
    );
    expect(source).toContain('"000";');
  });
});
