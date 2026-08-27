import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isFreightModalityWithFreight, resolveFreightModality } from "../services/freight";
import {
  advanceHintText,
  App,
  appendAvailableId,
  applyFreightGroupToEntryForm,
  buildFreightInput,
  carrierSelectorFilterIds,
  carrierToLinkForPickedVehicle,
  customerFreightModalityPatch,
  createCacheSelectOptions,
  formatElapsedSince,
  getDriverFilterIds,
  getFiscalBillingStatus,
  isCarrierRequiredForEntry,
  omieQueueActionLabel,
  omieQueueStatusLabel,
  previousDayIso,
  readStoredThemeMode,
  resolveAutoFilledFreightValueOnInvoice,
  resolveCarrierPrefill,
  shouldLinkCreatedDriverToCarrier
} from "./App";

type WeighingFormForTest = Parameters<typeof buildFreightInput>[0];

function createWeighingForm(overrides: Partial<WeighingFormForTest> = {}): WeighingFormForTest {
  return {
    operationType: "invoice",
    vehicleId: "vehicle-1",
    carrierId: "carrier-1",
    customerId: "customer-1",
    driverId: "driver-1",
    productId: "product-1",
    paymentMethodId: "",
    paymentMethodIsCredit: false,
    paymentTermId: "",
    paymentMode: "registered",
    manualInstallments: "",
    manualDownPaymentEnabled: false,
    manualDownPaymentCents: null,
    quotationId: "",
    deductFreightFromCredit: false,
    settleFromAdvance: false,
    freightModality: "cif",
    chargeFreight: true,
    freightCalculationType: "per_ton",
    freightBaseValueCents: 12_500,
    freightFixedValueCents: null,
    freightDistanceKm: "",
    freightDestination: "",
    ...overrides
  };
}

