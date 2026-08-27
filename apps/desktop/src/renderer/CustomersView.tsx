import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, Search, Unlock } from "lucide-react";

import {
  formatMoneyInput,
  invalidEmailsInList,
  isValidDocument,
  normalizeDocument,
  normalizeEmailList,
  normalizePhone,
  parseMoneyInputToCents
} from "@kyberrock/shared";

import type { KyberRockDesktopApi } from "../preload/api-types";
import type { CustomerTransport as CustomerTransportView } from "../services/customer-transport";
import { readAllCacheRows } from "./cache-rows";
import { OptionSearchPicker } from "./OptionSearchPicker";
import { useDebouncedValue } from "./use-debounced-value";
import { FREIGHT_MODALITIES, getFreightModalityInfo } from "../services/freight";
import type { FreightModality } from "../services/freight";
import type { CustomerFreightRule as CustomerFreightRuleView } from "../services/customer-freight-rules";
import type { CustomerFutureBillingInvoice } from "../services/customer-future-billing";
import type { DeletedCustomerSummary } from "../services/customers";
import {
  CepInput,
  DocumentInput,
  EmailListInput,
  Field,
  MoneyInput,
  NumberInput,
  PhoneInput,
  TextInput,
  getInputStyle
} from "./inputs";
import type { CepLookupResult } from "./inputs";
import type { CustomerCacheEntry, CustomerFormData } from "./customers.types";
import type { CreditMovementRow, CustomerCreditSummary } from "../services/credit";
import { CrudFormModal } from "./CrudFormModal";
import { Tooltip } from "./Tooltip";
import { extractConditionRaw, resolveConditionTermId } from "./payment-condition-helpers";
import { PaymentConditionLegend } from "./PaymentConditionLegend";
import { tryParsePaymentCondition } from "../services/payment-condition-parser";
import {
  CellMuted,
  CellPrimary,
  ConfirmDialog,
  CrudSearchBar,
  CrudSectionHeader,
  DataTable,
  DeleteRowButton,
  EditRowButton,
  FlashBanner,
  RecordDetailModal,
  SourceBadge,
  useConfirm,
  useFlash
} from "./crud-ui";
import type { DetailSectionData } from "./crud-ui";
import { PriceChangePasswordDialog } from "./PriceChangePasswordDialog";
import { PriceMasterNotice, priceMasterHint, usePriceAuthority } from "./PriceMasterNotice";
import { formatDbDateTime } from "./format-datetime";

/**
 * Limite da razao social no OMIE. Só para o aviso do formulario: quem encurta de fato o
 * valor enviado e OMIE_CUSTOMER_FIELD_MAX_LENGTHS (packages/omie-client e o edge
 * `omie-sync`). O renderer nao importa o cliente OMIE — ele nunca fala com o OMIE.
 */
const OMIE_RAZAO_SOCIAL_MAX_LENGTH = 60;

/**
 * Valor do seletor de produto da nota de entrega futura que significa "vale para qualquer
 * produto" (gravado como `product_id` nulo). Precisa ser diferente de `""`, que e o
 * "ainda nao escolhi" — sem essa distincao, salvar sem escolher nada criaria em silencio
 * a nota que carimba todos os produtos do cliente.
 */
const FUTURE_BILLING_ANY_PRODUCT = "__any__";

/**
 * Peso do quadro das notas de entrega futura. Sempre em quilos, a unidade em que a balanca
 * pesa e em que o total da nota e digitado ("Total da nota (kg)"): converter para tonelada
 * aqui obrigaria o operador a comparar duas unidades diferentes na mesma linha para conferir
 * o saldo. So o numero, sem "kg" repetido nas tres colunas da mesma linha.
 */
function formatKgAmount(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

const initialForm: CustomerFormData = {
  tradeName: "",
  legalName: "",
  document: "",
  phone: "",
  email: "",
  fiscalEmails: "",
  creditLimitReais: "",
  creditMode: "normal",
  omieBillingBlocked: false,
  observations: "",
  defaultCarrierId: "",
  defaultPaymentTermId: "",
  defaultPaymentMethodId: "",
  creditAccountEnabled: false,
  creditClosingDay: "",
  creditBoletoDays: "",
  nfRequired: true,
  creditPeriodicity: "monthly",
  creditSecondClosingDay: "",
  creditSecondBoletoDays: "",
  creditClosingWeekday: "",
  zipcode: "",
  addressStreet: "",
  addressNumber: "",
  addressComplement: "",
  neighborhood: "",
  city: "",
  state: ""
};

/** Linha "nome + remover" das listas da aba Transporte. */
const transportRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px",
  borderTop: "1px solid var(--kr-border)",
  paddingTop: "8px"
} as const;

const styles = {
  primaryButton: {
    border: "none",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)",
    borderRadius: "10px",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px"
  },
  secondaryButton: {
    border: "1px solid var(--kr-border)",
    background: "var(--kr-surface)",
    color: "var(--kr-text-strong)",
    borderRadius: "10px",
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px"
  },
  dangerButton: {
    border: "1px solid #fecaca",
    background: "var(--kr-surface)",
    color: "#b91c1c",
    borderRadius: "10px",
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px"
  },
  errorMessage: {
    color: "#b91c1c",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    padding: "6px 10px",
    borderRadius: "8px",
    fontSize: "12px"
  },
  cellMuted: {
    color: "var(--kr-muted)",
    fontSize: "12px"
  },
  // Quadro das notas de entrega futura: numero da nota, total, ja tirado e saldo.
  futureBillingBoard: {
    display: "grid",
    gap: "2px",
    marginTop: "4px"
  },
  futureBillingHeaderRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.6fr) repeat(3, minmax(0, 1fr)) auto",
    gap: "8px",
    alignItems: "center",
    fontSize: "10px",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    color: "var(--kr-muted)"
  },
  futureBillingRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.6fr) repeat(3, minmax(0, 1fr)) auto",
    gap: "8px",
    alignItems: "center",
    fontSize: "12px",
    color: "var(--kr-text-strong)",
    borderTop: "1px solid var(--kr-border)",
    padding: "6px 0"
  },
  futureBillingProduct: {
    display: "block",
    color: "var(--kr-muted)",
    fontSize: "11px"
  },
  futureBillingNumberCell: {
    textAlign: "right" as const,
    fontVariantNumeric: "tabular-nums" as const
  },
  formShell: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "14px",
    padding: "18px"
  },
  formSection: {
    display: "grid",
    gap: "6px",
    alignContent: "start",
    padding: "14px",
    border: "1px solid var(--kr-border)",
    borderRadius: "12px",
    background: "var(--kr-surface-soft)",
    minWidth: 0
  },
  formSectionTitle: {
    margin: "0 0 4px 0",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    color: "var(--kr-muted)",
    letterSpacing: "0.04em"
  },
  // Explicacao de uma secao inteira do formulario (nao de um campo, que usa o `hint`).
  formHint: {
    margin: "8px 0 0 0",
    fontSize: "12px",
    lineHeight: 1.45,
    color: "var(--kr-muted)"
  },
  fieldRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px"
  },
  compactScrollList: {
    display: "grid",
    gap: "4px",
    // O modal do cliente e alto e sobrava espaco: a lista de transportadoras
    // ocupa a area disponivel para mostrar mais itens de uma vez.
    maxHeight: "min(52vh, 560px)",
    overflow: "auto" as const,
    paddingRight: "4px"
  },
  formFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 18px",
    borderTop: "1px solid var(--kr-border)",
    flexWrap: "wrap" as const,
    gap: "8px",
    background: "var(--kr-surface-soft)"
  },
  formHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 56px 14px 18px",
    borderBottom: "1px solid var(--kr-border)",
    background: "var(--kr-surface-soft)",
    flexWrap: "wrap" as const,
    gap: "8px"
  },
  formTitle: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 700,
    color: "var(--kr-text-strong)"
  },
  pill: (color: string, bg: string) => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "10px",
    fontWeight: 800,
    color,
    background: bg
  }),
  pagination: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    color: "var(--kr-muted)",
    fontSize: "12px",
    flexWrap: "wrap" as const,
    gap: "8px"
  },
  checkbox: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontWeight: 700,
    fontSize: "12px",
    margin: "2px 0",
    color: "var(--kr-text-strong)"
  }
} as const;

interface CarrierOption {
  id: string;
  name: string;
}

/** Rotulos dos lancamentos do extrato de credito. */
const CREDIT_MOVEMENT_LABELS: Record<string, string> = {
  credit: "Credito",
  debit_product: "Venda (produto)",
  debit_freight: "Venda (frete)",
  refund_product: "Estorno (produto)",
  refund_freight: "Estorno (frete)",
  manual_adjustment: "Ajuste manual"
};

/**
 * Rotulo do lancamento no extrato. O que vem do OMIE e adiantamento (deposito do
 * cliente) ou acerto desse adiantamento — chamar de "pagamento" confundiria com a
 * baixa do fiado, que continua sendo lancada aqui.
 */
export function creditMovementLabel(movement: { movement_type: string; source?: string }): string {
  if (movement.source === "omie") {
    return movement.movement_type === "credit" ? "Adiantamento (OMIE)" : "Acerto do adiantamento";
  }
  return CREDIT_MOVEMENT_LABELS[movement.movement_type] ?? movement.movement_type;
}

/**
 * Valor com sinal para o extrato: as vendas gravam `amount_cents` positivo e o
 * tipo do movimento e que diz se ele soma ou subtrai do saldo.
 */
export function creditMovementSignedCents(movement: {
  movement_type: string;
  amount_cents: number;
}): number {
  return movement.movement_type === "debit_product" || movement.movement_type === "debit_freight"
    ? -movement.amount_cents
    : movement.amount_cents;
}

export interface CustomerFreightEntry {
  ruleId: string;
  /** Ausente na regra unica antiga, que vale para qualquer tipo de frete. */
  modality?: FreightModality;
  modalityLabel: string;
  /** "Frete fixo" ou o produto da regra. */
  scopeLabel: string;
  baseValueCents: number;
  source: "manual" | "last_used";
}

/**
 * Achata as regras do cliente numa linha por valor: a regra unica antiga (quando tem
 * valor) e cada tipo de frete configurado ou memorizado da ultima venda.
 */
export function toCustomerFreightEntries(rules: CustomerFreightRuleView[]): CustomerFreightEntry[] {
  const entries: CustomerFreightEntry[] = [];
  for (const rule of rules) {
    const scopeLabel = rule.productId ? (rule.productDescription ?? "Produto") : "Frete fixo";
    if (rule.rule.baseValueCents > 0) {
      entries.push({
        ruleId: rule.id,
        modalityLabel: "Qualquer tipo",
        scopeLabel,
        baseValueCents: rule.rule.baseValueCents,
        source: "manual"
      });
    }
    for (const [key, value] of Object.entries(rule.modalities ?? {})) {
      if (!value) continue;
      entries.push({
        ruleId: rule.id,
        modality: key as FreightModality,
        modalityLabel: getFreightModalityInfo(key).label,
        scopeLabel,
        baseValueCents: value.baseValueCents,
        source: value.source
      });
    }
  }
  return entries;
}

function CreditTotal({
  label,
  value,
  strong = false
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: "10px",
        border: "1px solid var(--kr-border)",
        background: "var(--kr-surface)"
      }}
    >
      <span style={{ ...styles.formSectionTitle, display: "block", margin: 0 }}>{label}</span>
      <strong
        style={{
          fontSize: strong ? "16px" : "14px",
          color: strong ? "var(--kr-accent)" : "var(--kr-text-strong)"
        }}
      >
        {value}
      </strong>
    </div>
  );
}
interface PaymentTermOption {
  id: string;
  name: string;
  rulesJson?: string;
}

// Secoes do formulario de cliente, navegadas por botoes (uma visivel por vez).
const CUSTOMER_FORM_SECTIONS = [
  { key: "identificacao", label: "Identificacao" },
  { key: "contato", label: "Contato" },
  { key: "fiscal", label: "Fiscal" },
  { key: "endereco", label: "Endereco" },
  { key: "comercial", label: "Comercial" },
  { key: "credito", label: "Credito" },
  { key: "transporte", label: "Transporte" },
  { key: "frete", label: "Frete" },
  { key: "precos", label: "Precos" }
] as const;
type CustomerFormSectionKey = (typeof CUSTOMER_FORM_SECTIONS)[number]["key"];
interface PaymentMethodOption {
  id: string;
  name: string;
  isCustomerCredit: boolean;
}
interface ProductOption {
  id: string;
  code: string | null;
  description: string;
}

interface CustomerSpecialPriceEntry {
  id: string;
  customerId: string;
  productId: string;
  productCode: string | null;
  productDescription: string;
  unitPriceCents: number;
  unit: string;
}

type PendingSpecialPriceAction =
  | {
      type: "save";
      customerId: string;
      productId: string;
      unitPriceCents: number;
    }
  | {
      type: "remove";
      customerId: string;
      productId: string;
    };

export interface StandaloneCustomerFormOptions {
  onCreated: (id: string) => void;
  onCancel: () => void;
  /**
   * Abre direto na edicao deste cliente em vez do cadastro em branco. Usado pelo botao
   * "Editar" ao lado do seletor de cliente da Nova entrada: o operador corrige o cadastro
   * (documento, endereco, e-mail) sem perder a pesagem que ja comecou a montar.
   */
  editId?: string;
}

