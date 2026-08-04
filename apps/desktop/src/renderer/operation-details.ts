import {
  freightValueGoesToInvoice,
  getFreightModalityInfo,
  isFreightModalityWithFreight,
  normalizeFreightModality,
  resolveFreightModality
} from "../services/freight";
import type { FreightGroup, FreightModality, FreightRule } from "../services/freight";
import type {
  OperationFreightInput,
  OperationType,
  WeighingOperationSummary
} from "../services/weighing-operations";
import { formatDbDateTime } from "./format-datetime";

/**
 * Visualizacao e edicao completas de uma operacao (duplo clique na lista de Operacoes).
 *
 * Este modulo e puro de proposito: monta as secoes do modal de detalhes e converte a
 * operacao gravada <-> estado do formulario de edicao sem tocar em React nem no IPC,
 * para o comportamento ficar coberto por teste sem montar a tela inteira.
 */

export const OPERATION_STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  entry_registered: "Entrada registrada",
  loading_requested: "Aguardando carregamento",
  awaiting_exit: "Aguardando saida",
  closed_local: "Concluida (local)",
  pending_cloud: "Concluida - enviando para a nuvem",
  pending_omie: "Concluida - enviando ao OMIE",
  synced: "Concluida e sincronizada",
  sync_error: "Concluida - erro de sincronizacao",
  cancelled: "Cancelada"
};

const FREIGHT_PAYER_LABELS: Record<string, string> = {
  customer: "Cliente",
  quarry: "Pedreira",
  third_party: "Terceiros"
};

const FREIGHT_CALCULATION_LABELS: Record<string, string> = {
  per_ton: "Por tonelada",
  per_ton_km: "Tonelada-km",
  fixed_plus_ton: "Fixo + tonelada",
  distance_range: "Faixa de distancia"
};

export function operationStatusLabel(status: string): string {
  return OPERATION_STATUS_LABELS[status] ?? status;
}

/**
 * Espelho de `OPEN_OPERATION_STATUSES` (weighing-operations) para o renderer: a operacao
 * ainda esta em andamento e pode ser editada. E duplicado de proposito — o servico roda no
 * processo main e importa `node:crypto`, entao o renderer nao pode importar valores dele.
 */
const IN_PROGRESS_STATUSES: readonly string[] = [
  "draft",
  "entry_registered",
  "loading_requested",
  "awaiting_exit"
];

export function isOperationInProgress(status: string): boolean {
  return IN_PROGRESS_STATUSES.includes(status);
}