describe("App", () => {
  it("creates the desktop component tree without requiring Electron", () => {
    const element = <App desktopApi={undefined} />;

    expect(element.type).toBe(App);
  });

  it("does not build freight input when freight is not being charged (FOB)", () => {
    const form = createWeighingForm({
      freightModality: "fob",
      chargeFreight: false
    });

    expect(buildFreightInput(form)).toBeNull();
  });

  it("does not build freight input for the client's own transport", () => {
    const form = createWeighingForm({ freightModality: "own_recipient", chargeFreight: true });

    expect(buildFreightInput(form)).toBeNull();
  });

  it("uses the quarry as the freight payer when charging freight (CIF)", () => {
    const freight = buildFreightInput(createWeighingForm());
    expect(freight?.payer).toBe("quarry");
  });

  it("uses the customer as the freight payer for FOB", () => {
    const freight = buildFreightInput(createWeighingForm({ freightModality: "fob" }));
    expect(freight?.payer).toBe("customer");
  });

  it("links a newly created driver to the selected carrier", () => {
    expect(shouldLinkCreatedDriverToCarrier(createWeighingForm({ carrierId: "carrier-1" }))).toBe(
      "carrier-1"
    );
    expect(shouldLinkCreatedDriverToCarrier(createWeighingForm({ carrierId: "" }))).toBeNull();
  });

  it("switches between the four freight situations from the group plus the checkbox", () => {
    const entry = createWeighingForm({ freightModality: "none" }) as Parameters<
      typeof applyFreightGroupToEntryForm
    >[0];

    // "Com frete" nasce na situacao 1 (valor na nota) e ja abre os campos de valor.
    const withFreight = applyFreightGroupToEntryForm(entry, "with_freight");
    expect(withFreight.freightModality).toBe("fob");
    expect(withFreight.chargeFreight).toBe(true);

    // "Sem frete" nasce na situacao 3 (so o transportador na nota) e zera a cobranca.
    const withoutFreight = applyFreightGroupToEntryForm(withFreight, "without_freight");
    expect(withoutFreight.freightModality).toBe("third_party");
    expect(withoutFreight.chargeFreight).toBe(false);
    expect(withoutFreight.deductFreightFromCredit).toBe(false);
  });

  it("keeps the freight value out of the operation when it stays in the system", () => {
    // Situacao 2: o valor e gravado, mas marcado para nao sair na nota/cupom.
    const freight = buildFreightInput(
      createWeighingForm({
        freightModality: "cif",
        chargeFreight: true,
        freightBaseValueCents: 10_000
      })
    );

    expect(freight?.showOnReceipt).toBe(false);
    expect(freight?.rule.baseValueCents).toBe(10_000);
  });

  it("keeps the operator's coupon choice when the customer freight is auto-filled", () => {
    // O operador desmarcou "o valor do frete aparece na nota e no cupom": o
    // preenchimento automatico do cliente nao pode remarcar a caixa sozinho.
    expect(resolveAutoFilledFreightValueOnInvoice(false, true)).toBe(false);
    expect(resolveAutoFilledFreightValueOnInvoice(true, false)).toBe(true);
    // Sem escolha do operador, vale a memoria do cliente (e "sim" quando ela nao existe).
    expect(resolveAutoFilledFreightValueOnInvoice(null, false)).toBe(false);
    expect(resolveAutoFilledFreightValueOnInvoice(null, true)).toBe(true);
    expect(resolveAutoFilledFreightValueOnInvoice(null, undefined)).toBe(true);
  });

  it("keeps the freight group when the coupon checkbox is toggled", () => {
    // A caixa so troca a situacao DENTRO do grupo; o grupo e o que dispara o
    // preenchimento automatico, entao ele nao pode mudar ao marcar/desmarcar.
    const withFreight = applyFreightGroupToEntryForm(
      createWeighingForm() as Parameters<typeof applyFreightGroupToEntryForm>[0],
      "with_freight"
    );
    expect(withFreight.freightModality).toBe("fob");
    expect(
      isFreightModalityWithFreight(
        resolveFreightModality({ group: "with_freight", valueOnInvoice: false })
      )
    ).toBe(true);

    // "Sem frete": desmarcar o transportador continua no mesmo grupo (situacao 4).
    const withoutFreight = applyFreightGroupToEntryForm(withFreight, "without_freight");
    expect(withoutFreight.freightModality).toBe("third_party");
    expect(
      isFreightModalityWithFreight(
        resolveFreightModality({ group: "without_freight", carrierOnInvoice: false })
      )
    ).toBe(false);
  });

  it("keeps carrier, plate and driver available in any freight type", () => {
    // "Consolidar os transportadores e motoristas em qualquer que for a modalidade do
    // tipo de frete": os campos de transporte nao dependem mais do tipo escolhido.
    expect(
      getDriverFilterIds(createWeighingForm({ freightModality: "none" }), ["driver-1"])
    ).toEqual(["driver-1"]);
  });

  it("so exige transportadora quando ela vai constar na nota", () => {
    // Situacoes 1, 2 e 3: o transportador sai na nota, entao o cadastro e obrigatorio.
    expect(isCarrierRequiredForEntry(createWeighingForm({ freightModality: "fob" }))).toBe(true);
    expect(isCarrierRequiredForEntry(createWeighingForm({ freightModality: "cif" }))).toBe(true);
    expect(isCarrierRequiredForEntry(createWeighingForm({ freightModality: "third_party" }))).toBe(
      true
    );

    // Situacao 4 ("transportador na nota" desmarcado): a nota sai sem transportador,
    // entao a entrada pode ser aberta com o campo vazio.
    expect(isCarrierRequiredForEntry(createWeighingForm({ freightModality: "none" }))).toBe(false);
    // Transporte proprio do cliente (legado) segue dispensado.
    expect(
      isCarrierRequiredForEntry(createWeighingForm({ freightModality: "own_recipient" }))
    ).toBe(false);
  });

  it("restores the last valid theme mode from storage", () => {
    expect(readStoredThemeMode({ getItem: () => "dark" })).toBe("dark");
    expect(readStoredThemeMode({ getItem: () => "light" })).toBe("light");
    expect(readStoredThemeMode({ getItem: () => "invalid" })).toBe("light");
    expect(readStoredThemeMode(null)).toBe("light");
  });

  it("limita a limpeza em lote a ontem, preservando o movimento do dia", () => {
    expect(previousDayIso(new Date(2026, 7, 1, 7, 30))).toBe("2026-07-31");
    // Virada de mes e de ano continuam corretas (data local, sem UTC no meio).
    expect(previousDayIso(new Date(2026, 0, 1, 0, 5))).toBe("2025-12-31");
    expect(previousDayIso(new Date(2026, 2, 1, 23, 59))).toBe("2026-02-28");
  });

  it("formats how long ago the truck entered", () => {
    const now = new Date("2026-07-06T12:00:00Z");
    expect(formatElapsedSince("2026-07-06T11:59:30Z", now)).toBe("agora mesmo");
    expect(formatElapsedSince("2026-07-06T11:48:00Z", now)).toBe("ha 12 min");
    expect(formatElapsedSince("2026-07-06T09:55:00Z", now)).toBe("ha 2 h 05 min");
    expect(formatElapsedSince("2026-07-04T10:00:00Z", now)).toBe("ha 2 d 2 h");
    expect(formatElapsedSince(null, now)).toBe("-");
    expect(formatElapsedSince("not-a-date", now)).toBe("-");
  });

  it("shows a newly created carrier in the customer-filtered list right away", () => {
    // Lista filtrada por vinculo: a recem-criada entra otimisticamente.
    expect(appendAvailableId(["carrier-1"], "carrier-2")).toEqual(["carrier-1", "carrier-2"]);
    // Ja presente (releitura chegou antes): nao duplica.
    expect(appendAvailableId(["carrier-1", "carrier-2"], "carrier-2")).toEqual([
      "carrier-1",
      "carrier-2"
    ]);
    // Sem filtro ativo (nenhum cliente selecionado): continua sem filtro.
    expect(appendAvailableId(undefined, "carrier-2")).toBeUndefined();
  });

  it("falls back to all carriers when the customer has none linked", () => {
    // Cliente com transportadoras vinculadas: restringe a lista a elas.
    expect(carrierSelectorFilterIds(["carrier-1", "carrier-2"])).toEqual([
      "carrier-1",
      "carrier-2"
    ]);
    // Cliente selecionado sem nenhum vinculo: nao filtra, exibe todas as cadastradas.
    expect(carrierSelectorFilterIds([])).toBeUndefined();
    // Nenhum cliente selecionado ainda: continua sem filtro.
    expect(carrierSelectorFilterIds(undefined)).toBeUndefined();
  });

  it("links a plate picked outside the carrier's list instead of hiding it", () => {
    // Bug relatado: o seletor so listava as placas vinculadas a transportadora, entao a
    // placa que ja rodava para outro cliente nao aparecia — e cadastra-la de novo batia
    // no "ja existe um veiculo com esta placa". Agora a lista mostra todas e a escolha
    // cria o vinculo que faltava.
    const form = createWeighingForm();
    expect(carrierToLinkForPickedVehicle(form, "vehicle-9", ["vehicle-1"])).toBe("carrier-1");
    // Ja vinculada: nada a fazer.
    expect(carrierToLinkForPickedVehicle(form, "vehicle-1", ["vehicle-1"])).toBeNull();
    // Sem transportadora na entrada (ou transporte proprio do cliente): nao ha vinculo.
    expect(carrierToLinkForPickedVehicle({ ...form, carrierId: "" }, "vehicle-9", [])).toBeNull();
    expect(
      carrierToLinkForPickedVehicle({ ...form, freightModality: "own_recipient" }, "vehicle-9", [])
    ).toBeNull();
    // Placa limpa: nada a vincular.
    expect(carrierToLinkForPickedVehicle(form, "", undefined)).toBeNull();
  });

  /**
   * Tipo de frete padrao do cadastro (aba Transporte do cliente). E preenchimento inicial,
   * nao trava: o operador troca na tela, e a memoria da ultima venda deste cliente com
   * este produto continua tendo a ultima palavra quando existe.
   */
  it("preenche o tipo de frete com o padrao do cadastro do cliente", () => {
    expect(customerFreightModalityPatch({ defaultFreightModality: "fob" })).toEqual({
      freightModality: "fob",
      chargeFreight: true,
      freightShowOnReceipt: true
    });
    // Sem frete: a caixa de cobrar frete acompanha, senao a entrada nasceria contraditoria.
    expect(customerFreightModalityPatch({ defaultFreightModality: "none" })).toEqual({
      freightModality: "none",
      chargeFreight: false,
      freightShowOnReceipt: false
    });
  });

  it("cliente sem padrao de frete nao mexe no que esta na tela", () => {
    expect(customerFreightModalityPatch(undefined)).toEqual({});
    expect(customerFreightModalityPatch({})).toEqual({});
    expect(customerFreightModalityPatch({ defaultFreightModality: null })).toEqual({});
    // Valor que a tela nao sabe desenhar vale como "sem padrao".
    expect(customerFreightModalityPatch({ defaultFreightModality: "qualquer-coisa" })).toEqual({});
  });

  it("prefers the carrier linked to the customer over the registered default", () => {
    // Bug relatado: a transportadora "<cliente> (padrão)" criada junto com o cadastro
    // vinha no campo e escondia a transportadora que o usuario vinculou de fato.
    expect(resolveCarrierPrefill("carrier-default", ["carrier-linked"])).toBe("carrier-linked");
    // A selecao atual esta entre os vinculos: mantem (inclusive escolha manual do operador).
    expect(resolveCarrierPrefill("carrier-b", ["carrier-a", "carrier-b"])).toBe("carrier-b");
    // Varios vinculos e o padrao entre eles: o padrao continua valendo.
    expect(resolveCarrierPrefill("carrier-a", ["carrier-a", "carrier-b"])).toBe("carrier-a");
    // Varios vinculos e o padrao fora deles: limpa para o operador escolher na lista.
    expect(resolveCarrierPrefill("carrier-default", ["carrier-a", "carrier-b"])).toBe("");
    // Cliente sem vinculos: o seletor mostra todas, entao o padrao e mantido.
    expect(resolveCarrierPrefill("carrier-default", [])).toBe("carrier-default");
  });

  it("labels OMIE queue items in plain portuguese for the cloud screen", () => {
    expect(omieQueueActionLabel("create_order", "invoice")).toBe("Criar pedido (com nota)");
    expect(omieQueueActionLabel("create_order", "internal")).toBe("Criar OS (interno)");
    expect(omieQueueActionLabel("create_and_bill_order", "invoice")).toBe("Criar e faturar pedido");
    expect(omieQueueActionLabel("cancel_order", null)).toBe("Cancelar pedido no OMIE");
    expect(omieQueueStatusLabel("pending")).toBe("aguardando envio");
    expect(omieQueueStatusLabel("failed")).toBe("falhou (re-tenta sozinho)");
    expect(omieQueueStatusLabel("dead_letter")).toBe("parado apos varias falhas");
  });

  it("shows the OMIE service order state of an internal operation", () => {
    // Antes toda operacao interna aparecia como "Sem nota fiscal de venda": uma OS que
    // nunca chegou ao OMIE ficava indistinguivel de uma que chegou.
    expect(
      getFiscalBillingStatus(createInternalOperationForTest({ omieServiceOrderId: 777 }))
    ).toMatchObject({ label: "OS enviada", tone: "success" });

    expect(getFiscalBillingStatus(createInternalOperationForTest({}))).toMatchObject({
      label: "Enviando OS",
      tone: "neutral"
    });

    expect(
      getFiscalBillingStatus(
        createInternalOperationForTest({
          omieBillingStatus: "service_order_failed",
          omieBillingMessage: "ERROR: - tag: [cCodServMun]"
        })
      )
    ).toMatchObject({ label: "OS falhou", tone: "danger", detail: "ERROR: - tag: [cCodServMun]" });

    expect(
      getFiscalBillingStatus(
        createInternalOperationForTest({ omieBillingStatus: "cadastro_incompleto" })
      )
    ).toMatchObject({ label: "Cadastro incompleto", tone: "warning" });
  });

  it("shows why an operation on its way to OMIE has not arrived yet", () => {
    // Sem isto, um pedido recusado pelo OMIE repetia "sera enviado na proxima
    // sincronizacao" para sempre e o operador nao tinha como saber o motivo.
    const refused = getFiscalBillingStatus(
      createInternalOperationForTest({
        operationType: "invoice",
        omieBillingMessage: "ERROR: Consumo redundante detectado"
      })
    );
    expect(refused.label).toBe("Enviando ao OMIE");
    expect(refused.detail).toContain("Consumo redundante");
    // Enquanto ha tentativa automatica sobrando o tom continua neutro: o vermelho (e o
    // alerta do topo da tela) fica para quando o envio realmente para.
    expect(refused.tone).toBe("neutral");
    expect(refused.canRetry).toBe(false);

    expect(
      getFiscalBillingStatus(
        createInternalOperationForTest({ omieBillingMessage: "Cliente cadastrado no OMIE." })
      ).detail
    ).toContain("Cliente cadastrado no OMIE.");

    // Sem mensagem nenhuma o texto generico continua valendo.
    expect(getFiscalBillingStatus(createInternalOperationForTest({})).detail).toBe(
      "Ordem de servico sera enviada ao OMIE na proxima sincronizacao."
    );
  });

  it("builds cache select modal options", () => {
    const options = createCacheSelectOptions([
      { id: "customer-1", tradeName: "Cliente A" },
      { id: "vehicle-1", plate: "ABC1D23" },
      { omieCode: "term-1", name: "A prazo" },
      // Nome fantasia em branco (nao nulo) vindo do OMIE: cai para a razao social em vez
      // de virar uma opcao sem rotulo, que o operador nao conseguia enxergar na lista.
      { id: "customer-2", tradeName: "", legalName: "Levisa Mineracao Ltda" }
    ]);

    expect(options.map((option) => option.label)).toEqual([
      "Cliente A",
      "ABC1D23",
      "A prazo",
      "Levisa Mineracao Ltda"
    ]);
  });

  it("diz ao operador de quanto e o adiantamento antes de ele marcar a caixa", () => {
    expect(advanceHintText("", null)).toContain("Escolha o cliente");
    expect(advanceHintText("customer-1", null)).toContain("Consultando");
    // Saldo zero pode ser so atraso do espelho: a frase precisa dizer que a pesagem
    // confere no OMIE, senao o operador deixa de marcar a caixa e a venda inteira cai
    // na carteira de quem ja tinha pago.
    const semSaldo = advanceHintText("customer-1", 0);
    expect(semSaldo).toContain("Nenhum adiantamento espelhado");
    expect(semSaldo).toContain("conferido no OMIE ao capturar o peso");
    const comSaldo = advanceHintText("customer-1", 78_000);
    // Intl separa "R$" do numero com espaco nao-quebravel: a asserçao olha o valor.
    expect(comSaldo).toContain("780,00");
    // A regra do excedente precisa estar na tela: e a duvida que a caixa levanta.
    expect(comSaldo).toContain("continua em carteira");
  });

  it("mantem na tela de entrada a caixa de abater do adiantamento e o saldo do cliente", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "App.tsx"),
      "utf8"
    );

    // A caixa so aparece na venda em carteira, e sempre acompanhada do saldo.
    expect(source).toContain("Abater do adiantamento do cliente");
    expect(source).toContain("advanceHintText(form.customerId, customerAdvanceCents)");
    expect(source).toContain("settleFromAdvance: form.settleFromAdvance");
    // O frete minimo saiu do sistema: nao pode voltar por copiar/colar de formulario.
    expect(source).not.toContain("Frete minimo");
  });
});

