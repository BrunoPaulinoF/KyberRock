import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, Search, Unlock } from "lucide-react";

import {
  formatMoneyInput,
  isValidDocument,
  isValidEmail,
  normalizeDocument,
  normalizeEmail,
  normalizePhone,
  parseMoneyInputToCents
} from "@kyberrock/shared";

import type { KyberRockDesktopApi } from "../preload/api-types";
import {
  CepInput,
  DocumentInput,
  EmailInput,
  Field,
  MoneyInput,
  PhoneInput,
  TextInput,
  getInputStyle
} from "./inputs";
import type { CepLookupResult } from "./inputs";
import type { CustomerCacheEntry, CustomerFormData } from "./customers.types";
import { CrudFormModal } from "./CrudFormModal";
import { Tooltip } from "./Tooltip";
import { extractConditionRaw, resolveConditionTermId } from "./payment-condition-helpers";
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

const initialForm: CustomerFormData = {
  tradeName: "",
  legalName: "",
  document: "",
  phone: "",
  email: "",
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
interface PaymentTermOption {
  id: string;
  name: string;
  rulesJson?: string;
}

// Secoes do formulario de cliente, navegadas por botoes (uma visivel por vez).
const CUSTOMER_FORM_SECTIONS = [
  { key: "identificacao", label: "Identificacao" },
  { key: "contato", label: "Contato" },
  { key: "endereco", label: "Endereco" },
  { key: "comercial", label: "Comercial" },
  { key: "transportadoras", label: "Transportadoras" },
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

export function CustomersView({
  desktopApi,
  initialSearch
}: {
  desktopApi: KyberRockDesktopApi | null;
  /** Busca inicial (ex.: nome do cliente vindo da tela de operacoes concluidas). */
  initialSearch?: string;
}) {
  const [customers, setCustomers] = useState<CustomerCacheEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerFormData>(initialForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, showFlash] = useFlash();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingBlockId, setTogglingBlockId] = useState<string | null>(null);
  // Visualizacao do cliente (duplo clique na linha) com botao "Editar".
  const [viewingCustomer, setViewingCustomer] = useState<CustomerCacheEntry | null>(null);
  // Snapshot do formulario ao abrir, para avisar antes de descartar alteracoes.
  const formBaselineRef = useRef<string>("");
  const { confirmElement, requestConfirm } = useConfirm();

  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermOption[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  // Condicao de pagamento padrao digitada ("5", "7 14 21", "7/14/21"); resolvida
  // para um payment_term local no salvar.
  const [defaultConditionText, setDefaultConditionText] = useState("");
  const [activeFormSection, setActiveFormSection] =
    useState<CustomerFormSectionKey>("identificacao");
  const [cnpjBusy, setCnpjBusy] = useState(false);
  const [nfeEmail, setNfeEmail] = useState("");
  const [nfeEmailBusy, setNfeEmailBusy] = useState(false);
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
  const [customerFreightRules, setCustomerFreightRules] = useState<Array<{
    id: string;
    customerId: string;
    productId: string | null;
    productDescription: string | null;
    rule: { id: string; name: string; type: string; baseValueCents: number; unit: string };
    isActive: boolean;
  }>>([]);
  const [freightProductId, setFreightProductId] = useState("");
  const [freightValueReais, setFreightValueReais] = useState("");
  const [freightMode, setFreightMode] = useState<"default" | "product">("default");
  const [savingFreight, setSavingFreight] = useState(false);

  const pageSize = 50;

  const loadOptions = useCallback(async () => {
    if (!desktopApi) return;
    try {
      const [carriersResult, termsResult, methodsResult, productsResult] = await Promise.all([
        desktopApi.queryCache({ entityType: "carrier", limit: 200 }),
        desktopApi.queryCache({ entityType: "payment_term", limit: 500 }),
        desktopApi.queryCache({ entityType: "payment_method", limit: 200 }),
        desktopApi.queryCache({ entityType: "product", activeOnly: true, limit: 500 })
      ]);
      setCarriers((carriersResult.rows as CarrierOption[]) ?? []);
      setPaymentTerms((termsResult.rows as PaymentTermOption[]) ?? []);
      setPaymentMethods((methodsResult.rows as PaymentMethodOption[]) ?? []);
      setProducts((productsResult.rows as ProductOption[]) ?? []);
    } catch {
      /* ignore */
    }
  }, [desktopApi]);

  const loadCustomers = useCallback(async () => {
    if (!desktopApi) return;
    setLoading(true);
    try {
      const result = await desktopApi.queryCache({
        entityType: "customer",
        search: search || undefined,
        limit: pageSize,
        offset: page * pageSize
      });
      setCustomers((result.rows as CustomerCacheEntry[]) ?? []);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, [desktopApi, page, search]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    setPage(0);
  }, [search]);

  // Abre a tela ja filtrada por um cliente (ex.: "Editar cliente" numa operacao).
  useEffect(() => {
    if (initialSearch && initialSearch.trim()) {
      setSearch(initialSearch.trim());
    }
  }, [initialSearch]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    if (!desktopApi) return;
    void desktopApi
      .getDefaultNfeEmail()
      .then((email) => setNfeEmail(email ?? ""))
      .catch(() => undefined);
  }, [desktopApi]);

  async function handleApplyDefaultNfeEmail(): Promise<void> {
    if (!desktopApi) return;
    const email = nfeEmail.trim();
    if (!email) {
      showFlash("error", "Informe um e-mail padrao antes de aplicar.");
      return;
    }
    setNfeEmailBusy(true);
    try {
      const count = await desktopApi.applyDefaultNfeEmailToAll(email);
      await loadCustomers();
      showFlash(
        "success",
        `E-mail padrao aplicado a ${count} cliente(s). Sera enviado ao OMIE no proximo sync.`
      );
    } catch (err) {
      showFlash("error", err instanceof Error ? err.message : "Falha ao aplicar o e-mail padrao.");
    } finally {
      setNfeEmailBusy(false);
    }
  }

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
    setCustomerFreightRules([]);
    setFreightProductId("");
    setFreightValueReais("");
    setFreightMode("default");
    setDefaultConditionText("");
    setActiveFormSection("identificacao");
  }

  function openCreateForm(): void {
    resetForm();
    formBaselineRef.current = JSON.stringify({ form: initialForm, defaultConditionText: "" });
    setShowForm(true);
  }

  async function requestCloseForm(): Promise<void> {
    const dirty =
      JSON.stringify({ form, defaultConditionText }) !== formBaselineRef.current;
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
  }

  function openEditForm(customer: CustomerCacheEntry): void {
    const nextForm: CustomerFormData = {
      tradeName: customer.tradeName,
      legalName: customer.legalName,
      document: customer.document ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
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
      creditClosingDay:
        customer.creditClosingDay != null ? String(customer.creditClosingDay) : "",
      creditBoletoDays:
        customer.creditBoletoDays != null ? String(customer.creditBoletoDays) : "",
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
    void loadCustomerFreightRules(customer.id);
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

  async function handleToggleCarrier(carrierId: string): Promise<void> {
    if (!desktopApi || !editingId) return;
    try {
      if (linkedCarrierIds.includes(carrierId)) {
        await desktopApi.unlinkCustomerCarrier(editingId, carrierId);
        setLinkedCarrierIds((prev) => prev.filter((id) => id !== carrierId));
      } else {
        await desktopApi.linkCustomerCarrier(editingId, carrierId);
        setLinkedCarrierIds((prev) => [...prev, carrierId]);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao vincular transportadora");
    }
  }

  async function loadCustomerFreightRules(customerId: string): Promise<void> {
    if (!desktopApi) return;
    try {
      const rows = await desktopApi.getCustomerFreightRules(customerId);
      setCustomerFreightRules(rows as typeof customerFreightRules);
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
          rule: {
          id: crypto.randomUUID(),
          name: freightMode === "product" && freightProductId
            ? products.find((p) => p.id === freightProductId)?.description ?? "Frete por produto"
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

  async function handleRemoveFreightRule(ruleId: string): Promise<void> {
    if (!desktopApi || !editingId) return;
    try {
      await desktopApi.removeCustomerFreightRule(ruleId);
      await loadCustomerFreightRules(editingId);
      showFlash("success", "Frete removido.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao remover frete.");
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
    const normalizedEmail = normalizeEmail(form.email);
    if (form.email.trim() && !isValidEmail(normalizedEmail)) {
      setFormError("Email invalido.");
      return;
    }
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
      setFormError('Condicao de pagamento padrao invalida. Use "5", "7 14 21" ou "7/14/21".');
      return;
    }

    setSaving(true);
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
        await desktopApi.customersCreate({
          tradeName: form.tradeName.trim(),
          legalName: form.legalName.trim(),
          document: normalizedDocument || undefined,
          phone: normalizedPhone || undefined,
          email: normalizedEmail || undefined,
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
        showFlash("success", "Cliente criado.");
      }
      setShowForm(false);
      resetForm();
      await loadCustomers();
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
      await loadCustomers();
      showFlash("success", "Cliente excluido.");
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

  const isOmie = editingSource === "omie";

  // Modal de visualizacao: todas as informacoes do cliente agrupadas por secao,
  // espelhando as abas do formulario de edicao.
  function buildCustomerDetailSections(customer: CustomerCacheEntry): DetailSectionData[] {
    const carrierName = customer.defaultCarrierId
      ? carriers.find((carrier) => carrier.id === customer.defaultCarrierId)?.name ?? ""
      : "";
    const termName = customer.defaultPaymentTermId
      ? paymentTerms.find((term) => term.id === customer.defaultPaymentTermId)?.name ?? ""
      : "";
    const methodName = customer.defaultPaymentMethodId
      ? paymentMethods.find((method) => method.id === customer.defaultPaymentMethodId)?.name ?? ""
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

  return (
    <div>
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
        <Field
          label="E-mail padrao de NF-e"
          hint="Usado para emitir NF-e sem depender do e-mail de cada cliente."
        >
          <input
            type="email"
            value={nfeEmail}
            onChange={(e) => setNfeEmail(e.target.value)}
            placeholder="nfe@suaempresa.com.br"
            style={{ ...getInputStyle(false), minWidth: "260px" }}
          />
        </Field>
        <button
          type="button"
          onClick={() => void handleApplyDefaultNfeEmail()}
          disabled={nfeEmailBusy}
          title="Define esse e-mail em TODOS os clientes (e envia ao OMIE no proximo sync)"
          style={{ ...styles.primaryButton, height: "38px", opacity: nfeEmailBusy ? 0.6 : 1 }}
        >
          {nfeEmailBusy ? "Aplicando..." : "Aplicar a todos os clientes"}
        </button>
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
                <EmailInput
                  label="E-mail"
                  value={form.email}
                  onChange={(email) => setForm({ ...form, email })}
                  disabled={false}
                />
              </div>
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
              <Field
                label="Forma de pagamento padrao"
                hint="Puxada automaticamente na Nova entrada (pode ser trocada)"
              >
                <select
                  value={form.defaultPaymentMethodId}
                  onChange={(e) => setForm({ ...form, defaultPaymentMethodId: e.target.value })}
                  style={getInputStyle(false)}
                >
                  <option value="">Selecione</option>
                  {paymentMethods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Condicao de pagamento padrao"
                hint='Digite: "5" (5 parcelas mensais), "7 14 21" ou "7/14/21" (prazos), "A Vista". Vazio = sem padrao. Se nao existir no OMIE, e criada automaticamente no envio.'
              >
                <input
                  type="text"
                  value={defaultConditionText}
                  onChange={(e) => setDefaultConditionText(e.target.value)}
                  placeholder='Ex.: "7/14/21"'
                  style={getInputStyle(false)}
                />
              </Field>
              <label style={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={form.creditAccountEnabled}
                  onChange={(e) => setForm({ ...form, creditAccountEnabled: e.target.checked })}
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
                          creditPeriodicity: e.target.value as
                            | "monthly"
                            | "biweekly"
                            | "weekly"
                        })
                      }
                      style={getInputStyle(false)}
                    >
                      <option value="monthly">Mensal</option>
                      <option value="biweekly">Quinzenal</option>
                      <option value="weekly">Semanal</option>
                    </select>
                  </Field>

                  {form.creditPeriodicity === "weekly" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      <Field label="Dia da semana do fechamento">
                        <select
                          value={form.creditClosingWeekday}
                          onChange={(e) =>
                            setForm({ ...form, creditClosingWeekday: e.target.value })
                          }
                          style={getInputStyle(false)}
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
                          onChange={(e) => setForm({ ...form, creditBoletoDays: e.target.value })}
                          style={getInputStyle(false)}
                          placeholder="Ex: 3"
                        />
                      </Field>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
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
                          onChange={(e) => setForm({ ...form, creditClosingDay: e.target.value })}
                          style={getInputStyle(false)}
                          placeholder={form.creditPeriodicity === "biweekly" ? "Ex: 1" : "Ex: 30"}
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
                          onChange={(e) => setForm({ ...form, creditBoletoDays: e.target.value })}
                          style={getInputStyle(false)}
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
                              style={getInputStyle(false)}
                              placeholder="Ex: 16"
                            />
                          </Field>
                          <Field label="Dias p/ vencimento (2o)" hint="Apos o segundo fechamento">
                            <input
                              type="number"
                              min={0}
                              value={form.creditSecondBoletoDays}
                              onChange={(e) =>
                                setForm({ ...form, creditSecondBoletoDays: e.target.value })
                              }
                              style={getInputStyle(false)}
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
                  style={getInputStyle(false)}
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

          {activeFormSection === "transportadoras" ? (
            <section style={styles.formSection}>
              <div style={{ display: "grid", gap: "8px" }}>
                <h4 style={styles.formSectionTitle}>Transportadoras vinculadas</h4>
                {editingId ? (
                  <div style={styles.compactScrollList}>
                    {carriers.length === 0 ? (
                      <p style={styles.cellMuted}>Nenhuma transportadora cadastrada.</p>
                    ) : (
                      carriers.map((carrier) => (
                        <label key={carrier.id} style={styles.checkbox}>
                          <input
                            type="checkbox"
                            checked={linkedCarrierIds.includes(carrier.id)}
                            onChange={() => void handleToggleCarrier(carrier.id)}
                          />
                          {carrier.name}
                        </label>
                      ))
                    )}
                  </div>
                ) : (
                  <p style={styles.cellMuted}>Salve o cliente antes de vincular transportadoras.</p>
                )}
              </div>
            </section>
          ) : null}

          {activeFormSection === "frete" ? (
            <section style={styles.formSection}>
              <div style={{ display: "grid", gap: "8px" }}>
                <h4 style={styles.formSectionTitle}>Frete do cliente</h4>
                {editingId ? (
                  <>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={() => setFreightMode("default")}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          border: freightMode === "default" ? "2px solid var(--kr-accent)" : "1px solid var(--kr-border)",
                          borderRadius: "8px",
                          background: freightMode === "default" ? "var(--kr-accent-soft)" : "var(--kr-surface)",
                          color: freightMode === "default" ? "var(--kr-info-text)" : "var(--kr-muted)",
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
                          border: freightMode === "product" ? "2px solid var(--kr-accent)" : "1px solid var(--kr-border)",
                          borderRadius: "8px",
                          background: freightMode === "product" ? "var(--kr-accent-soft)" : "var(--kr-surface)",
                          color: freightMode === "product" ? "var(--kr-info-text)" : "var(--kr-muted)",
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
                          <select
                            value={freightProductId}
                            onChange={(e) => setFreightProductId(e.target.value)}
                            style={getInputStyle(false)}
                          >
                            <option value="">Selecione</option>
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.code ? `${product.code} - ` : ""}
                                {product.description}
                              </option>
                            ))}
                          </select>
                        </Field>
                      ) : null}
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
                      disabled={savingFreight}
                      style={{ ...styles.secondaryButton, opacity: savingFreight ? 0.5 : 1 }}
                    >
                      {savingFreight ? "Salvando..." : "Salvar frete"}
                    </button>
                    {customerFreightRules.length === 0 ? (
                      <p style={styles.cellMuted}>Nenhum frete cadastrado.</p>
                    ) : (
                      customerFreightRules.map((rule) => (
                        <div
                          key={rule.id}
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
                            <strong>
                              {rule.productId ? rule.productDescription ?? "Produto" : "Frete fixo"}
                            </strong>
                            : {formatMoney(rule.rule.baseValueCents)}/ton
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleRemoveFreightRule(rule.id)}
                            style={styles.dangerButton}
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
                {editingId ? (
                  <>
                    <div style={styles.fieldRow}>
                      <Field label="Produto">
                        <select
                          value={specialProductId}
                          onChange={(e) => setSpecialProductId(e.target.value)}
                          style={getInputStyle(false)}
                        >
                          <option value="">Selecione</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.code ? `${product.code} - ` : ""}
                              {product.description}
                            </option>
                          ))}
                        </select>
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
                      style={styles.secondaryButton}
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
                            style={styles.dangerButton}
                          >
                            Remover
                          </button>
                        </div>
                      ))
                    )}
                  </>
                ) : (
                  <p style={styles.cellMuted}>Salve o cliente antes de cadastrar preco especial.</p>
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
          description="O cliente sera removido dos cadastros locais. Operacoes ja registradas nao sao afetadas."
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