export function CustomersView({
  desktopApi,
  initialSearch,
  standaloneForm
}: {
  desktopApi: KyberRockDesktopApi | null;
  /** Busca inicial (ex.: nome do cliente vindo da tela de operacoes concluidas). */
  initialSearch?: string;
  /**
   * Modo "somente formulario": renderiza apenas o modal de cadastro (ja aberto em
   * criacao), sem lista nem busca. E como a Nova entrada reaproveita este mesmo
   * formulario completo em vez de um modal reduzido proprio.
   */
  standaloneForm?: StandaloneCustomerFormOptions;
}) {
  const [customers, setCustomers] = useState<CustomerCacheEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(Boolean(standaloneForm));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerFormData>(initialForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, showFlash] = useFlash();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingBlockId, setTogglingBlockId] = useState<string | null>(null);
  /*
   * Cadastros excluidos. Ficam FORA da lista principal de proposito: ela sai do cache que
   * tambem alimenta os seletores do dia a dia, e cliente excluido nao pode reaparecer numa
   * lista de escolha. Esta secao existe so para desfazer a exclusao — sem ela, excluir era
   * o unico caminho da tela sem volta, e as pesagens do cliente ficavam sem como chegar ao
   * Fechamento.
   */
  const [deletedCustomers, setDeletedCustomers] = useState<DeletedCustomerSummary[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // Visualizacao do cliente (duplo clique na linha) com botao "Editar".
  const [viewingCustomer, setViewingCustomer] = useState<CustomerCacheEntry | null>(null);
  const [viewingCredit, setViewingCredit] = useState<CustomerCreditSummary | null>(null);
  // Snapshot do formulario ao abrir, para avisar antes de descartar alteracoes.
  const formBaselineRef = useRef<string>(
    JSON.stringify({ form: initialForm, defaultConditionText: "" })
  );
  const { confirmElement, requestConfirm } = useConfirm();

  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermOption[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  // Condicao de pagamento padrao digitada ("30", "7 14 21", "3 parcelas"); resolvida
  // para um payment_term local no salvar.
  const [defaultConditionText, setDefaultConditionText] = useState("");
  const [activeFormSection, setActiveFormSection] =
    useState<CustomerFormSectionKey>("identificacao");
  const [cnpjBusy, setCnpjBusy] = useState(false);
  const [cnpjBulkBusy, setCnpjBulkBusy] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [specialPrices, setSpecialPrices] = useState<CustomerSpecialPriceEntry[]>([]);
  const [specialProductId, setSpecialProductId] = useState("");
  const [specialPriceReais, setSpecialPriceReais] = useState("");
  const [pendingSpecialPriceAction, setPendingSpecialPriceAction] =
    useState<PendingSpecialPriceAction | null>(null);
  const [pricePasswordError, setPricePasswordError] = useState<string | null>(null);
  const [savingSpecialPrice, setSavingSpecialPrice] = useState(false);
  const [linkedCarrierIds, setLinkedCarrierIds] = useState<string[]>([]);
  // Aba Transporte: frete padrao, transporte proprio e as placas do cliente.
  const [transport, setTransport] = useState<CustomerTransportView | null>(null);
  const [transportBusy, setTransportBusy] = useState(false);
  const [plateInput, setPlateInput] = useState("");
  /** Placas ja cadastradas que casam com o que esta sendo digitado (busca do cache). */
  const [plateSuggestions, setPlateSuggestions] = useState<Array<{ id: string; plate: string }>>(
    []
  );
  const [creditSummary, setCreditSummary] = useState<CustomerCreditSummary | null>(null);
  const [creditMovements, setCreditMovements] = useState<CreditMovementRow[]>([]);
  const [creditBusy, setCreditBusy] = useState(false);
  const [customerFreightRules, setCustomerFreightRules] = useState<CustomerFreightRuleView[]>([]);
  // Balanca secundaria: preco especial e frete do cadastro vem da balanca principal da
  // pedreira. A tela avisa e nao oferece o formulario que o backend vai recusar.
  const priceAuthority = usePriceAuthority(desktopApi);
  const pricesAreReadOnly = priceAuthority.mode === "follower";
  // Mesma eleicao, outro bloco: a aba Comercial (forma de pagamento e transportadora
  // padrao, exige NF, uso de credito OMIE e a conta de credito) tambem e da balanca
  // principal. O runtime recusa a gravacao; aqui a tela avisa antes e desabilita, para a
  // operadora nao descobrir no clique do salvar.
  const commercialIsReadOnly = priceAuthority.mode === "follower";
  const [freightProductId, setFreightProductId] = useState("");
  const [freightValueReais, setFreightValueReais] = useState("");
  const [freightMode, setFreightMode] = useState<"default" | "product">("default");
  // Tipo de frete (modalidade OMIE) do valor sendo cadastrado; "" = valor unico,
  // usado quando o tipo da venda nao tem valor proprio.
  const [freightModality, setFreightModality] = useState<FreightModality | "">("");
  const [savingFreight, setSavingFreight] = useState(false);
  // Notas de venda para entrega futura ja emitidas contra o cliente, cada uma com o quanto
  // ja saiu contra ela. Varias por produto: quando uma esgota, a proxima assume.
  const [futureBillingInvoices, setFutureBillingInvoices] = useState<
    CustomerFutureBillingInvoice[]
  >([]);
  const [futureBillingProductId, setFutureBillingProductId] = useState("");
  const [futureBillingNfeNumber, setFutureBillingNfeNumber] = useState("");
  const [futureBillingTotalWeightKg, setFutureBillingTotalWeightKg] = useState("");
  const [savingFutureBilling, setSavingFutureBilling] = useState(false);
  const customerFreightEntries = useMemo(
    () => toCustomerFreightEntries(customerFreightRules),
    [customerFreightRules]
  );

  const pageSize = 50;

  /**
   * As listas que a ficha do cliente oferece: transportadoras a vincular, condicoes, formas
   * e produtos (para a tabela de preco e as regras de frete).
   *
   * Lista COMPLETA, e nao a primeira pagina de 200/500. Aqui o operador esta VINCULANDO, e
   * a transportadora que ficasse fora do corte simplesmente nao podia ser vinculada — nao
   * havia busca que a alcancasse, porque a busca desta tela filtra o que ja foi lido. As
   * quatro sao listas fechadas do cadastro (dezenas a poucas centenas de linhas), lidas uma
   * vez ao abrir a tela.
   */
  const loadOptions = useCallback(async () => {
    if (!desktopApi) return;
    try {
      const [carrierRows, termRows, methodRows, productRows] = await Promise.all([
        readAllCacheRows<CarrierOption>(desktopApi, "carrier", { activeOnly: true }),
        readAllCacheRows<PaymentTermOption>(desktopApi, "payment_term", { activeOnly: true }),
        readAllCacheRows<PaymentMethodOption>(desktopApi, "payment_method", { activeOnly: true }),
        readAllCacheRows<ProductOption>(desktopApi, "product", { activeOnly: true })
      ]);
      setCarriers(carrierRows);
      setPaymentTerms(termRows);
      setPaymentMethods(methodRows);
      setProducts(productRows);
    } catch {
      /* ignore */
    }
  }, [desktopApi]);

  // Boolean em vez do objeto: quem abre o formulario o recria a cada render, e a
  // identidade nova refaria a leitura do cache sem necessidade.
  const isStandalone = Boolean(standaloneForm);

  // A leitura espera a palavra: sem isso cada tecla era um IPC com uma varredura do
  // cadastro inteiro do outro lado — e a tela piscava a cada letra.
  const debouncedSearch = useDebouncedValue(search);

  const loadCustomers = useCallback(async () => {
    // Modo somente-formulario nao tem lista: nao vale pagar a leitura do cache.
    if (!desktopApi || isStandalone) return;
    setLoading(true);
    try {
      const result = await desktopApi.queryCache({
        entityType: "customer",
        search: debouncedSearch || undefined,
        // A tela de cadastro mostra TODOS os clientes, inclusive os inativos. Escondendo
        // os inativos, o CNPJ/CPF deles continuava ocupado ("Ja existe um cliente com
        // este CNPJ/CPF") sem que o operador tivesse como achar — ou reativar — o
        // cadastro que estava segurando o documento.
        activeOnly: false,
        limit: pageSize,
        offset: page * pageSize
      });
      setCustomers((result.rows as CustomerCacheEntry[]) ?? []);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, [desktopApi, page, debouncedSearch, isStandalone]);

  const loadDeletedCustomers = useCallback(async () => {
    if (!desktopApi || isStandalone) return;
    try {
      setDeletedCustomers(await desktopApi.customersListDeleted());
    } catch {
      // Secao auxiliar: falhar ao lista-la nao pode derrubar a tela de cadastro.
      setDeletedCustomers([]);
    }
  }, [desktopApi, isStandalone]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void loadDeletedCustomers();
  }, [loadDeletedCustomers]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch]);

  // Abre a tela ja filtrada por um cliente (ex.: "Editar cliente" numa operacao).
  useEffect(() => {
    if (initialSearch && initialSearch.trim()) {
      setSearch(initialSearch.trim());
    }
  }, [initialSearch]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  // Modo "so formulario" pedindo edicao: busca o cliente e abre a ficha dele. A lista
  // paginada pode nao conter o alvo, entao a busca varre o cache pelo id.
  const standaloneEditId = standaloneForm?.editId;
  useEffect(() => {
    if (!standaloneEditId || !desktopApi) return;
    let cancelled = false;
    void (async () => {
      const pageSize = 500;
      for (let offset = 0; offset < 10_000; offset += pageSize) {
        const result = await desktopApi
          .queryCache({ entityType: "customer", activeOnly: false, limit: pageSize, offset })
          .catch(() => null);
        if (cancelled || !result) return;
        const rows = (result.rows as CustomerCacheEntry[]) ?? [];
        const found = rows.find((row) => row.id === standaloneEditId);
        if (found) {
          openEditForm(found);
          return;
        }
        if (rows.length < pageSize || offset + rows.length >= result.total) return;
      }
    })();
    return () => {
      cancelled = true;
    };
    // openEditForm e recriada a cada render; o efeito depende so do alvo da edicao.
  }, [desktopApi, standaloneEditId]);

  // Executa "buscar CNPJ" (Receita) para TODOS os clientes com CNPJ valido e grava os
  // dados retornados. Pode demorar quando ha muitos clientes: a consulta e serial para
  // nao estourar o limite da BrasilAPI.
  async function handleEnrichAllCnpj(): Promise<void> {
    if (!desktopApi || cnpjBulkBusy) return;
    const confirmed = await requestConfirm({
      title: "Busca automatica de CNPJ",
      description:
        "Buscar o CNPJ de todos os clientes na Receita e atualizar o cadastro (razao social, " +
        "endereco, telefone)? Pode levar alguns minutos se houver muitos clientes.",
      confirmLabel: "Buscar dados",
      tone: "primary"
    });
    if (!confirmed) return;
    setCnpjBulkBusy(true);
    try {
      const result = await desktopApi.enrichAllCustomersFromCnpj();
      await loadCustomers();
      const extras: string[] = [];
      if (result.notFound > 0) extras.push(`${result.notFound} nao encontrado(s) na Receita`);
      if (result.failed > 0) extras.push(`${result.failed} com falha`);
      const suffix = extras.length ? ` (${extras.join(", ")})` : "";
      showFlash(
        "success",
        `Busca automatica concluida: ${result.updated} de ${result.withCnpj} cliente(s) com CNPJ ` +
          `atualizado(s)${suffix}. Clientes OMIE serao enviados no proximo sync.`
      );
    } catch (err) {
      showFlash(
        "error",
        err instanceof Error ? err.message : "Falha ao buscar o CNPJ dos clientes."
      );
    } finally {
      setCnpjBulkBusy(false);
    }
  }

  function resetForm(): void {
    setForm(initialForm);
    setEditingId(null);
    setEditingSource(null);
    setFormError(null);
    setSpecialPrices([]);
    setSpecialProductId("");
    setSpecialPriceReais("");
    setLinkedCarrierIds([]);
    setTransport(null);
    setPlateInput("");
    setPlateSuggestions([]);
    setCreditSummary(null);
    setCreditMovements([]);
    setCustomerFreightRules([]);
    setFreightProductId("");
    setFreightValueReais("");
    setFreightMode("default");
    setFreightModality("");
    setFutureBillingInvoices([]);
    setFutureBillingProductId("");
    setFutureBillingNfeNumber("");
    setFutureBillingTotalWeightKg("");
    setDefaultConditionText("");
    setActiveFormSection("identificacao");
  }

  function openCreateForm(): void {
    resetForm();
    formBaselineRef.current = JSON.stringify({ form: initialForm, defaultConditionText: "" });
    setShowForm(true);
  }

  async function requestCloseForm(): Promise<void> {
    const dirty = JSON.stringify({ form, defaultConditionText }) !== formBaselineRef.current;
    if (dirty) {
      const discard = await requestConfirm({
        title: "Descartar alteracoes?",
        description: "Ha alteracoes nao salvas neste cadastro. Fechar sem salvar?",
        confirmLabel: "Descartar",
        cancelLabel: "Continuar editando",
        tone: "danger"
      });
      if (!discard) return;
    }
    setShowForm(false);
    standaloneForm?.onCancel();
  }

  function openEditForm(customer: CustomerCacheEntry): void {
    const nextForm: CustomerFormData = {
      tradeName: customer.tradeName,
      legalName: customer.legalName,
      document: customer.document ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      fiscalEmails: customer.fiscalEmails ?? "",
      creditLimitReais: customer.creditLimitCents
        ? formatMoneyInput(String(customer.creditLimitCents / 100))
        : "",
      creditMode: customer.creditMode,
      omieBillingBlocked: customer.omieBillingBlocked,
      observations: customer.observations ?? "",
      defaultCarrierId: customer.defaultCarrierId ?? "",
      defaultPaymentTermId: customer.defaultPaymentTermId ?? "",
      defaultPaymentMethodId: customer.defaultPaymentMethodId ?? "",
      creditAccountEnabled: customer.creditAccountEnabled,
      creditClosingDay: customer.creditClosingDay != null ? String(customer.creditClosingDay) : "",
      creditBoletoDays: customer.creditBoletoDays != null ? String(customer.creditBoletoDays) : "",
      nfRequired: customer.nfRequired,
      creditPeriodicity: customer.creditPeriodicity ?? "monthly",
      creditSecondClosingDay:
        customer.creditSecondClosingDay != null ? String(customer.creditSecondClosingDay) : "",
      creditSecondBoletoDays:
        customer.creditSecondBoletoDays != null ? String(customer.creditSecondBoletoDays) : "",
      creditClosingWeekday:
        customer.creditClosingWeekday != null ? String(customer.creditClosingWeekday) : "",
      zipcode: customer.zipcode ?? "",
      addressStreet: customer.addressStreet ?? "",
      addressNumber: customer.addressNumber ?? "",
      addressComplement: customer.addressComplement ?? "",
      neighborhood: customer.neighborhood ?? "",
      city: customer.city ?? "",
      state: customer.state ?? ""
    };
    setForm(nextForm);
    // Condicao padrao aparece como texto editavel (regra da condicao vinculada).
    const defaultTerm = customer.defaultPaymentTermId
      ? paymentTerms.find((term) => term.id === customer.defaultPaymentTermId)
      : undefined;
    const nextConditionText = defaultTerm
      ? extractConditionRaw(defaultTerm.rulesJson ?? "") || defaultTerm.name
      : "";
    setDefaultConditionText(nextConditionText);
    formBaselineRef.current = JSON.stringify({
      form: nextForm,
      defaultConditionText: nextConditionText
    });
    // Se veio do modal de visualizacao, fecha-o: ao sair da edicao o usuario
    // volta para a lista, nao para a visualizacao desatualizada.
    setViewingCustomer(null);
    setActiveFormSection("identificacao");
    setPlateInput("");
    setPlateSuggestions([]);
    setEditingId(customer.id);
    setEditingSource(customer.source);
    setFormError(null);
    setShowForm(true);
    // Recarrega as opcoes (transportadoras, condicoes, etc.) ao abrir o cadastro:
    // sem isso a lista de transportadoras para vincular fica presa no estado do
    // mount e uma transportadora recem-criada nao apareceria para ser vinculada.
    void loadOptions();
    void loadSpecialPrices(customer.id);
    void loadLinkedCarriers(customer.id);
    void loadTransport(customer.id);
    void loadCustomerCredit(customer.id);
    void loadCustomerFreightRules(customer.id);
    void loadFutureBillingInvoices(customer.id);
  }

  async function loadFutureBillingInvoices(customerId: string): Promise<void> {
    if (!desktopApi) return;
    // Limpa o que estava digitado antes de trocar de cliente: sem isso, um numero de nota
    // deixado sem salvar no cadastro do cliente A continuaria na caixa ao abrir o cliente
    // B, e um clique em "Salvar" gravaria a nota de um no outro.
    setFutureBillingProductId("");
    setFutureBillingNfeNumber("");
    setFutureBillingTotalWeightKg("");
    try {
      setFutureBillingInvoices(await desktopApi.getCustomerFutureBillingInvoices(customerId));
    } catch {
      setFutureBillingInvoices([]);
    }
  }

  async function loadSpecialPrices(customerId: string): Promise<void> {
    if (!desktopApi) return;
    const rows = await desktopApi.customerSpecialPricesList(customerId);
    setSpecialPrices(rows as CustomerSpecialPriceEntry[]);
  }

  async function loadLinkedCarriers(customerId: string): Promise<void> {
    if (!desktopApi) return;
    try {
      const rows = await desktopApi.listCarriersByCustomer(customerId);
      setLinkedCarrierIds(rows.map((r) => r.id));
    } catch {
      setLinkedCarrierIds([]);
    }
  }

  async function loadTransport(customerId: string): Promise<void> {
    if (!desktopApi?.customerTransportGet) {
      setTransport(null);
      return;
    }
    try {
      setTransport(await desktopApi.customerTransportGet(customerId));
    } catch {
      setTransport(null);
    }
  }

  /**
   * Aplica uma mudanca da aba Transporte e reflete o resultado que o backend devolveu.
   *
   * A resposta e sempre o cadastro inteiro depois da mudanca (e nao o que a tela supos):
   * vincular a transportadora propria, por exemplo, tambem promove ela a padrao do
   * cliente, e a tela precisa mostrar isso sem uma segunda ida ao banco.
   */
  async function applyTransport(
    run: () => Promise<CustomerTransportView>,
    customerId: string
  ): Promise<void> {
    if (transportBusy) return;
    setTransportBusy(true);
    try {
      const next = await run();
      setTransport(next);
      setLinkedCarrierIds(next.carriers.map((carrier: { id: string }) => carrier.id));
      // O padrao pode ter mudado no backend: sem isto, salvar o cadastro em seguida
      // regravaria a transportadora antiga por cima.
      setForm((prev) => ({ ...prev, defaultCarrierId: next.defaultCarrierId ?? "" }));
      setFormError(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao atualizar o transporte.");
      void loadTransport(customerId);
    } finally {
      setTransportBusy(false);
    }
  }

  /**
   * Placas ja cadastradas que casam com o que esta sendo digitado.
   *
   * Sai do mesmo cache do seletor da nova entrada, e nao de uma lista carregada inteira: a
   * pedreira tem milhares de placas, e o que interessa aqui sao as poucas que o operador
   * esta procurando. Falha de leitura simplesmente nao sugere nada — o campo continua
   * aceitando a placa digitada.
   */
  async function loadPlateSuggestions(term: string): Promise<void> {
    if (!desktopApi || term.trim().length < 2) {
      setPlateSuggestions([]);
      return;
    }
    try {
      const result = await desktopApi.queryCache({
        entityType: "vehicle",
        search: term.trim(),
        limit: 6
      });
      setPlateSuggestions(
        (result.rows as Array<{ id?: unknown; plate?: unknown }>)
          .map((row) => ({ id: String(row.id ?? ""), plate: String(row.plate ?? "") }))
          .filter((row) => row.id && row.plate)
      );
    } catch {
      setPlateSuggestions([]);
    }
  }

  async function handleAddPlate(customerId: string): Promise<void> {
    if (!desktopApi || transportBusy) return;
    const plate = plateInput.trim();
    if (!plate) return;
    setTransportBusy(true);
    try {
      await desktopApi.customerTransportAddPlate(customerId, plate);
      setPlateInput("");
      setPlateSuggestions([]);
      await loadTransport(customerId);
      setFormError(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao vincular a placa.");
    } finally {
      setTransportBusy(false);
    }
  }

  async function handleRemovePlate(customerId: string, vehicleId: string): Promise<void> {
    if (!desktopApi || transportBusy) return;
    setTransportBusy(true);
    try {
      await desktopApi.customerTransportRemovePlate(customerId, vehicleId);
      await loadTransport(customerId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao retirar a placa.");
    } finally {
      setTransportBusy(false);
    }
  }

  async function loadCustomerCredit(customerId: string): Promise<void> {
    if (!desktopApi) return;
    try {
      const [summary, movements] = await Promise.all([
        desktopApi.customerCreditSummary(customerId),
        desktopApi.customerCreditMovements(customerId, 50)
      ]);
      setCreditSummary(summary);
      setCreditMovements(movements);
    } catch {
      setCreditSummary(null);
      setCreditMovements([]);
    }
  }

  /**
   * Confere os adiantamentos do cliente com o financeiro do OMIE. O saldo
   * depositado nasce la (titulo a receber baixado); aqui ele so e espelhado para
   * abater as compras da balanca.
   */
  async function handleSyncAdvances(): Promise<void> {
    if (!desktopApi || !editingId) return;
    setCreditBusy(true);
    setFormError(null);
    try {
      const result = await desktopApi.customerCreditSyncAdvances();
      await loadCustomerCredit(editingId);
      showFlash(
        "success",
        result.imported + result.adjusted > 0
          ? `Adiantamentos do OMIE atualizados (${result.imported} novo(s), ${result.adjusted} acerto(s)).`
          : "Adiantamentos do OMIE conferidos: nenhuma diferenca."
      );
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Falha ao sincronizar os adiantamentos do OMIE."
      );
    } finally {
      setCreditBusy(false);
    }
  }

  async function handleToggleCarrier(carrierId: string): Promise<void> {
    if (!desktopApi || !editingId) return;
    try {
      const linked = linkedCarrierIds.includes(carrierId);
      const result = linked
        ? await desktopApi.unlinkCustomerCarrier(editingId, carrierId)
        : await desktopApi.linkCustomerCarrier(editingId, carrierId);
      setLinkedCarrierIds((prev) =>
        linked ? prev.filter((id) => id !== carrierId) : [...prev, carrierId]
      );
      // Vincular/desvincular pode promover ou trocar a transportadora padrao no
      // banco; sem trazer isso para o formulario, salvar regravaria o valor antigo.
      setForm((prev) => ({ ...prev, defaultCarrierId: result?.defaultCarrierId ?? "" }));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao vincular transportadora");
    }
  }

  async function loadCustomerFreightRules(customerId: string): Promise<void> {
    if (!desktopApi) return;
    try {
      const rows = await desktopApi.getCustomerFreightRules(customerId);
      setCustomerFreightRules(rows);
    } catch {
      setCustomerFreightRules([]);
    }
  }

  async function handleSaveFreightRule(): Promise<void> {
    if (!desktopApi || !editingId) return;
    const unitPriceCents = parseMoneyInputToCents(freightValueReais);
    if (unitPriceCents === null) {
      setFormError("Valor de frete invalido.");
      return;
    }
    setSavingFreight(true);
    try {
      await desktopApi.setCustomerFreightRule({
        customerId: editingId,
        productId: freightMode === "product" ? freightProductId || null : null,
        modality: freightModality || null,
        rule: {
          id: crypto.randomUUID(),
          name:
            freightMode === "product" && freightProductId
              ? (products.find((p) => p.id === freightProductId)?.description ??
                "Frete por produto")
              : "Frete fixo",
          type: "per_ton",
          baseValueCents: unitPriceCents,
          unit: "ton"
        }
      });
      setFreightValueReais("");
      setFreightProductId("");
      await loadCustomerFreightRules(editingId);
      showFlash("success", "Frete salvo.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao salvar frete.");
    } finally {
      setSavingFreight(false);
    }
  }

  async function handleRemoveFreightRule(
    ruleId: string,
    modality?: FreightModality
  ): Promise<void> {
    if (!desktopApi || !editingId) return;
    try {
      if (modality) {
        await desktopApi.removeCustomerFreightModality(ruleId, modality);
      } else {
        await desktopApi.removeCustomerFreightRule(ruleId);
      }
      await loadCustomerFreightRules(editingId);
      showFlash("success", "Frete removido.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao remover frete.");
    }
  }

  async function handleSaveFutureBillingInvoice(): Promise<void> {
    if (!desktopApi || !editingId) return;
    if (!futureBillingProductId) {
      setFormError(
        "Escolha o produto da nota de entrega futura (ou 'Qualquer produto do cliente')."
      );
      return;
    }
    if (!futureBillingNfeNumber.trim()) {
      setFormError("Informe o numero da nota fiscal de faturamento futuro.");
      return;
    }
    setSavingFutureBilling(true);
    setFormError(null);
    try {
      await desktopApi.setCustomerFutureBillingInvoice({
        customerId: editingId,
        productId:
          futureBillingProductId === FUTURE_BILLING_ANY_PRODUCT ? null : futureBillingProductId,
        nfeNumber: futureBillingNfeNumber,
        // Vazio grava a nota sem controle de saldo: quem so quer a referencia no cupom
        // continua com o cadastro de antes, sem ter de inventar uma quantidade.
        totalWeightKg: futureBillingTotalWeightKg || null
      });
      setFutureBillingNfeNumber("");
      setFutureBillingProductId("");
      setFutureBillingTotalWeightKg("");
      await loadFutureBillingInvoices(editingId);
      showFlash("success", "Nota de faturamento futuro salva.");
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao salvar a nota de faturamento futuro."
      );
    } finally {
      setSavingFutureBilling(false);
    }
  }

  async function handleRemoveFutureBillingInvoice(invoiceId: string): Promise<void> {
    if (!desktopApi || !editingId) return;
    const confirmed = await requestConfirm({
      title: "Encerrar a entrega futura?",
      description:
        "A nota sai do quadro com o saldo dela: as proximas pesagens passam para a nota seguinte do mesmo produto, ou saem sem referencia se nao houver outra. As ja faturadas nao mudam.",
      confirmLabel: "Encerrar",
      cancelLabel: "Manter",
      tone: "danger"
    });
    if (!confirmed) return;
    try {
      await desktopApi.removeCustomerFutureBillingInvoice(invoiceId);
      await loadFutureBillingInvoices(editingId);
      showFlash("success", "Entrega futura encerrada.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao remover a nota.");
    }
  }

  function validateForm(): string | null {
    if (!form.tradeName.trim()) return "Nome fantasia obrigatorio.";
    if (!form.legalName.trim()) return "Razao social obrigatoria.";
    return null;
  }

  async function handleSave(): Promise<void> {
    if (!desktopApi || saving) return;
    const error = validateForm();
    if (error) {
      setFormError(error);
      return;
    }
    const normalizedDocument = normalizeDocument(form.document);
    if (form.document.trim() && !isValidDocument(normalizedDocument)) {
      setFormError("CPF/CNPJ invalido.");
      return;
    }
    const normalizedPhone = normalizePhone(form.phone);
    if (form.phone.trim() && normalizedPhone.length !== 10 && normalizedPhone.length !== 11) {
      setFormError("Telefone invalido. Informe com DDD (11 digitos).");
      return;
    }
    const invalidEmails = invalidEmailsInList(form.email);
    if (invalidEmails.length > 0) {
      setFormError(`Email invalido: ${invalidEmails.join(", ")}.`);
      return;
    }
    const invalidFiscalEmails = invalidEmailsInList(form.fiscalEmails);
    if (invalidFiscalEmails.length > 0) {
      setFormError(`Email da NF-e invalido: ${invalidFiscalEmails.join(", ")}.`);
      return;
    }
    const normalizedEmail = normalizeEmailList(form.email);
    const normalizedFiscalEmails = normalizeEmailList(form.fiscalEmails);
    const creditLimitText = form.creditLimitReais.trim();
    const creditLimitCents = creditLimitText
      ? (parseMoneyInputToCents(creditLimitText) ?? undefined)
      : undefined;
    if (creditLimitText && creditLimitCents === undefined) {
      setFormError("Limite de credito invalido. Use virgula para os centavos (ex: 1.500,00).");
      return;
    }

    const creditPeriodicity = form.creditAccountEnabled ? form.creditPeriodicity : "monthly";
    let creditClosingDay: number | null = null;
    let creditBoletoDays: number | null = null;
    let creditSecondClosingDay: number | null = null;
    let creditSecondBoletoDays: number | null = null;
    let creditClosingWeekday: number | null = null;
    if (form.creditAccountEnabled) {
      creditBoletoDays = numberOrNaN(form.creditBoletoDays);
      if (!Number.isInteger(creditBoletoDays) || creditBoletoDays < 0) {
        setFormError("Informe os dias apos o fechamento para o vencimento do boleto.");
        return;
      }
      if (creditPeriodicity === "weekly") {
        creditClosingWeekday = numberOrNaN(form.creditClosingWeekday);
        if (
          !Number.isInteger(creditClosingWeekday) ||
          creditClosingWeekday < 0 ||
          creditClosingWeekday > 6
        ) {
          setFormError("Selecione o dia da semana do fechamento.");
          return;
        }
      } else {
        creditClosingDay = numberOrNaN(form.creditClosingDay);
        if (!Number.isInteger(creditClosingDay) || creditClosingDay < 1 || creditClosingDay > 31) {
          setFormError("Informe o dia de fechamento (1 a 31) para o credito do cliente.");
          return;
        }
        if (creditPeriodicity === "biweekly") {
          creditSecondClosingDay = numberOrNaN(form.creditSecondClosingDay);
          creditSecondBoletoDays = numberOrNaN(form.creditSecondBoletoDays);
          if (
            !Number.isInteger(creditSecondClosingDay) ||
            creditSecondClosingDay < 1 ||
            creditSecondClosingDay > 31
          ) {
            setFormError("Informe o segundo dia de fechamento (1 a 31).");
            return;
          }
          if (creditSecondClosingDay <= creditClosingDay) {
            setFormError("O segundo dia de fechamento deve ser maior que o primeiro.");
            return;
          }
          if (!Number.isInteger(creditSecondBoletoDays) || creditSecondBoletoDays < 0) {
            setFormError("Informe os dias para o vencimento do segundo fechamento.");
            return;
          }
        }
      }
    }
    const normalizedZipcode = form.zipcode.replace(/\D/g, "");

    const conditionText = defaultConditionText.trim();
    if (conditionText && !tryParsePaymentCondition(conditionText)) {
      setFormError(
        'Condicao de pagamento padrao invalida. Use "30" (dias), "7 14 21", "7/14/21", ' +
          '"3 parcelas" ou periodo ("s+20" semana, "d+20" dezena, "q+20" quinzena, "m+20" mes).'
      );
      return;
    }

    setSaving(true);
    let createdId: string | null = null;
    try {
      // Texto da condicao vira (ou reusa) um payment_term local vinculado ao cliente.
      const resolvedDefaultTermId = conditionText
        ? await resolveConditionTermId(desktopApi, conditionText)
        : "";
      if (editingId) {
        const localPatch = {
          observations: form.observations.trim() || undefined,
          creditMode: form.creditMode,
          defaultCarrierId: form.defaultCarrierId || null,
          defaultPaymentTermId: resolvedDefaultTermId || null,
          defaultPaymentMethodId: form.defaultPaymentMethodId || null,
          creditAccountEnabled: form.creditAccountEnabled,
          creditClosingDay,
          creditBoletoDays,
          nfRequired: form.nfRequired,
          creditPeriodicity,
          creditSecondClosingDay,
          creditSecondBoletoDays,
          creditClosingWeekday
        };
        const fullPatch = {
          tradeName: form.tradeName.trim(),
          legalName: form.legalName.trim(),
          document: normalizedDocument || undefined,
          phone: normalizedPhone || undefined,
          email: normalizedEmail || undefined,
          // String vazia limpa os destinatarios da NF-e (o campo e sempre enviado, senao
          // remover todos os enderecos no formulario nao apagaria nada).
          fiscalEmails: normalizedFiscalEmails,
          // Campo vazio limpa o limite (null); preenchido grava o valor em centavos.
          creditLimitCents: creditLimitText ? creditLimitCents : null,
          omieBillingBlocked: form.omieBillingBlocked,
          ...localPatch,
          zipcode: normalizedZipcode || null,
          addressStreet: form.addressStreet.trim() || null,
          addressNumber: form.addressNumber.trim() || null,
          addressComplement: form.addressComplement.trim() || null,
          neighborhood: form.neighborhood.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim().toUpperCase() || null
        };
        // Cliente origem OMIE agora aceita edicao de cadastro (endereco/e-mail/razao)
        // para completar os dados de NF-e: enviamos o cadastro completo com override,
        // e o cliente vira 'hybrid' para o proximo sync empurrar os campos ao OMIE.
        if (editingSource === "omie") {
          await desktopApi.customersUpdate(editingId, fullPatch, { overrideOmieFields: true });
        } else {
          await desktopApi.customersUpdate(editingId, fullPatch);
        }
        showFlash("success", "Cliente atualizado.");
      } else {
        const created = await desktopApi.customersCreate({
          tradeName: form.tradeName.trim(),
          legalName: form.legalName.trim(),
          document: normalizedDocument || undefined,
          phone: normalizedPhone || undefined,
          email: normalizedEmail || undefined,
          fiscalEmails: normalizedFiscalEmails || undefined,
          creditLimitCents: creditLimitCents ?? undefined,
          creditMode: form.creditMode,
          omieBillingBlocked: form.omieBillingBlocked,
          observations: form.observations.trim() || undefined,
          defaultCarrierId: form.defaultCarrierId || undefined,
          defaultPaymentTermId: resolvedDefaultTermId || undefined,
          defaultPaymentMethodId: form.defaultPaymentMethodId || undefined,
          creditAccountEnabled: form.creditAccountEnabled,
          creditClosingDay: creditClosingDay ?? undefined,
          creditBoletoDays: creditBoletoDays ?? undefined,
          nfRequired: form.nfRequired,
          creditPeriodicity,
          creditSecondClosingDay: creditSecondClosingDay ?? undefined,
          creditSecondBoletoDays: creditSecondBoletoDays ?? undefined,
          creditClosingWeekday: creditClosingWeekday ?? undefined,
          zipcode: normalizedZipcode || undefined,
          addressStreet: form.addressStreet.trim() || undefined,
          addressNumber: form.addressNumber.trim() || undefined,
          addressComplement: form.addressComplement.trim() || undefined,
          neighborhood: form.neighborhood.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim().toUpperCase() || undefined
        });
        createdId = (created as { id?: string } | null)?.id ?? null;
        showFlash("success", "Cliente criado.");
      }
      setShowForm(false);
      resetForm();
      await loadCustomers();
      if (standaloneForm) {
        // Quem abriu o formulario (ex.: Nova entrada) fica com o cliente salvo
        // selecionado — tanto o recem-criado quanto o que acabou de ser editado.
        const savedId = createdId || standaloneForm.editId;
        if (savedId) standaloneForm.onCreated(savedId);
        else standaloneForm.onCancel();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao salvar cliente.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSpecialPrice(): Promise<void> {
    if (!desktopApi || !editingId || !specialProductId || !specialPriceReais.trim()) return;
    const unitPriceCents = parseMoneyInputToCents(specialPriceReais);
    if (unitPriceCents === null) {
      setFormError("Preco especial invalido.");
      return;
    }

    setPricePasswordError(null);
    setPendingSpecialPriceAction({
      type: "save",
      customerId: editingId,
      productId: specialProductId,
      unitPriceCents
    });
  }

  async function handleConfirmSpecialPrice(password: string): Promise<void> {
    if (!desktopApi || !pendingSpecialPriceAction || savingSpecialPrice) return;
    setSavingSpecialPrice(true);
    try {
      const valid = await desktopApi.verifyPriceChangePassword(password);
      if (!valid) {
        setPricePasswordError("Senha incorreta.");
        return;
      }

      if (pendingSpecialPriceAction.type === "save") {
        await desktopApi.customerSpecialPricesSet({
          customerId: pendingSpecialPriceAction.customerId,
          productId: pendingSpecialPriceAction.productId,
          unitPriceCents: pendingSpecialPriceAction.unitPriceCents,
          unit: "ton"
        });
        setSpecialProductId("");
        setSpecialPriceReais("");
        await loadSpecialPrices(pendingSpecialPriceAction.customerId);
        showFlash("success", "Preco especial salvo.");
      } else {
        await desktopApi.customerSpecialPricesRemove(
          pendingSpecialPriceAction.customerId,
          pendingSpecialPriceAction.productId
        );
        await loadSpecialPrices(pendingSpecialPriceAction.customerId);
        showFlash("success", "Preco especial removido.");
      }
      setPendingSpecialPriceAction(null);
      setPricePasswordError(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao alterar preco especial.");
    } finally {
      setSavingSpecialPrice(false);
    }
  }

  async function handleRemoveSpecialPrice(productId: string): Promise<void> {
    if (!desktopApi || !editingId) return;
    setPricePasswordError(null);
    setPendingSpecialPriceAction({ type: "remove", customerId: editingId, productId });
  }

  // Alterna "Bloqueado para faturamento" direto da lista de clientes. Cliente
  // origem OMIE precisa do override (vira 'hybrid') para o proximo sync empurrar
  // o bloqueio/liberacao ao OMIE.
  async function handleToggleBillingBlocked(customer: CustomerCacheEntry): Promise<void> {
    if (!desktopApi || togglingBlockId) return;
    setTogglingBlockId(customer.id);
    const nextBlocked = !customer.omieBillingBlocked;
    try {
      const patch = { omieBillingBlocked: nextBlocked };
      if (customer.source === "omie") {
        await desktopApi.customersUpdate(customer.id, patch, { overrideOmieFields: true });
      } else {
        await desktopApi.customersUpdate(customer.id, patch);
      }
      await loadCustomers();
      showFlash(
        "success",
        nextBlocked
          ? "Cliente bloqueado para faturamento. Sera enviado ao OMIE no proximo sync."
          : "Faturamento liberado para o cliente. Sera enviado ao OMIE no proximo sync."
      );
    } catch (err) {
      showFlash(
        "error",
        err instanceof Error ? err.message : "Erro ao alterar o bloqueio de faturamento."
      );
    } finally {
      setTogglingBlockId(null);
    }
  }

  /**
   * Reativa um cliente inativo. O documento dele continua ocupado enquanto o cadastro
   * existir, entao reativar e o caminho certo — cadastrar de novo com o mesmo CNPJ/CPF o
   * KyberRock recusa (e o OMIE tambem).
   */
  async function handleReactivate(customer: CustomerCacheEntry): Promise<void> {
    if (!desktopApi || togglingBlockId) return;
    setTogglingBlockId(customer.id);
    try {
      await desktopApi.customersUpdate(customer.id, { isActive: true });
      await loadCustomers();
      showFlash("success", "Cliente reativado.");
    } catch (err) {
      showFlash("error", err instanceof Error ? err.message : "Erro ao reativar o cliente.");
    } finally {
      setTogglingBlockId(null);
    }
  }

  /**
   * Desfaz a exclusao. As pesagens nunca sairam do banco — elas continuam apontando para
   * este cadastro —, entao restaurar devolve junto o caminho ate elas no Fechamento.
   */
  async function handleRestore(customer: DeletedCustomerSummary): Promise<void> {
    if (!desktopApi || restoringId) return;
    setRestoringId(customer.id);
    try {
      await desktopApi.customersRestore(customer.id);
      await Promise.all([loadCustomers(), loadDeletedCustomers()]);
      showFlash("success", "Cliente restaurado. As pesagens dele voltam ao Fechamento.");
    } catch (err) {
      showFlash("error", err instanceof Error ? err.message : "Erro ao restaurar o cliente.");
    } finally {
      setRestoringId(null);
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!desktopApi || !pendingDeleteId) return;
    setDeleting(true);
    try {
      await desktopApi.customersDelete(pendingDeleteId);
      if (pendingDeleteId === editingId) {
        setShowForm(false);
        resetForm();
      }
      setPendingDeleteId(null);
      await Promise.all([loadCustomers(), loadDeletedCustomers()]);
      showFlash("success", "Cliente excluido. Da para restaurar em Excluidos.");
    } catch (err) {
      setPendingDeleteId(null);
      showFlash("error", err instanceof Error ? err.message : "Erro ao excluir cliente.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleCepLookup(digits: string): Promise<CepLookupResult | null> {
    if (!desktopApi) return null;
    try {
      return await desktopApi.lookupCep(digits);
    } catch {
      return null;
    }
  }

  function handleCepAddressFound(address: CepLookupResult): void {
    setForm((prev) => ({
      ...prev,
      zipcode: address.zipcode || prev.zipcode,
      addressStreet: address.street || prev.addressStreet,
      addressComplement: address.complement || prev.addressComplement,
      neighborhood: address.neighborhood || prev.neighborhood,
      city: address.city || prev.city,
      state: (address.state || prev.state).toUpperCase().slice(0, 2)
    }));
  }

  // Busca os dados do cliente pelo CNPJ (BrasilAPI/Receita via edge) e preenche o
  // formulario. Nao sobrescreve campos ja preenchidos com valor vazio da consulta.
  async function handleCnpjLookup(): Promise<void> {
    if (!desktopApi) return;
    const digits = form.document.replace(/\D/g, "");
    if (digits.length !== 14) {
      setFormError("Informe um CNPJ com 14 digitos para buscar.");
      return;
    }
    setCnpjBusy(true);
    setFormError(null);
    try {
      const data = await desktopApi.lookupCnpj(digits);
      if (!data.found) {
        showFlash("error", "CNPJ nao encontrado na base da Receita.");
        return;
      }
      setForm((prev) => ({
        ...prev,
        legalName: data.legalName || prev.legalName,
        tradeName: data.tradeName || prev.tradeName,
        phone: data.phone || prev.phone,
        email: data.email || prev.email,
        zipcode: data.zipcode || prev.zipcode,
        addressStreet: data.addressStreet || prev.addressStreet,
        addressNumber: data.addressNumber || prev.addressNumber,
        addressComplement: data.addressComplement || prev.addressComplement,
        neighborhood: data.neighborhood || prev.neighborhood,
        city: data.city || prev.city,
        state: (data.state || prev.state).toUpperCase().slice(0, 2)
      }));
      const semEmail = !data.email;
      showFlash(
        "success",
        semEmail
          ? "Dados do CNPJ preenchidos. E-mail nao consta na Receita — informe manualmente ou use o e-mail padrao de NF-e."
          : "Dados do CNPJ preenchidos. Revise e salve."
      );
    } catch (err) {
      showFlash("error", err instanceof Error ? err.message : "Falha ao buscar o CNPJ.");
    } finally {
      setCnpjBusy(false);
    }
  }

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);

  // Vinculadas primeiro no seletor de transportadora padrao: sao as que a Nova
  // entrada realmente oferece para este cliente.
  const defaultCarrierOptions = useMemo(
    () =>
      [...carriers].sort((a, b) => {
        const aLinked = linkedCarrierIds.includes(a.id) ? 0 : 1;
        const bLinked = linkedCarrierIds.includes(b.id) ? 0 : 1;
        return aLinked - bLinked || a.name.localeCompare(b.name, "pt-BR");
      }),
    [carriers, linkedCarrierIds]
  );

  // Credito do cliente aberto na visualizacao (limite x utilizado x disponivel).
  useEffect(() => {
    if (!desktopApi || !viewingCustomer) {
      setViewingCredit(null);
      return;
    }
    let cancelled = false;
    const customerId = viewingCustomer.id;
    void desktopApi
      .customerCreditSummary(customerId)
      .then((summary) => {
        if (!cancelled) setViewingCredit(summary);
      })
      .catch(() => {
        if (!cancelled) setViewingCredit(null);
      });
    return () => {
      cancelled = true;
    };
  }, [desktopApi, viewingCustomer]);

  const isOmie = editingSource === "omie";

  // Modal de visualizacao: todas as informacoes do cliente agrupadas por secao,
  // espelhando as abas do formulario de edicao.
  function buildCustomerDetailSections(customer: CustomerCacheEntry): DetailSectionData[] {
    const carrierName = customer.defaultCarrierId
      ? (carriers.find((carrier) => carrier.id === customer.defaultCarrierId)?.name ?? "")
      : "";
    const termName = customer.defaultPaymentTermId
      ? (paymentTerms.find((term) => term.id === customer.defaultPaymentTermId)?.name ?? "")
      : "";
    const methodName = customer.defaultPaymentMethodId
      ? (paymentMethods.find((method) => method.id === customer.defaultPaymentMethodId)?.name ?? "")
      : "";
    return [
      {
        title: "Identificacao",
        items: [
          { label: "Razao social", value: customer.legalName },
          { label: "Nome fantasia", value: customer.tradeName },
          { label: "CNPJ/CPF", value: formatDocument(customer.document ?? "") },
          {
            label: "Limite de credito",
            value: customer.creditLimitCents ? formatMoney(customer.creditLimitCents) : ""
          },
          // Ao lado do limite: o limite nao muda com as vendas, quem cai e o
          // disponivel. Ver so o limite dava a impressao de que a venda no
          // credito nao tinha descontado nada.
          {
            label: "Credito disponivel",
            value:
              viewingCredit === null
                ? ""
                : viewingCredit.availableCents === null
                  ? "Sem limite"
                  : formatMoney(viewingCredit.availableCents)
          },
          {
            label: "Credito utilizado",
            value: viewingCredit === null ? "" : formatMoney(viewingCredit.usedCents)
          }
        ]
      },
      {
        title: "Contato",
        items: [
          { label: "Telefone", value: formatPhone(customer.phone ?? "") },
          { label: "E-mail", value: customer.email ?? "" }
        ]
      },
      {
        title: "Fiscal",
        items: [{ label: "E-mails da NF-e", value: customer.fiscalEmails ?? "" }]
      },
      {
        title: "Endereco",
        items: [
          { label: "CEP", value: customer.zipcode ?? "" },
          {
            label: "Endereco",
            value: [customer.addressStreet, customer.addressNumber].filter(Boolean).join(", ")
          },
          { label: "Complemento", value: customer.addressComplement ?? "" },
          { label: "Bairro", value: customer.neighborhood ?? "" },
          {
            label: "Cidade/UF",
            value: [customer.city, customer.state].filter(Boolean).join(" / ")
          }
        ]
      },
      {
        title: "Comercial",
        fullWidth: true,
        items: [
          { label: "Forma de pagamento padrao", value: methodName },
          { label: "Condicao de pagamento padrao", value: termName },
          { label: "Transportadora padrao", value: carrierName },
          {
            label: "Credito do cliente",
            value: customer.creditAccountEnabled ? "Habilitado" : "Nao habilitado"
          },
          {
            label: "Uso de credito OMIE",
            value:
              customer.creditMode === "prepaid" ? "Debitar credito pre-pago" : "Nao debitar credito"
          },
          { label: "Exige nota fiscal", value: customer.nfRequired ? "Sim" : "Nao" },
          {
            label: "Bloqueado para faturamento",
            value: customer.omieBillingBlocked ? "Sim" : "Nao"
          },
          { label: "Observacoes internas", value: customer.observations ?? "" }
        ]
      }
    ];
  }

  // Lista, busca e acoes em lote so existem na tela de Cadastros: no modo
  // somente-formulario (Nova entrada) o modal de cadastro e a tela inteira.
  const listChrome = standaloneForm ? null : (
    <>
      <CrudSectionHeader
        title="Clientes"
        description="Clientes sincronizados do OMIE ou criados localmente. Clientes locais sao enviados ao OMIE no proximo sync."
        count={total}
        actionLabel="Novo cliente"
        onAction={openCreateForm}
      />

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: "10px",
          padding: "12px 14px",
          marginBottom: "12px",
          border: "1px solid var(--kr-border)",
          borderRadius: "12px",
          background: "var(--kr-surface-soft)"
        }}
      >
        <button
          type="button"
          onClick={() => void handleEnrichAllCnpj()}
          disabled={cnpjBulkBusy}
          title="Busca o CNPJ de TODOS os clientes na Receita e atualiza o cadastro (razao social, endereco, telefone)"
          style={{
            ...styles.secondaryButton,
            height: "38px",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            opacity: cnpjBulkBusy ? 0.6 : 1
          }}
        >
          <Search size={14} />
          {cnpjBulkBusy ? "Buscando dados..." : "Busca de dados automatica (todos)"}
        </button>
      </div>

      <CrudSearchBar
        value={search}
        onChange={setSearch}
        placeholder="Buscar cliente por nome, fantasia ou CNPJ..."
        onRefresh={() => void loadCustomers()}
      />
      <FlashBanner flash={flash} />
    </>
  );

  return (
    <div>
      {listChrome}

      {showForm ? (
        <CrudFormModal onClose={() => void requestCloseForm()} maxWidth={1040} fixedHeight>
          <Fragment>
            <div style={styles.formHeader}>
              <h3 style={styles.formTitle}>
                {editingId
                  ? `Editar cliente ${isOmie ? "(alteracoes serao enviadas ao OMIE)" : ""}`
                  : "Novo cliente"}
              </h3>
              {formError ? <p style={styles.errorMessage}>{formError}</p> : null}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "14px 18px 0" }}>
              {CUSTOMER_FORM_SECTIONS.map((section) => {
                const active = activeFormSection === section.key;
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => setActiveFormSection(section.key)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "999px",
                      border: active ? "2px solid var(--kr-accent)" : "1px solid var(--kr-border)",
                      background: active ? "var(--kr-accent-soft)" : "var(--kr-surface)",
                      color: active ? "var(--kr-info-text)" : "var(--kr-muted)",
                      fontWeight: active ? 800 : 600,
                      fontSize: "12px",
                      cursor: "pointer"
                    }}
                  >
                    {section.label}
                  </button>
                );
              })}
            </div>
            <div
              style={{
                ...styles.formShell,
                gridTemplateColumns: "1fr",
                // O modal tem altura fixa: o miolo da aba rola por dentro, mantendo
                // cabecalho, botoes de secao e rodape sempre visiveis.
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                alignContent: "start"
              }}
            >
              {activeFormSection === "identificacao" ? (
                <section style={styles.formSection}>
                  <h4 style={styles.formSectionTitle}>Identificacao</h4>
                  <TextInput
                    label="Razao social"
                    value={form.legalName}
                    onChange={(legalName) => setForm({ ...form, legalName })}
                    required
                    disabled={false}
                    // O cadastro aceita qualquer tamanho; quem tem limite e o OMIE. O aviso
                    // existe para o operador nao achar que precisa reescrever a razao social
                    // (era o que a recusa "ultrapassa 60 caracteres" fazia parecer).
                    hint={
                      form.legalName.trim().length > OMIE_RAZAO_SOCIAL_MAX_LENGTH
                        ? `Acima de ${OMIE_RAZAO_SOCIAL_MAX_LENGTH} caracteres: o OMIE recebe a razao social encurtada. O cadastro completo continua aqui, no cupom e nos relatorios.`
                        : undefined
                    }
                  />
                  <TextInput
                    label="Nome fantasia"
                    value={form.tradeName}
                    onChange={(tradeName) => setForm({ ...form, tradeName })}
                    required
                    disabled={false}
                  />
                  <div style={styles.fieldRow}>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: "8px" }}>
                      <div style={{ flex: 1 }}>
                        <DocumentInput
                          label="CNPJ/CPF"
                          value={form.document}
                          onChange={(document) => setForm({ ...form, document })}
                          disabled={false}
                        />
                      </div>
                      <Tooltip content="Buscar dados pelo CNPJ (Receita) e preencher o cadastro">
                        <button
                          type="button"
                          onClick={() => void handleCnpjLookup()}
                          disabled={cnpjBusy}
                          aria-label="Buscar dados pelo CNPJ"
                          style={{
                            ...styles.secondaryButton,
                            height: "38px",
                            width: "38px",
                            padding: 0,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            opacity: cnpjBusy ? 0.6 : 1
                          }}
                        >
                          <Search size={16} />
                        </button>
                      </Tooltip>
                    </div>
                    <MoneyInput
                      label="Limite (R$)"
                      value={form.creditLimitReais}
                      onChange={(creditLimitReais) => setForm({ ...form, creditLimitReais })}
                      disabled={false}
                      allowZero
                      hint="Use virgula para centavos."
                    />
                  </div>
                </section>
              ) : null}

              {activeFormSection === "contato" ? (
                <section style={styles.formSection}>
                  <h4 style={styles.formSectionTitle}>Contato</h4>
                  <div style={styles.fieldRow}>
                    <PhoneInput
                      label="Telefone"
                      value={form.phone}
                      onChange={(phone) => setForm({ ...form, phone })}
                      disabled={false}
                    />
                    <EmailListInput
                      label="E-mail"
                      value={form.email}
                      onChange={(email) => setForm({ ...form, email })}
                      disabled={false}
                      hint="E-mail de contato do cliente. Os destinatarios da NF-e ficam na aba Fiscal."
                    />
                  </div>
                </section>
              ) : null}

              {activeFormSection === "fiscal" ? (
                <section style={styles.formSection}>
                  <h4 style={styles.formSectionTitle}>Fiscal</h4>
                  <div style={styles.fieldRow}>
                    <EmailListInput
                      label="E-mails da NF-e"
                      value={form.fiscalEmails}
                      onChange={(fiscalEmails) => setForm({ ...form, fiscalEmails })}
                      disabled={false}
                      hint="Quem recebe a nota e o boleto. Vao para o cadastro do cliente e para cada operacao no OMIE."
                    />
                  </div>
                  <p style={styles.formHint}>
                    Estes enderecos sao os destinatarios da NF-e e do boleto no OMIE — coisa
                    distinta do e-mail de contato da aba Contato, que serve so para falar com o
                    cliente. Todos eles vao para o &quot;Utilizar os seguintes enderecos de
                    e-mail&quot; do cadastro do cliente E para os &quot;Enderecos de e-mail que
                    recebem a NF&quot; de cada operacao enviada ao OMIE. Deixe vazio para o OMIE
                    seguir com o que estiver configurado la.
                  </p>

                  <h4 style={styles.formSectionTitle}>Venda para entrega futura</h4>
                  <p style={styles.formHint}>
                    Quando o cliente ja pagou uma nota de faturamento (CFOP 5.922) e vai retirando a
                    carga aos poucos, cadastre aqui o numero dela e quanto ela faturou em quilos.
                    Cada pesagem desse produto passa a sair com a referencia no cupom e nos dados
                    adicionais da nota enviada ao OMIE, e o peso liquido dela baixa do saldo do
                    quadro abaixo. A nota e por produto: a de rachao nao vale para a brita. Deixe o
                    produto em branco para valer para qualquer produto do cliente.
                  </p>
                  <p style={styles.formHint}>
                    Pode cadastrar quantas notas o cliente tiver — uma linha por nota. Elas sao
                    consumidas da mais antiga para a mais nova: quando o saldo de uma zera, a
                    proxima do mesmo produto assume sozinha, e a esgotada fica no quadro como
                    historico do que ja foi entregue. Sem o total em quilos a nota nao controla
                    saldo e carimba TODA pesagem ate alguem remove-la.
                  </p>
                  {editingId ? (
                    <div style={{ display: "grid", gap: "8px" }}>
                      <div style={styles.fieldRow}>
                        <Field label="Produto">
                          {/*
                            Comeca sem escolha de proposito. A nota de entrega futura e
                            emitida POR PRODUTO, e "qualquer produto" carimba tambem o que
                            nao foi faturado naquela nota — escolha que tem de ser
                            deliberada, nao o que sai de um Salvar apressado.
                          */}
                          <OptionSearchPicker
                            options={[
                              {
                                id: FUTURE_BILLING_ANY_PRODUCT,
                                label: "Qualquer produto do cliente"
                              },
                              ...products.map((product) => ({
                                id: product.id,
                                label: `${product.code ? `${product.code} - ` : ""}${product.description}`
                              }))
                            ]}
                            value={futureBillingProductId}
                            onChange={setFutureBillingProductId}
                            placeholder="Buscar produto da nota..."
                            leadingOption={{ id: "", label: "Selecione o produto da nota" }}
                            inputStyle={getInputStyle(false)}
                          />
                        </Field>
                        <NumberInput
                          label="Numero da NF-e"
                          value={futureBillingNfeNumber}
                          onChange={setFutureBillingNfeNumber}
                          disabled={false}
                          hint="Numero da nota ja emitida (so digitos)."
                        />
                        <NumberInput
                          label="Total da nota (kg)"
                          value={futureBillingTotalWeightKg}
                          onChange={setFutureBillingTotalWeightKg}
                          disabled={false}
                          hint="Quanto a nota faturou, em quilos (30 t = 30000). Vazio = sem controle de saldo."
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleSaveFutureBillingInvoice()}
                        disabled={savingFutureBilling}
                        style={styles.secondaryButton}
                      >
                        {savingFutureBilling ? "Salvando..." : "Salvar nota de entrega futura"}
                      </button>
                      {futureBillingInvoices.length === 0 ? (
                        <p style={styles.cellMuted}>
                          Nenhuma nota de entrega futura cadastrada. As pesagens saem normais.
                        </p>
                      ) : (
                        <div style={styles.futureBillingBoard}>
                          {/*
                            O quadro de controle: quanto a nota faturou, quanto ja saiu e
                            quanto falta. E a conta que antes vivia numa planilha ao lado da
                            balanca — por isso as tres colunas ficam lado a lado, na mesma
                            linha do numero da nota.
                          */}
                          <div style={styles.futureBillingHeaderRow}>
                            <span>Nota</span>
                            <span style={styles.futureBillingNumberCell}>Total</span>
                            <span style={styles.futureBillingNumberCell}>Ja tirado</span>
                            <span style={styles.futureBillingNumberCell}>Saldo</span>
                            <span />
                          </div>
                          {futureBillingInvoices.map((invoice) => {
                            const saldo = invoice.remainingWeightKg;
                            const esgotada = saldo !== null && saldo <= 0;
                            return (
                              <div key={invoice.id} style={styles.futureBillingRow}>
                                <span>
                                  <strong>NF-e {invoice.nfeNumber}</strong>
                                  <span style={styles.futureBillingProduct}>
                                    {invoice.productDescription ?? "Qualquer produto"}
                                  </span>
                                </span>
                                <span style={styles.futureBillingNumberCell}>
                                  {invoice.totalWeightKg === null
                                    ? "—"
                                    : formatKgAmount(invoice.totalWeightKg)}
                                </span>
                                <span style={styles.futureBillingNumberCell}>
                                  {formatKgAmount(invoice.withdrawnWeightKg)}
                                </span>
                                <span
                                  style={{
                                    ...styles.futureBillingNumberCell,
                                    fontWeight: 700,
                                    // Saldo zerado (ou estourado) e a informacao que faz o
                                    // operador abrir a proxima nota: nao pode passar batido
                                    // no meio de tres numeros iguais.
                                    color: esgotada ? "#b91c1c" : "var(--kr-text-strong)"
                                  }}
                                >
                                  {saldo === null ? "sem controle" : formatKgAmount(saldo)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleRemoveFutureBillingInvoice(invoice.id)}
                                  style={styles.dangerButton}
                                >
                                  Remover
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={styles.cellMuted}>
                      Salve o cliente antes de cadastrar a nota de entrega futura.
                    </p>
                  )}
                </section>
              ) : null}

              {activeFormSection === "endereco" ? (
                <section style={styles.formSection}>
                  <h4 style={styles.formSectionTitle}>Endereco</h4>
                  <div style={styles.fieldRow}>
                    <CepInput
                      label="CEP"
                      value={form.zipcode}
                      onChange={(zipcode) => setForm({ ...form, zipcode })}
                      onLookup={handleCepLookup}
                      onAddressFound={handleCepAddressFound}
                      disabled={false}
                    />
                    <TextInput
                      label="Numero"
                      value={form.addressNumber}
                      onChange={(addressNumber) => setForm({ ...form, addressNumber })}
                      disabled={false}
                      hint="Opcional"
                    />
                  </div>
                  <TextInput
                    label="Endereco"
                    value={form.addressStreet}
                    onChange={(addressStreet) => setForm({ ...form, addressStreet })}
                    disabled={false}
                    placeholder="Rua / avenida"
                  />
                  <div style={styles.fieldRow}>
                    <TextInput
                      label="Bairro"
                      value={form.neighborhood}
                      onChange={(neighborhood) => setForm({ ...form, neighborhood })}
                      disabled={false}
                    />
                    <TextInput
                      label="Complemento"
                      value={form.addressComplement}
                      onChange={(addressComplement) => setForm({ ...form, addressComplement })}
                      disabled={false}
                    />
                  </div>
                  <div style={styles.fieldRow}>
                    <TextInput
                      label="Cidade"
                      value={form.city}
                      onChange={(city) => setForm({ ...form, city })}
                      disabled={false}
                    />
                    <Field label="UF">
                      <input
                        type="text"
                        inputMode="text"
                        autoComplete="off"
                        disabled={false}
                        value={form.state}
                        placeholder="SP"
                        onChange={(e) =>
                          setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })
                        }
                        style={getInputStyle(false)}
                        maxLength={2}
                      />
                    </Field>
                  </div>
                </section>
              ) : null}

              {activeFormSection === "comercial" ? (
                <section style={styles.formSection}>
                  <h4 style={styles.formSectionTitle}>Comercial</h4>
                  <PriceMasterNotice
                    authority={priceAuthority}
                    what="Os dados comerciais e as regras de credito do cliente"
                  />
                  <Field
                    label="Forma de pagamento padrao"
                    hint={
                      commercialIsReadOnly
                        ? priceMasterHint(priceAuthority.masterDeviceName)
                        : "Puxada automaticamente na Nova entrada (pode ser trocada)"
                    }
                  >
                    <OptionSearchPicker
                      options={paymentMethods.map((method) => ({
                        id: method.id,
                        label: method.name
                      }))}
                      value={form.defaultPaymentMethodId}
                      onChange={(id) => setForm({ ...form, defaultPaymentMethodId: id })}
                      placeholder="Buscar forma de pagamento..."
                      leadingOption={{ id: "", label: "Selecione" }}
                      disabled={commercialIsReadOnly}
                      inputStyle={getInputStyle(commercialIsReadOnly)}
                    />
                  </Field>
                  <Field
                    label="Condicao de pagamento padrao"
                    hint="Vazio = sem padrao. Se nao existir no OMIE, e criada automaticamente no envio."
                  >
                    <input
                      type="text"
                      value={defaultConditionText}
                      onChange={(e) => setDefaultConditionText(e.target.value)}
                      placeholder='Ex.: "30", "7 14 21", "3 parcelas" ou "s+20"'
                      style={getInputStyle(false)}
                    />
                  </Field>
                  <PaymentConditionLegend
                    value={defaultConditionText}
                    style={{ marginBottom: "6px" }}
                  />
                  <Field
                    label="Transportadora padrao"
                    hint={
                      commercialIsReadOnly
                        ? priceMasterHint(priceAuthority.masterDeviceName)
                        : "Puxada automaticamente na Nova entrada. Vincular uma transportadora na aba Transportadoras ja assume o padrao quando ele ainda nao foi definido."
                    }
                  >
                    <OptionSearchPicker
                      options={defaultCarrierOptions.map((carrier) => ({
                        id: carrier.id,
                        label: carrier.name,
                        badge: linkedCarrierIds.includes(carrier.id) ? "vinculada" : null
                      }))}
                      value={form.defaultCarrierId}
                      onChange={(id) => setForm({ ...form, defaultCarrierId: id })}
                      placeholder="Buscar transportadora..."
                      leadingOption={{ id: "", label: "Sem transportadora padrao" }}
                      disabled={commercialIsReadOnly}
                      inputStyle={getInputStyle(commercialIsReadOnly)}
                    />
                  </Field>
                  <label style={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={form.creditAccountEnabled}
                      onChange={(e) => setForm({ ...form, creditAccountEnabled: e.target.checked })}
                      disabled={commercialIsReadOnly}
                    />
                    Habilitar credito do cliente
                  </label>
                  {form.creditAccountEnabled ? (
                    <div style={{ display: "grid", gap: "8px" }}>
                      <Field label="Periodicidade do fechamento">
                        <select
                          value={form.creditPeriodicity}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              creditPeriodicity: e.target.value as "monthly" | "biweekly" | "weekly"
                            })
                          }
                          disabled={commercialIsReadOnly}
                          style={getInputStyle(commercialIsReadOnly)}
                        >
                          <option value="monthly">Mensal</option>
                          <option value="biweekly">Quinzenal</option>
                          <option value="weekly">Semanal</option>
                        </select>
                      </Field>

                      {form.creditPeriodicity === "weekly" ? (
                        <div
                          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}
                        >
                          <Field label="Dia da semana do fechamento">
                            <select
                              value={form.creditClosingWeekday}
                              onChange={(e) =>
                                setForm({ ...form, creditClosingWeekday: e.target.value })
                              }
                              disabled={commercialIsReadOnly}
                              style={getInputStyle(commercialIsReadOnly)}
                            >
                              <option value="">Selecione...</option>
                              <option value="1">Segunda-feira</option>
                              <option value="2">Terca-feira</option>
                              <option value="3">Quarta-feira</option>
                              <option value="4">Quinta-feira</option>
                              <option value="5">Sexta-feira</option>
                              <option value="6">Sabado</option>
                              <option value="0">Domingo</option>
                            </select>
                          </Field>
                          <Field label="Dias p/ vencimento do boleto" hint="Apos o fechamento">
                            <input
                              type="number"
                              min={0}
                              value={form.creditBoletoDays}
                              onChange={(e) =>
                                setForm({ ...form, creditBoletoDays: e.target.value })
                              }
                              disabled={commercialIsReadOnly}
                              style={getInputStyle(commercialIsReadOnly)}
                              placeholder="Ex: 3"
                            />
                          </Field>
                        </div>
                      ) : (
                        <div
                          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}
                        >
                          <Field
                            label={
                              form.creditPeriodicity === "biweekly"
                                ? "1o dia de fechamento"
                                : "Dia de fechamento"
                            }
                            hint="Dia do mes (1 a 31)"
                          >
                            <input
                              type="number"
                              min={1}
                              max={31}
                              value={form.creditClosingDay}
                              onChange={(e) =>
                                setForm({ ...form, creditClosingDay: e.target.value })
                              }
                              disabled={commercialIsReadOnly}
                              style={getInputStyle(commercialIsReadOnly)}
                              placeholder={
                                form.creditPeriodicity === "biweekly" ? "Ex: 1" : "Ex: 30"
                              }
                            />
                          </Field>
                          <Field
                            label={
                              form.creditPeriodicity === "biweekly"
                                ? "Dias p/ vencimento (1o)"
                                : "Dias p/ vencimento do boleto"
                            }
                            hint="Apos o fechamento"
                          >
                            <input
                              type="number"
                              min={0}
                              value={form.creditBoletoDays}
                              onChange={(e) =>
                                setForm({ ...form, creditBoletoDays: e.target.value })
                              }
                              disabled={commercialIsReadOnly}
                              style={getInputStyle(commercialIsReadOnly)}
                              placeholder="Ex: 10"
                            />
                          </Field>

                          {form.creditPeriodicity === "biweekly" ? (
                            <>
                              <Field label="2o dia de fechamento" hint="Dia do mes (1 a 31)">
                                <input
                                  type="number"
                                  min={1}
                                  max={31}
                                  value={form.creditSecondClosingDay}
                                  onChange={(e) =>
                                    setForm({ ...form, creditSecondClosingDay: e.target.value })
                                  }
                                  disabled={commercialIsReadOnly}
                                  style={getInputStyle(commercialIsReadOnly)}
                                  placeholder="Ex: 16"
                                />
                              </Field>
                              <Field
                                label="Dias p/ vencimento (2o)"
                                hint="Apos o segundo fechamento"
                              >
                                <input
                                  type="number"
                                  min={0}
                                  value={form.creditSecondBoletoDays}
                                  onChange={(e) =>
                                    setForm({ ...form, creditSecondBoletoDays: e.target.value })
                                  }
                                  disabled={commercialIsReadOnly}
                                  style={getInputStyle(commercialIsReadOnly)}
                                  placeholder="Ex: 10"
                                />
                              </Field>
                            </>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ) : null}
                  <Field label="Uso de credito OMIE">
                    <select
                      value={form.creditMode}
                      onChange={(e) =>
                        setForm({ ...form, creditMode: e.target.value as "normal" | "prepaid" })
                      }
                      disabled={commercialIsReadOnly}
                      style={getInputStyle(commercialIsReadOnly)}
                    >
                      <option value="normal">Nao debitar credito</option>
                      <option value="prepaid">Debitar credito pre-pago</option>
                    </select>
                  </Field>
                  <label style={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={form.nfRequired}
                      onChange={(e) => setForm({ ...form, nfRequired: e.target.checked })}
                      disabled={commercialIsReadOnly}
                    />
                    Exige nota fiscal
                  </label>
                  <Field label="Observacoes internas" hint="Visivel apenas para a operacao">
                    <textarea
                      value={form.observations}
                      onChange={(e) => setForm({ ...form, observations: e.target.value })}
                      rows={3}
                      style={{ ...getInputStyle(false), resize: "vertical", minHeight: "60px" }}
                      placeholder="Anotacoes internas"
                    />
                  </Field>
                </section>
              ) : null}

              {activeFormSection === "credito" ? (
                <section style={styles.formSection}>
                  <h4 style={styles.formSectionTitle}>Credito do cliente</h4>
                  {editingId ? (
                    <div style={{ display: "grid", gap: "10px" }}>
                      <p style={styles.cellMuted}>
                        O adiantamento e o dinheiro que o cliente ja depositou. Ele e lancado no
                        financeiro do OMIE (contas a receber na categoria de adiantamento) e chega
                        aqui pela sincronizacao — nao ha lancamento de credito pelo KyberRock. Cada
                        compra e abatida desse saldo e baixada no OMIE; o limite de credito (aba
                        Identificacao) banca o que passar do adiantamento, no fiado.
                      </p>
                      <div style={styles.fieldRow}>
                        <CreditTotal
                          label="Adiantamento (OMIE)"
                          value={formatMoney(creditSummary?.omieAdvanceCents ?? 0)}
                        />
                        <CreditTotal
                          label="Limite de credito"
                          value={
                            creditSummary?.creditLimitCents != null
                              ? formatMoney(creditSummary.creditLimitCents)
                              : "Sem limite"
                          }
                        />
                        <CreditTotal
                          label="Utilizado"
                          value={formatMoney(creditSummary?.usedCents ?? 0)}
                        />
                        <CreditTotal
                          label="Disponivel"
                          value={
                            creditSummary?.availableCents != null
                              ? formatMoney(creditSummary.availableCents)
                              : "Sem limite"
                          }
                          strong
                        />
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          flexWrap: "wrap"
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => void handleSyncAdvances()}
                          disabled={creditBusy}
                          style={{ ...styles.secondaryButton, opacity: creditBusy ? 0.6 : 1 }}
                        >
                          {creditBusy ? "Sincronizando..." : "Sincronizar adiantamentos (OMIE)"}
                        </button>
                        <span style={styles.cellMuted}>
                          {creditSummary?.omieSyncedAt
                            ? `Ultimo adiantamento do OMIE: ${formatDbDateTime(creditSummary.omieSyncedAt)}`
                            : "Nenhum adiantamento vindo do OMIE ate agora."}
                        </span>
                      </div>
                      <h4 style={styles.formSectionTitle}>Extrato</h4>
                      <div style={styles.compactScrollList}>
                        {creditMovements.length === 0 ? (
                          <p style={styles.cellMuted}>Nenhum lancamento de credito ate agora.</p>
                        ) : (
                          creditMovements.map((movement) => (
                            <div
                              key={movement.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: "10px",
                                padding: "6px 8px",
                                borderRadius: "8px",
                                background: "var(--kr-surface)",
                                border: "1px solid var(--kr-border)",
                                fontSize: "12px"
                              }}
                            >
                              <span style={{ color: "var(--kr-text-strong)", fontWeight: 700 }}>
                                {creditMovementLabel(movement)}
                                {movement.source === "omie" ? (
                                  <span
                                    style={{
                                      marginLeft: "6px",
                                      padding: "1px 6px",
                                      borderRadius: "999px",
                                      border: "1px solid var(--kr-border)",
                                      color: "var(--kr-muted)",
                                      fontSize: "10px",
                                      fontWeight: 700
                                    }}
                                  >
                                    OMIE
                                  </span>
                                ) : null}
                                {movement.reason ? (
                                  <span style={{ fontWeight: 400 }}>
                                    {" "}
                                    &mdash; {movement.reason}
                                  </span>
                                ) : null}
                              </span>
                              <span style={{ whiteSpace: "nowrap", color: "var(--kr-muted)" }}>
                                {movement.created_at.slice(0, 10).split("-").reverse().join("/")}{" "}
                                <strong style={{ color: "var(--kr-text-strong)" }}>
                                  {formatMoney(creditMovementSignedCents(movement))}
                                </strong>
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : (
                    <p style={styles.cellMuted}>Salve o cliente antes de lancar credito.</p>
                  )}
                </section>
              ) : null}

              {activeFormSection === "transporte" ? (
                <section style={styles.formSection}>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <h4 style={styles.formSectionTitle}>Transporte</h4>
                    {editingId ? (
                      <>
                        <Field
                          label="Tipo de frete"
                          hint="Preenche a nova entrada quando este cliente e escolhido. O operador ainda pode trocar na operacao."
                        >
                          <select
                            value={transport?.defaultFreightModality ?? ""}
                            disabled={transportBusy || !desktopApi}
                            onChange={(event) => {
                              const value = event.target.value || null;
                              void applyTransport(
                                () => desktopApi!.customerTransportSetFreight(editingId, value),
                                editingId
                              );
                            }}
                            style={getInputStyle(false)}
                          >
                            <option value="">Sem padrao (escolher na entrada)</option>
                            <optgroup label="Com frete">
                              {FREIGHT_MODALITIES.filter(
                                (modality) => modality.group === "with_freight"
                              ).map((modality) => (
                                <option key={modality.key} value={modality.key}>
                                  {modality.label}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="Sem frete">
                              {FREIGHT_MODALITIES.filter(
                                (modality) => modality.group === "without_freight"
                              ).map((modality) => (
                                <option key={modality.key} value={modality.key}>
                                  {modality.label}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </Field>

                        {/*
                          Transporte proprio grava a TRANSPORTADORA PADRAO do cliente, que
                          e um campo da balanca principal — por isso o aviso aparece aqui,
                          e nao no tipo de frete logo acima, que continua livre.
                        */}
                        <PriceMasterNotice
                          authority={priceAuthority}
                          what="A transportadora padrao do cliente"
                        />
                        <label style={styles.checkbox}>
                          <input
                            type="checkbox"
                            checked={transport?.isOwnTransport ?? false}
                            disabled={transportBusy || !desktopApi || commercialIsReadOnly}
                            onChange={(event) => {
                              const enabled = event.target.checked;
                              void applyTransport(
                                () =>
                                  desktopApi!.customerTransportSetOwnCarrier(editingId, enabled),
                                editingId
                              );
                            }}
                          />
                          Transporte proprio (o cliente carrega no proprio caminhao)
                        </label>
                        <p style={styles.cellMuted}>
                          Usa a transportadora com o nome e o CNPJ/CPF deste cliente. Se ela ainda
                          nao existir, e criada e passa a ser a transportadora padrao dele.
                        </p>

                        <div style={{ display: "grid", gap: "6px" }}>
                          <Field label="Transportadoras">
                            <OptionSearchPicker
                              options={carriers
                                .filter((carrier) => !linkedCarrierIds.includes(carrier.id))
                                .map((carrier) => ({ id: carrier.id, label: carrier.name }))}
                              value=""
                              onChange={(id) => {
                                if (!id) return;
                                void handleToggleCarrier(id);
                              }}
                              placeholder="Buscar transportadora para vincular..."
                              inputStyle={getInputStyle(false)}
                            />
                          </Field>
                          {linkedCarrierIds.length === 0 ? (
                            <p style={styles.cellMuted}>Nenhuma transportadora vinculada.</p>
                          ) : (
                            (transport?.carriers ?? []).map((carrier) => (
                              <div key={carrier.id} style={transportRowStyle}>
                                <span style={styles.cellMuted}>
                                  <strong>{carrier.name}</strong>
                                  {carrier.id === transport?.defaultCarrierId ? " (padrao)" : ""}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleToggleCarrier(carrier.id)}
                                  style={styles.dangerButton}
                                >
                                  Remover
                                </button>
                              </div>
                            ))
                          )}
                        </div>

                        <div style={{ display: "grid", gap: "6px" }}>
                          <Field
                            label="Placas deste cliente"
                            hint="A nova entrada abre o campo Placa ja com estas. Digitando, ela volta a mostrar todas."
                          >
                            <div style={{ display: "flex", gap: "6px" }}>
                              <input
                                type="text"
                                value={plateInput}
                                onChange={(event) => {
                                  const value = event.target.value.toUpperCase();
                                  setPlateInput(value);
                                  void loadPlateSuggestions(value);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter") return;
                                  // Enter num formulario submeteria o cadastro inteiro.
                                  event.preventDefault();
                                  void handleAddPlate(editingId);
                                }}
                                placeholder="ABC1D23"
                                style={{ ...getInputStyle(false), flex: 1 }}
                              />
                              <button
                                type="button"
                                onClick={() => void handleAddPlate(editingId)}
                                disabled={transportBusy || !plateInput.trim()}
                                style={{
                                  ...styles.secondaryButton,
                                  opacity: transportBusy || !plateInput.trim() ? 0.5 : 1
                                }}
                              >
                                Adicionar
                              </button>
                            </div>
                          </Field>
                          {plateSuggestions.length > 0 ? (
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              {plateSuggestions.map((suggestion) => (
                                <button
                                  key={suggestion.id}
                                  type="button"
                                  onClick={() => {
                                    setPlateInput(suggestion.plate);
                                    setPlateSuggestions([]);
                                  }}
                                  style={styles.secondaryButton}
                                >
                                  {suggestion.plate}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {(transport?.plates.length ?? 0) === 0 ? (
                            <p style={styles.cellMuted}>
                              Nenhuma placa vinculada &mdash; a nova entrada segue oferecendo todas
                              as placas da pedreira.
                            </p>
                          ) : (
                            (transport?.plates ?? []).map((plate) => (
                              <div key={plate.id} style={transportRowStyle}>
                                <span style={styles.cellMuted}>
                                  <strong>{plate.plate}</strong>
                                  {plate.description ? ` - ${plate.description}` : ""}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleRemovePlate(editingId, plate.id)}
                                  style={styles.dangerButton}
                                >
                                  Remover
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    ) : (
                      <p style={styles.cellMuted}>
                        Salve o cliente antes de cadastrar o transporte dele.
                      </p>
                    )}
                  </div>
                </section>
              ) : null}

              {activeFormSection === "frete" ? (
                <section style={styles.formSection}>
                  <div style={{ display: "grid", gap: "8px" }}>
                    <h4 style={styles.formSectionTitle}>Frete do cliente</h4>
                    <PriceMasterNotice
                      authority={priceAuthority}
                      what="Os valores de frete do cadastro"
                    />
                    {editingId ? (
                      <>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={() => setFreightMode("default")}
                            style={{
                              flex: 1,
                              padding: "6px 10px",
                              border:
                                freightMode === "default"
                                  ? "2px solid var(--kr-accent)"
                                  : "1px solid var(--kr-border)",
                              borderRadius: "8px",
                              background:
                                freightMode === "default"
                                  ? "var(--kr-accent-soft)"
                                  : "var(--kr-surface)",
                              color:
                                freightMode === "default"
                                  ? "var(--kr-info-text)"
                                  : "var(--kr-muted)",
                              fontWeight: freightMode === "default" ? 700 : 500,
                              fontSize: "12px",
                              cursor: "pointer"
                            }}
                          >
                            Frete fixo
                          </button>
                          <button
                            type="button"
                            onClick={() => setFreightMode("product")}
                            style={{
                              flex: 1,
                              padding: "6px 10px",
                              border:
                                freightMode === "product"
                                  ? "2px solid var(--kr-accent)"
                                  : "1px solid var(--kr-border)",
                              borderRadius: "8px",
                              background:
                                freightMode === "product"
                                  ? "var(--kr-accent-soft)"
                                  : "var(--kr-surface)",
                              color:
                                freightMode === "product"
                                  ? "var(--kr-info-text)"
                                  : "var(--kr-muted)",
                              fontWeight: freightMode === "product" ? 700 : 500,
                              fontSize: "12px",
                              cursor: "pointer"
                            }}
                          >
                            Por produto
                          </button>
                        </div>
                        <div style={styles.fieldRow}>
                          {freightMode === "product" ? (
                            <Field label="Produto">
                              <OptionSearchPicker
                                options={products.map((product) => ({
                                  id: product.id,
                                  label: `${product.code ? `${product.code} - ` : ""}${product.description}`
                                }))}
                                value={freightProductId}
                                onChange={setFreightProductId}
                                placeholder="Buscar produto..."
                                leadingOption={{ id: "", label: "Selecione" }}
                                inputStyle={getInputStyle(false)}
                              />
                            </Field>
                          ) : null}
                          <Field
                            label="Tipo de frete"
                            hint="O valor vale para esse tipo de frete na Nova entrada. 'Qualquer tipo' cobre os tipos que nao tem valor proprio."
                          >
                            <select
                              value={freightModality}
                              onChange={(e) =>
                                setFreightModality(e.target.value as FreightModality | "")
                              }
                              style={getInputStyle(false)}
                            >
                              <option value="">Qualquer tipo</option>
                              {FREIGHT_MODALITIES.filter((modality) => modality.supportsCharge).map(
                                (modality) => (
                                  <option key={modality.key} value={modality.key}>
                                    {modality.label}
                                  </option>
                                )
                              )}
                            </select>
                          </Field>
                          <MoneyInput
                            label="Valor/ton (R$)"
                            value={freightValueReais}
                            onChange={setFreightValueReais}
                            allowZero={false}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleSaveFreightRule()}
                          disabled={savingFreight || pricesAreReadOnly}
                          style={{
                            ...styles.secondaryButton,
                            opacity: savingFreight || pricesAreReadOnly ? 0.5 : 1
                          }}
                        >
                          {savingFreight ? "Salvando..." : "Salvar frete"}
                        </button>
                        {customerFreightEntries.length === 0 ? (
                          <p style={styles.cellMuted}>Nenhum frete cadastrado.</p>
                        ) : (
                          customerFreightEntries.map((entry) => (
                            <div
                              key={`${entry.ruleId}:${entry.modality ?? "any"}`}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: "8px",
                                borderTop: "1px solid var(--kr-border)",
                                paddingTop: "8px"
                              }}
                            >
                              <span style={styles.cellMuted}>
                                <strong>{entry.scopeLabel}</strong>
                                {" - "}
                                {entry.modalityLabel}: {formatMoney(entry.baseValueCents)}/ton
                                {entry.source === "last_used" ? (
                                  <em style={{ marginLeft: "6px" }}>(ultima venda)</em>
                                ) : null}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleRemoveFreightRule(entry.ruleId, entry.modality)
                                }
                                disabled={pricesAreReadOnly}
                                style={{
                                  ...styles.dangerButton,
                                  opacity: pricesAreReadOnly ? 0.5 : 1
                                }}
                              >
                                Remover
                              </button>
                            </div>
                          ))
                        )}
                      </>
                    ) : (
                      <p style={styles.cellMuted}>Salve o cliente antes de cadastrar frete.</p>
                    )}
                  </div>
                </section>
              ) : null}

              {activeFormSection === "precos" ? (
                <section style={styles.formSection}>
                  <div style={{ display: "grid", gap: "8px" }}>
                    <h4 style={styles.formSectionTitle}>Precos especiais</h4>
                    <PriceMasterNotice authority={priceAuthority} what="Os precos especiais" />
                    {editingId ? (
                      <>
                        <div style={styles.fieldRow}>
                          <Field label="Produto">
                            <OptionSearchPicker
                              options={products.map((product) => ({
                                id: product.id,
                                label: `${product.code ? `${product.code} - ` : ""}${product.description}`
                              }))}
                              value={specialProductId}
                              onChange={setSpecialProductId}
                              placeholder="Buscar produto..."
                              leadingOption={{ id: "", label: "Selecione" }}
                              inputStyle={getInputStyle(false)}
                            />
                          </Field>
                          <MoneyInput
                            label="Preco/ton (R$)"
                            value={specialPriceReais}
                            onChange={setSpecialPriceReais}
                            allowZero={false}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleSaveSpecialPrice()}
                          disabled={pricesAreReadOnly}
                          style={{
                            ...styles.secondaryButton,
                            opacity: pricesAreReadOnly ? 0.5 : 1
                          }}
                        >
                          Salvar preco especial
                        </button>
                        {specialPrices.length === 0 ? (
                          <p style={styles.cellMuted}>Nenhum preco especial cadastrado.</p>
                        ) : (
                          specialPrices.map((price) => (
                            <div
                              key={price.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: "8px",
                                borderTop: "1px solid var(--kr-border)",
                                paddingTop: "8px"
                              }}
                            >
                              <span style={styles.cellMuted}>
                                <strong>{price.productDescription}</strong>
                                {price.productCode ? ` (${price.productCode})` : ""}:{" "}
                                {formatMoney(price.unitPriceCents)}/ton
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleRemoveSpecialPrice(price.productId)}
                                disabled={pricesAreReadOnly}
                                style={{
                                  ...styles.dangerButton,
                                  opacity: pricesAreReadOnly ? 0.5 : 1
                                }}
                              >
                                Remover
                              </button>
                            </div>
                          ))
                        )}
                      </>
                    ) : (
                      <p style={styles.cellMuted}>
                        Salve o cliente antes de cadastrar preco especial.
                      </p>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
            <div style={styles.formFooter}>
              <button
                type="button"
                onClick={() => void requestCloseForm()}
                style={styles.secondaryButton}
              >
                Cancelar
              </button>
              <div style={{ display: "flex", gap: "8px" }}>
                {editingId ? (
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(editingId)}
                    style={styles.dangerButton}
                  >
                    Excluir
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  style={{
                    ...styles.primaryButton,
                    opacity: saving ? 0.7 : 1,
                    cursor: saving ? "wait" : "pointer"
                  }}
                >
                  {saving ? "Salvando..." : editingId ? "Salvar alteracoes" : "Cadastrar cliente"}
                </button>
              </div>
            </div>
          </Fragment>
        </CrudFormModal>
      ) : null}

      {viewingCustomer && !showForm ? (
        <RecordDetailModal
          title={viewingCustomer.tradeName || viewingCustomer.legalName}
          subtitle="Visualizacao do cliente"
          badge={
            <>
              <SourceBadge source={viewingCustomer.source} />
              {viewingCustomer.omieBillingBlocked ? (
                <span
                  style={{
                    ...styles.pill("#b91c1c", "#fee2e2"),
                    width: "fit-content"
                  }}
                >
                  Bloqueado
                </span>
              ) : null}
            </>
          }
          sections={buildCustomerDetailSections(viewingCustomer)}
          maxWidth={1040}
          onClose={() => setViewingCustomer(null)}
          onEdit={() => openEditForm(viewingCustomer)}
        />
      ) : null}

      {confirmElement}

      {pendingDeleteId ? (
        <ConfirmDialog
          title="Excluir cliente"
          description="O cadastro sai das telas, inclusive do filtro por cliente do Fechamento. As pesagens dele nao sao apagadas, e da para restaurar depois na secao Excluidos. Cliente com pesagem em aberto ou por faturar nao pode ser excluido."
          busy={deleting}
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      ) : null}

      {pendingSpecialPriceAction ? (
        <PriceChangePasswordDialog
          error={pricePasswordError}
          submitting={savingSpecialPrice}
          onCancel={() => {
            setPendingSpecialPriceAction(null);
            setPricePasswordError(null);
          }}
          onSubmit={(password) => void handleConfirmSpecialPrice(password)}
        />
      ) : null}

      {standaloneForm ? null : (
        <DataTable
          columns={[
            {
              key: "customer",
              header: "Cliente",
              width: "minmax(200px, 1.4fr)",
              render: (customer: CustomerCacheEntry) => (
                <>
                  <CellPrimary>{customer.tradeName || customer.legalName}</CellPrimary>
                  <CellMuted>{customer.legalName}</CellMuted>
                </>
              )
            },
            {
              key: "document",
              header: "Documento",
              width: "minmax(140px, 1fr)",
              render: (customer) => (
                <CellMuted>{formatDocument(customer.document ?? "") || "-"}</CellMuted>
              )
            },
            {
              key: "contact",
              header: "Contato",
              width: "minmax(180px, 1.4fr)",
              render: (customer) => (
                <>
                  <CellPrimary>{formatPhone(customer.phone ?? "") || "-"}</CellPrimary>
                  <CellMuted>{customer.email || "-"}</CellMuted>
                </>
              )
            },
            {
              key: "source",
              header: "Origem / status",
              width: "minmax(130px, 1fr)",
              render: (customer) => (
                <>
                  <SourceBadge source={customer.source} />
                  {customer.isActive ? null : (
                    <span
                      style={{
                        ...styles.pill("#78350f", "#fef3c7"),
                        width: "fit-content",
                        alignSelf: "start"
                      }}
                    >
                      Inativo
                    </span>
                  )}
                  {customer.omieBillingBlocked ? (
                    <span
                      style={{
                        ...styles.pill("#b91c1c", "#fee2e2"),
                        width: "fit-content",
                        alignSelf: "start"
                      }}
                    >
                      Bloqueado
                    </span>
                  ) : null}
                </>
              )
            },
            {
              key: "actions",
              header: "Acoes",
              width: "150px",
              align: "right",
              render: (customer) => (
                <>
                  <EditRowButton onClick={() => openEditForm(customer)} />
                  {customer.isActive ? null : (
                    <Tooltip
                      content="Reativar este cliente (o CNPJ/CPF dele ja esta ocupado por este cadastro)"
                      placement="left"
                    >
                      <button
                        type="button"
                        onClick={() => void handleReactivate(customer)}
                        disabled={togglingBlockId !== null}
                        aria-label="Reativar cliente"
                        style={{
                          border: "1px solid var(--kr-border)",
                          background: "var(--kr-surface)",
                          color: "var(--kr-text-strong)",
                          borderRadius: "8px",
                          padding: "0 8px",
                          height: "30px",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: togglingBlockId ? "wait" : "pointer",
                          flexShrink: 0
                        }}
                      >
                        Reativar
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip
                    content={
                      customer.omieBillingBlocked
                        ? "Liberar o faturamento deste cliente (enviado ao OMIE no proximo sync)"
                        : "Bloquear o faturamento deste cliente (enviado ao OMIE no proximo sync)"
                    }
                    placement="left"
                  >
                    <button
                      type="button"
                      onClick={() => void handleToggleBillingBlocked(customer)}
                      disabled={togglingBlockId !== null}
                      aria-label={
                        customer.omieBillingBlocked ? "Liberar faturamento" : "Bloquear faturamento"
                      }
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "30px",
                        height: "30px",
                        padding: 0,
                        border: customer.omieBillingBlocked
                          ? "1px solid var(--kr-danger-border)"
                          : "1px solid var(--kr-border)",
                        background: customer.omieBillingBlocked
                          ? "var(--kr-danger-soft)"
                          : "var(--kr-surface)",
                        color: customer.omieBillingBlocked ? "var(--kr-danger)" : "var(--kr-muted)",
                        borderRadius: "8px",
                        cursor: togglingBlockId ? "wait" : "pointer",
                        flexShrink: 0,
                        lineHeight: 0,
                        opacity: togglingBlockId === customer.id ? 0.6 : 1
                      }}
                    >
                      {customer.omieBillingBlocked ? <Lock size={15} /> : <Unlock size={15} />}
                    </button>
                  </Tooltip>
                  <DeleteRowButton onClick={() => setPendingDeleteId(customer.id)} />
                </>
              )
            }
          ]}
          rows={customers}
          rowKey={(customer) => customer.id}
          loading={loading}
          onRowOpen={(customer) => setViewingCustomer(customer)}
          emptyTitle={search ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado."}
          emptyHint={
            search
              ? "Ajuste o termo de busca."
              : "Sincronize com o OMIE ou cadastre o primeiro cliente pelo botao 'Novo cliente'."
          }
          minWidth="980px"
          maxHeight="calc(100vh - 380px)"
          footer={
            <div style={styles.pagination}>
              <span>
                {total === 0
                  ? "0 clientes"
                  : `${page * pageSize + 1}-${Math.min(total, (page + 1) * pageSize)} de ${total}`}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={styles.secondaryButton}
                >
                  Anterior
                </button>
                <span>
                  {page + 1}/{totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  style={styles.secondaryButton}
                >
                  Proxima
                </button>
              </div>
            </div>
          }
        />
      )}
      {standaloneForm || deletedCustomers.length === 0 ? null : (
        <div
          style={{
            marginTop: "16px",
            border: "1px solid var(--kr-border)",
            borderRadius: "12px",
            background: "var(--kr-surface)",
            overflow: "hidden"
          }}
        >
          <button
            type="button"
            onClick={() => setShowDeleted((visible) => !visible)}
            aria-expanded={showDeleted}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              border: "none",
              background: "transparent",
              color: "var(--kr-text-strong)",
              padding: "12px 14px",
              cursor: "pointer",
              fontWeight: 800,
              fontSize: "13px"
            }}
          >
            <span>Excluidos ({deletedCustomers.length})</span>
            <span style={{ ...styles.cellMuted, fontWeight: 700 }}>
              {showDeleted ? "Ocultar" : "Mostrar"}
            </span>
          </button>

          {showDeleted ? (
            <div style={{ borderTop: "1px solid var(--kr-border)" }}>
              <p style={{ ...styles.cellMuted, margin: 0, padding: "10px 14px" }}>
                Excluir nunca apaga pesagem: o cadastro so sai das telas e, com ele, o filtro por
                onde o Fechamento chega as cargas dele. Restaurar devolve os dois.
              </p>

              {deletedCustomers.map((customer) => (
                <div
                  key={customer.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    padding: "10px 14px",
                    borderTop: "1px solid var(--kr-border)"
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "13px" }}>{customer.tradeName}</div>
                    <div style={styles.cellMuted}>
                      {formatDocument(customer.document ?? "") || "sem CNPJ/CPF"} · excluido em{" "}
                      {formatDbDateTime(customer.deletedAt)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleRestore(customer)}
                    disabled={restoringId !== null}
                    style={{
                      ...styles.secondaryButton,
                      cursor: restoringId ? "wait" : "pointer",
                      flexShrink: 0
                    }}
                  >
                    {restoringId === customer.id ? "Restaurando..." : "Restaurar"}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Converte um campo de texto numerico para numero, retornando NaN quando vazio/em branco.
 * Number("") e 0, o que fazia campos obrigatorios em branco passarem silenciosamente em
 * validacoes do tipo ">= 0" (ex.: dias do boleto viravam 0, dia da semana virava domingo).
 */
function numberOrNaN(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

function formatDocument(value: string): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return digits;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value / 100);
}