function createInternalOperationForTest(
  overrides: Partial<Parameters<typeof getFiscalBillingStatus>[0]>
): Parameters<typeof getFiscalBillingStatus>[0] {
  return {
    id: "operation-1",
    status: "closed_local",
    operationType: "internal",
    customerId: "customer-1",
    customerName: "Cliente Teste",
    plate: "ABC1D23",
    driverName: "Motorista Teste",
    productDescription: "Brita 1",
    paymentTermName: null,
    entryWeightKg: 12_000,
    exitWeightKg: 18_500,
    netWeightKg: 6_500,
    unitPriceCents: 10_000,
    baseUnitPriceCents: null,
    appliedPriceTableId: null,
    appliedPriceTableName: null,
    appliedPriceTableItemId: null,
    priceUnit: "ton",
    priceSavingsPercent: null,
    productTotalCents: 65_000,
    freightTotalCents: 0,
    freightJson: null,
    freightModality: "none",
    totalCents: 65_000,
    deductFreightFromCredit: false,
    productCreditDebitCents: 0,
    freightCreditDebitCents: 0,
    settleFromAdvance: false,
    advanceAppliedCents: 0,
    quotationId: null,
    omieSalesOrderId: null,
    omieServiceOrderId: null,
    omieBillingStatus: null,
    omieBillingMessage: null,
    omieBilledAt: null,
    omieDocumentUrl: null,
    cancelReason: null,
    createdAt: "2026-07-07T10:00:00.000Z",
    updatedAt: "2026-07-07T11:00:00.000Z",
    deviceId: null,
    deviceName: null,
    deviceColor: null,
    ...overrides
  };
}
