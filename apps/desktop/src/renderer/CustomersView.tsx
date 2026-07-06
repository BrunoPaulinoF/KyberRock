import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import {
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
  SourceBadge,
  useFlash
} from "./crud-ui";
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
    maxHeight: "160px",
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
}
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

export function CustomersView({ desktopApi }: { desktopApi: KyberRockDesktopApi | null }) {
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

  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermOption[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
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

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

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
  }

  function openCreateForm(): void {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(customer: CustomerCacheEntry): void {
    setForm({
      tradeName: customer.tradeName,
      legalName: customer.legalName,
      document: customer.document ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      creditLimitReais: customer.creditLimitCents
        ? (customer.creditLimitCents / 100).toFixed(2).replace(".", ",")
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
    });
    setEditingId(customer.id);
    setEditingSource(customer.source);
    setFormError(null);
    setShowForm(true);
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
    const creditLimitCents = form.creditLimitReais.trim()
      ? (parseMoneyInputToCents(form.creditLimitReais) ?? undefined)
      : undefined;

    const creditPeriodicity = form.creditAccountEnabled ? form.creditPeriodicity : "monthly";
    let creditClosingDay: number | null = null;
    let creditBoletoDays: number | null = null;
    let creditSecondClosingDay: number | null = null;
    let creditSecondBoletoDays: number | null = null;
    let creditClosingWeekday: number | null = null;
    if (form.creditAccountEnabled) {
      creditBoletoDays = Number(form.creditBoletoDays);
      if (!Number.isInteger(creditBoletoDays) || creditBoletoDays < 0) {
        setFormError("Informe os dias apos o fechamento para o vencimento do boleto.");
        return;
      }
      if (creditPeriodicity === "weekly") {
        creditClosingWeekday = Number(form.creditClosingWeekday);
        if (
          !Number.isInteger(creditClosingWeekday) ||
          creditClosingWeekday < 0 ||
          creditClosingWeekday > 6
        ) {
          setFormError("Selecione o dia da semana do fechamento.");
          return;
        }
      } else {
        creditClosingDay = Number(form.creditClosingDay);
        if (!Number.isInteger(creditClosingDay) || creditClosingDay < 1 || creditClosingDay > 31) {
          setFormError("Informe o dia de fechamento (1 a 31) para o credito do cliente.");
          return;
        }
        if (creditPeriodicity === "biweekly") {
          creditSecondClosingDay = Number(form.creditSecondClosingDay);
          creditSecondBoletoDays = Number(form.creditSecondBoletoDays);
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

    setSaving(true);
    try {
      if (editingId) {
        const localPatch = {
          observations: form.observations.trim() || undefined,
          creditMode: form.creditMode,
          defaultCarrierId: form.defaultCarrierId || null,
          defaultPaymentTermId: form.defaultPaymentTermId || null,
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
          creditLimitCents: creditLimitCents ?? undefined,
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
        await desktopApi.customersUpdate(
          editingId,
          editingSource === "omie" ? localPatch : fullPatch
        );
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
          defaultPaymentTermId: form.defaultPaymentTermId || undefined,
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

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);

  const isOmie = editingSource === "omie";

  return (
    <div>
      <CrudSectionHeader
        title="Clientes"
        description="Clientes sincronizados do OMIE ou criados localmente. Clientes locais sao enviados ao OMIE no proximo sync."
        count={total}
        actionLabel="Novo cliente"
        onAction={openCreateForm}
      />
      <CrudSearchBar
        value={search}
        onChange={setSearch}
        placeholder="Buscar cliente por nome, fantasia ou CNPJ..."
        onRefresh={() => void loadCustomers()}
      />
      <FlashBanner flash={flash} />

      {showForm ? (
        <CrudFormModal onClose={() => setShowForm(false)} maxWidth={1040}>
        <Fragment>
          <div style={styles.formHeader}>
            <h3 style={styles.formTitle}>
              {editingId
                ? `Editar cliente ${isOmie ? "(somente campos KyberRock)" : ""}`
                : "Novo cliente"}
            </h3>
            {formError ? <p style={styles.errorMessage}>{formError}</p> : null}
          </div>
          <div style={styles.formShell}>
            <section style={styles.formSection}>
              <h4 style={styles.formSectionTitle}>Identificacao</h4>
              <TextInput
                label="Razao social"
                value={form.legalName}
                onChange={(legalName) => setForm({ ...form, legalName })}
                required
                disabled={isOmie}
              />
              <TextInput
                label="Nome fantasia"
                value={form.tradeName}
                onChange={(tradeName) => setForm({ ...form, tradeName })}
                required
                disabled={isOmie}
              />
              <div style={styles.fieldRow}>
                <DocumentInput
                  label="CNPJ/CPF"
                  value={form.document}
                  onChange={(document) => setForm({ ...form, document })}
                  disabled={isOmie}
                />
                <MoneyInput
                  label="Limite (R$)"
                  value={form.creditLimitReais}
                  onChange={(creditLimitReais) => setForm({ ...form, creditLimitReais })}
                  disabled={isOmie}
                  allowZero
                  hint="Use virgula para centavos."
                />
              </div>
            </section>

            <section style={styles.formSection}>
              <h4 style={styles.formSectionTitle}>Contato e endereco</h4>
              <div style={styles.fieldRow}>
                <PhoneInput
                  label="Telefone"
                  value={form.phone}
                  onChange={(phone) => setForm({ ...form, phone })}
                  disabled={isOmie}
                />
                <EmailInput
                  label="E-mail"
                  value={form.email}
                  onChange={(email) => setForm({ ...form, email })}
                  disabled={isOmie}
                />
              </div>
              <div style={styles.fieldRow}>
                <CepInput
                  label="CEP"
                  value={form.zipcode}
                  onChange={(zipcode) => setForm({ ...form, zipcode })}
                  onLookup={handleCepLookup}
                  onAddressFound={handleCepAddressFound}
                  disabled={isOmie}
                />
                <TextInput
                  label="Numero"
                  value={form.addressNumber}
                  onChange={(addressNumber) => setForm({ ...form, addressNumber })}
                  disabled={isOmie}
                  hint="Opcional"
                />
              </div>
              <TextInput
                label="Endereco"
                value={form.addressStreet}
                onChange={(addressStreet) => setForm({ ...form, addressStreet })}
                disabled={isOmie}
                placeholder="Rua / avenida"
              />
              <div style={styles.fieldRow}>
                <TextInput
                  label="Bairro"
                  value={form.neighborhood}
                  onChange={(neighborhood) => setForm({ ...form, neighborhood })}
                  disabled={isOmie}
                />
                <TextInput
                  label="Complemento"
                  value={form.addressComplement}
                  onChange={(addressComplement) => setForm({ ...form, addressComplement })}
                  disabled={isOmie}
                />
              </div>
              <div style={styles.fieldRow}>
                <TextInput
                  label="Cidade"
                  value={form.city}
                  onChange={(city) => setForm({ ...form, city })}
                  disabled={isOmie}
                />
                <Field label="UF">
                  <input
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    disabled={isOmie}
                    value={form.state}
                    placeholder="SP"
                    onChange={(e) =>
                      setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })
                    }
                    style={getInputStyle(isOmie)}
                    maxLength={2}
                  />
                </Field>
              </div>
            </section>

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
              <Field label="Condicao de pagamento padrao">
                <select
                  value={form.defaultPaymentTermId}
                  onChange={(e) => setForm({ ...form, defaultPaymentTermId: e.target.value })}
                  style={getInputStyle(false)}
                >
                  <option value="">Selecione</option>
                  {paymentTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label style={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={form.creditAccountEnabled}
                  onChange={(e) => setForm({ ...form, creditAccountEnabled: e.target.checked })}
                />
                Habilitar credito do cliente (fiado)
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
              <label style={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={form.omieBillingBlocked}
                  onChange={(e) => setForm({ ...form, omieBillingBlocked: e.target.checked })}
                  disabled={isOmie}
                />
                Bloqueado para faturamento
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
              <div style={{ display: "grid", gap: "8px", marginTop: "8px" }}>
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
              <div style={{ display: "grid", gap: "8px", marginTop: "8px" }}>
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
              <div style={{ display: "grid", gap: "8px", marginTop: "8px" }}>
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
          </div>
          <div style={styles.formFooter}>
            <button type="button" onClick={() => setShowForm(false)} style={styles.secondaryButton}>
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
            width: "170px",
            align: "right",
            render: (customer) => (
              <>
                <EditRowButton onClick={() => openEditForm(customer)} />
                <DeleteRowButton onClick={() => setPendingDeleteId(customer.id)} />
              </>
            )
          }
        ]}
        rows={customers}
        rowKey={(customer) => customer.id}
        loading={loading}
        emptyTitle={search ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado."}
        emptyHint={
          search
            ? "Ajuste o termo de busca."
            : "Sincronize com o OMIE ou cadastre o primeiro cliente pelo botao 'Novo cliente'."
        }
        minWidth="820px"
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