export function formatCents(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

export function formatKg(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg`;
}

export interface OperationFreight {
  payer: string;
  rule: FreightRule;
  destination: string | null;
  /** O valor do frete sai no cupom. Ausente nas operacoes antigas: vale `true`. */
  showOnReceipt: boolean;
}

/** Regra de frete gravada na operacao; null quando nao ha valor lancado ou o JSON e invalido. */
export function parseOperationFreight(freightJson: string | null): OperationFreight | null {
  if (!freightJson) return null;
  try {
    const parsed = JSON.parse(freightJson) as Partial<OperationFreight>;
    if (!parsed?.rule) return null;
    return {
      payer: parsed.payer ?? "quarry",
      rule: parsed.rule,
      destination: parsed.destination ?? null,
      showOnReceipt: parsed.showOnReceipt !== false
    };
  } catch {
    return null;
  }
}

export interface OperationDetailItem {
  label: string;
  value: string;
}

export interface OperationDetailSection {
  title: string;
  items: OperationDetailItem[];
  fullWidth?: boolean;
}

/**
 * Todas as informacoes da operacao agrupadas por secao — o que o duplo clique abre.
 * Campos vazios continuam na lista (viram "—") para o operador ver que existem.
 */
export function buildOperationDetailSections(
  operation: WeighingOperationSummary
): OperationDetailSection[] {
  const freight = parseOperationFreight(operation.freightJson);
  const modality = getFreightModalityInfo(operation.freightModality);

  const sections: OperationDetailSection[] = [
    {
      title: "Operacao",
      items: [
        { label: "Placa", value: operation.plate || "—" },
        { label: "Status", value: operationStatusLabel(operation.status) },
        {
          label: "Tipo",
          value: operation.operationType === "invoice" ? "Com nota fiscal" : "Interna (sem nota)"
        },
        { label: "Cliente", value: operation.customerName || "—" },
        { label: "Produto", value: operation.productDescription || "—" },
        { label: "Motorista", value: operation.driverName || "—" },
        { label: "Transportadora", value: operation.carrierName || "—" },
        { label: "Computador", value: operation.deviceName || "—" }
      ]
    },
    {
      title: "Pesagem",
      items: [
        { label: "Peso de entrada", value: formatKg(operation.entryWeightKg) },
        { label: "Peso de saida", value: formatKg(operation.exitWeightKg) },
        { label: "Peso liquido", value: formatKg(operation.netWeightKg) },
        { label: "Entrada em", value: formatDbDateTime(operation.createdAt) },
        { label: "Ultima atualizacao", value: formatDbDateTime(operation.updatedAt) },
        {
          label: "Carga concluida pelo carregador",
          value: operation.loaderCompletedAt ? formatDbDateTime(operation.loaderCompletedAt) : "—"
        }
      ]
    },
    {
      title: "Precos e totais",
      items: [
        { label: "Preco aplicado", value: `${formatCents(operation.unitPriceCents)}/ton` },
        { label: "Preco base", value: `${formatCents(operation.baseUnitPriceCents)}/ton` },
        {
          label: "Desconto",
          value:
            operation.priceSavingsPercent === null
              ? "—"
              : `${operation.priceSavingsPercent.toLocaleString("pt-BR")}%`
        },
        { label: "Tabela de preco", value: operation.appliedPriceTableName || "—" },
        { label: "Total do produto", value: formatCents(operation.productTotalCents) },
        { label: "Total do frete", value: formatCents(operation.freightTotalCents) },
        { label: "Total da operacao", value: formatCents(operation.totalCents) }
      ]
    },
    {
      title: "Pagamento",
      items: [
        { label: "Forma de pagamento", value: operation.paymentMethodName || "—" },
        { label: "Condicao", value: operation.paymentTermName || "A vista" },
        {
          label: "Abate frete do credito",
          value: operation.deductFreightFromCredit ? "Sim" : "Nao"
        },
        {
          label: "Credito debitado (produto)",
          value: formatCents(operation.productCreditDebitCents)
        },
        { label: "Credito debitado (frete)", value: formatCents(operation.freightCreditDebitCents) }
      ]
    },
    {
      title: "Frete",
      items: [
        {
          label: "Tipo de frete",
          value: `${modality.group === "with_freight" ? "Com frete" : "Sem frete"} — ${modality.label}`
        },
        { label: "Valor lancado", value: freight ? "Sim" : "Nao" },
        {
          label: "Valor na nota e no cupom",
          value: freight ? (modality.valueOnInvoice ? "Sim" : "Nao (so no sistema)") : "—"
        },
        { label: "Transportador na nota", value: modality.carrierOnInvoice ? "Sim" : "Nao" },
        {
          label: "Responsavel",
          value: freight ? (FREIGHT_PAYER_LABELS[freight.payer] ?? freight.payer) : "—"
        },
        {
          label: "Calculo",
          value: freight
            ? (FREIGHT_CALCULATION_LABELS[freight.rule.type] ?? freight.rule.type)
            : "—"
        },
        { label: "Valor base", value: freight ? formatCents(freight.rule.baseValueCents) : "—" },
        {
          label: "Valor fixo",
          value: freight?.rule.fixedValueCents ? formatCents(freight.rule.fixedValueCents) : "—"
        },
        {
          label: "Frete minimo",
          value: freight?.rule.minValueCents ? formatCents(freight.rule.minValueCents) : "—"
        },
        {
          label: "Distancia",
          value: freight?.rule.distanceKm ? `${freight.rule.distanceKm} km` : "—"
        },
        { label: "Destino/obs.", value: freight?.destination || "—" }
      ]
    },
    {
      title: "OMIE e sincronizacao",
      fullWidth: true,
      items: [
        {
          label: "Pedido de venda",
          value: operation.omieSalesOrderId ? String(operation.omieSalesOrderId) : "—"
        },
        {
          label: "Ordem de servico",
          value: operation.omieServiceOrderId ? String(operation.omieServiceOrderId) : "—"
        },
        { label: "Status do faturamento", value: operation.omieBillingStatus || "—" },
        {
          label: "Faturada em",
          value: operation.omieBilledAt ? formatDbDateTime(operation.omieBilledAt) : "—"
        },
        { label: "Documento", value: operation.omieDocumentUrl || "—" },
        { label: "Mensagem", value: operation.omieBillingMessage || "—" },
        { label: "Motivo do cancelamento", value: operation.cancelReason || "—" },
        { label: "Id da operacao", value: operation.id }
      ]
    }
  ];

  return sections;
}

export type FreightCalculationType = "per_ton" | "per_ton_km" | "fixed_plus_ton";

export interface OperationEditFormState {
  operationType: OperationType;
  customerId: string;
  productId: string;
  vehicleId: string;
  driverId: string;
  carrierId: string;
  paymentMethodId: string;
  /** Condicao digitada ("5", "7/14/21"); vazio = a vista. */
  conditionText: string;
  unitPriceCents: number | null;
  freightModality: FreightModality;
  chargeFreight: boolean;
  freightCalculationType: FreightCalculationType;
  freightBaseValueCents: number | null;
  freightFixedValueCents: number | null;
  freightMinValueCents: number | null;
  freightDistanceKm: string;
  freightDestination: string;
  /** Caixa "mostrar o valor do frete no cupom". */
  freightShowOnReceipt: boolean;
  deductFreightFromCredit: boolean;
}

function editableCalculationType(type: string | undefined): FreightCalculationType {
  return type === "per_ton_km" || type === "fixed_plus_ton" ? type : "per_ton";
}

/** Estado inicial do formulario de edicao a partir da operacao gravada. */
export function buildOperationEditForm(
  operation: WeighingOperationSummary,
  conditionText = ""
): OperationEditFormState {
  const freight = parseOperationFreight(operation.freightJson);
  return {
    operationType: operation.operationType,
    customerId: operation.customerId ?? "",
    productId: operation.productId ?? "",
    vehicleId: operation.vehicleId ?? "",
    driverId: operation.driverId ?? "",
    carrierId: operation.carrierId ?? "",
    paymentMethodId: operation.paymentMethodId ?? "",
    conditionText,
    unitPriceCents: operation.unitPriceCents,
    freightModality: operation.freightModality,
    chargeFreight: freight !== null,
    freightCalculationType: editableCalculationType(freight?.rule.type),
    freightBaseValueCents: freight?.rule.baseValueCents ?? null,
    freightFixedValueCents: freight?.rule.fixedValueCents ?? null,
    freightMinValueCents: freight?.rule.minValueCents ?? null,
    freightDistanceKm: freight?.rule.distanceKm ? String(freight.rule.distanceKm) : "",
    freightDestination: freight?.destination ?? "",
    freightShowOnReceipt: freight?.showOnReceipt !== false,
    deductFreightFromCredit: operation.deductFreightFromCredit
  };
}

/**
 * Troca do grupo do tipo de frete na edicao da operacao. Preserva a caixa de "valor na
 * nota" / "transportador na nota" que o grupo ja usava, para uma correcao de tipo nao
 * mudar em silencio o que sai na nota.
 */
export function applyFreightGroupToOperationForm(
  form: OperationEditFormState,
  group: FreightGroup
): OperationEditFormState {
  const withFreight = group === "with_freight";
  const current = getFreightModalityInfo(form.freightModality);
  const freightModality = resolveFreightModality(
    withFreight
      ? { group, valueOnInvoice: current.valueOnInvoice || current.group !== group }
      : { group, carrierOnInvoice: current.carrierOnInvoice }
  );
  return {
    ...form,
    freightModality,
    chargeFreight: withFreight,
    deductFreightFromCredit: withFreight ? form.deductFreightFromCredit : false
  };
}

/** A operacao tem valor de frete lancado (modalidade cobravel + toggle ligado). */
export function isOperationFreightCharged(
  form: Pick<OperationEditFormState, "freightModality" | "chargeFreight">
): boolean {
  return isFreightModalityWithFreight(form.freightModality) && form.chargeFreight;
}

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Regra de frete a gravar; null quando a operacao fica sem valor de frete. */
export function buildOperationFreightInput(
  form: OperationEditFormState
): OperationFreightInput | null {
  if (!isOperationFreightCharged(form)) return null;
  const distanceKm = parsePositiveNumber(form.freightDistanceKm);
  return {
    payer: getFreightModalityInfo(form.freightModality).defaultPayer,
    destination: form.freightDestination.trim() || null,
    // A situacao do frete manda: o espelho no formulario existe so para a tela.
    showOnReceipt: freightValueGoesToInvoice(form.freightModality),
    rule: {
      id: "operation-freight",
      name: "Frete da operacao",
      type: form.freightCalculationType,
      baseValueCents: form.freightBaseValueCents ?? 0,
      fixedValueCents: form.freightFixedValueCents ?? undefined,
      minValueCents: form.freightMinValueCents ?? undefined,
      distanceKm: distanceKm ?? undefined,
      unit: "ton"
    }
  };
}

export function validateOperationEditForm(form: OperationEditFormState): string | null {
  if (!form.customerId) return "Selecione o cliente.";
  if (!form.productId) return "Selecione o produto.";
  if (!form.vehicleId) return "Selecione a placa.";
  if (!form.driverId) return "Selecione o motorista.";
  if (form.unitPriceCents === null) return "Informe o preco do produto.";
  if (form.unitPriceCents < 0) return "Preco do produto invalido.";
  if (isOperationFreightCharged(form)) {
    if (form.freightBaseValueCents === null && form.freightFixedValueCents === null) {
      return "Informe o valor do frete.";
    }
    if (
      form.freightCalculationType === "per_ton_km" &&
      parsePositiveNumber(form.freightDistanceKm) === null
    ) {
      return "Informe a distancia do frete em km.";
    }
  }
  return null;
}

export interface OperationUpdateInput {
  operationId: string;
  customerId: string;
  productId: string;
  vehicleId: string;
  driverId: string;
  carrierId: string | null;
  paymentMethodId: string | null;
  paymentTermId?: string | null;
  operationType: OperationType;
  unitPriceCents: number;
  freight: OperationFreightInput | null;
  freightModality: FreightModality;
  deductFreightFromCredit: boolean;
}

/**
 * Payload da edicao. `paymentTermId` so entra quando a condicao mudou — resolver a
 * condicao digitada cria/reusa um `payment_term`, e fazer isso a cada gravacao encheria
 * o cadastro de duplicatas do mesmo texto.
 */
export function buildOperationUpdateInput(
  operationId: string,
  form: OperationEditFormState,
  paymentTermId?: string | null
): OperationUpdateInput {
  return {
    operationId,
    customerId: form.customerId,
    productId: form.productId,
    vehicleId: form.vehicleId,
    driverId: form.driverId,
    carrierId: form.carrierId || null,
    paymentMethodId: form.paymentMethodId || null,
    ...(paymentTermId !== undefined ? { paymentTermId } : {}),
    operationType: form.operationType,
    unitPriceCents: form.unitPriceCents ?? 0,
    freight: buildOperationFreightInput(form),
    // A operacao passa a gravar so os dois tipos de hoje: reabrir e salvar uma operacao
    // antiga normaliza a modalidade legada para "com frete"/"sem frete".
    freightModality: normalizeFreightModality(form.freightModality),
    deductFreightFromCredit: form.deductFreightFromCredit
  };
}
