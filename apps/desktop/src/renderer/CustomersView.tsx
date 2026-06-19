import { useCallback, useEffect, useMemo, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import type { CustomerCacheEntry, CustomerFormData } from "./customers.types";
import {
  formatDocument,
  formatPhone,
  isValidDocument,
  isValidEmail,
  normalizeDocument,
  normalizeEmail,
  normalizePhone
} from "@kyberrock/shared";

function normalizeCep(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

const initialForm: CustomerFormData = {
  tradeName: "",
  legalName: "",
  document: "",
  phone: "",
  email: "",
  creditLimitReais: "",
  omieBillingBlocked: false,
  observations: "",
  defaultCarrierId: "",
  defaultPaymentTermId: "",
  priceTableId: "",
  zipcode: "",
  addressStreet: "",
  addressNumber: "",
  addressComplement: "",
  neighborhood: "",
  city: "",
  state: ""
};

const styles = {
  page: {
    display: "grid",
    gap: "12px"
  },
  toolbar: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const,
    alignItems: "center"
  },
  search: {
    flex: 1,
    minWidth: "180px",
    border: "1px solid var(--kr-input-border)",
    borderRadius: "8px",
    padding: "8px 10px",
    fontSize: "13px",
    background: "var(--kr-input-bg)",
    color: "var(--kr-text-strong)"
  },
  primaryButton: {
    border: "none",
    background: "#0f172a",
    color: "#fff",
    borderRadius: "8px",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px"
  },
  secondaryButton: {
    border: "1px solid var(--kr-border)",
    background: "var(--kr-surface)",
    color: "var(--kr-text-strong)",
    borderRadius: "8px",
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px"
  },
  dangerButton: {
    border: "1px solid #fecaca",
    background: "#fff",
    color: "#b91c1c",
    borderRadius: "8px",
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px"
  },
  message: {
    color: "#166534",
    background: "#dcfce7",
    border: "1px solid #bbf7d0",
    padding: "6px 10px",
    borderRadius: "8px",
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
  card: {
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "12px",
    boxShadow: "var(--kr-shadow)"
  },
  listRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr) auto",
    gap: "12px",
    alignItems: "center",
    padding: "10px 14px",
    borderTop: "1px solid var(--kr-border)",
    fontSize: "13px"
  },
  listHeader: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr) auto",
    gap: "12px",
    padding: "8px 14px",
    background: "var(--kr-surface-soft)",
    color: "var(--kr-muted)",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em"
  },
  cellPrimary: {
    fontWeight: 700,
    color: "var(--kr-text-strong)"
  },
  cellMuted: {
    color: "var(--kr-muted)",
    fontSize: "12px"
  },
  rowActions: {
    display: "flex",
    gap: "6px"
  },
  sourceBadge: (source: string) => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "1px 8px",
    borderRadius: "999px",
    fontSize: "10px",
    fontWeight: 800,
    color: source === "omie" ? "#1e40af" : "#166534",
    background: source === "omie" ? "#dbeafe" : "#dcfce7"
  }),
  formShell: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.2fr) minmax(0, 0.9fr)",
    gap: "12px",
    padding: "14px"
  },
  formSection: {
    display: "grid",
    gap: "8px",
    padding: "12px",
    border: "1px solid var(--kr-border)",
    borderRadius: "10px",
    background: "var(--kr-surface-soft)"
  },
  formSectionTitle: {
    margin: 0,
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    color: "var(--kr-muted)",
    letterSpacing: "0.04em"
  },
  formGrid: {
    display: "grid",
    gap: "8px"
  },
  fieldRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px"
  },
  fieldRow3: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "8px"
  },
  fieldLabel: {
    display: "grid",
    gap: "3px",
    fontWeight: 700,
    fontSize: "12px",
    color: "var(--kr-text-strong)"
  },
  input: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "6px",
    padding: "6px 8px",
    font: "inherit",
    fontSize: "13px",
    background: "var(--kr-input-bg)",
    color: "var(--kr-text-strong)"
  },
  inputDisabled: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "6px",
    padding: "6px 8px",
    font: "inherit",
    fontSize: "13px",
    background: "#f1f5f9",
    color: "#64748b",
    cursor: "not-allowed"
  },
  formFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    borderTop: "1px solid var(--kr-border)"
  },
  formHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    borderBottom: "1px solid var(--kr-border)",
    background: "var(--kr-surface-soft)"
  },
  formTitle: {
    margin: 0,
    fontSize: "14px",
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
    padding: "8px 14px",
    borderTop: "1px solid var(--kr-border)",
    color: "var(--kr-muted)",
    fontSize: "12px"
  },
  checkbox: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontWeight: 700,
    fontSize: "12px"
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
interface PriceTableOption {
  id: string;
  name: string;
}

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
  const [feedback, setFeedback] = useState<string | null>(null);

  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermOption[]>([]);
  const [priceTables, setPriceTables] = useState<PriceTableOption[]>([]);

  const pageSize = 50;

  const loadOptions = useCallback(async () => {
    if (!desktopApi) return;
    try {
      const [carriersResult, termsResult, tables] = await Promise.all([
        desktopApi.queryCache({ entityType: "carrier", limit: 200 }),
        desktopApi.queryCache({ entityType: "payment_term", limit: 500 }),
        desktopApi.priceTablesList() as Promise<PriceTableOption[]>
      ]);
      setCarriers((carriersResult.rows as CarrierOption[]) ?? []);
      setPaymentTerms((termsResult.rows as PaymentTermOption[]) ?? []);
      setPriceTables(tables ?? []);
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
      omieBillingBlocked: customer.omieBillingBlocked,
      observations: customer.observations ?? "",
      defaultCarrierId: customer.defaultCarrierId ?? "",
      defaultPaymentTermId: customer.defaultPaymentTermId ?? "",
      priceTableId: "",
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
  }

  function validateForm(): string | null {
    if (!form.tradeName.trim()) return "Nome fantasia obrigatorio.";
    if (!form.legalName.trim()) return "Razao social obrigatoria.";
    if (form.zipcode.trim() && normalizeCep(form.zipcode).length !== 8) return "CEP invalido.";
    return null;
  }

  async function handleSave(): Promise<void> {
    if (!desktopApi) return;
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
      ? Math.round(Number(form.creditLimitReais.replace(/\./g, "").replace(",", ".")) * 100) || undefined
      : undefined;
    const normalizedZipcode = normalizeCep(form.zipcode);

    try {
      let customerId = editingId;
      if (editingId) {
        const localPatch = {
          observations: form.observations.trim() || undefined,
          defaultCarrierId: form.defaultCarrierId || null,
          defaultPaymentTermId: form.defaultPaymentTermId || null
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
        setFeedback("Cliente atualizado.");
      } else {
        const created = (await desktopApi.customersCreate({
          tradeName: form.tradeName.trim(),
          legalName: form.legalName.trim(),
          document: normalizedDocument || undefined,
          phone: normalizedPhone || undefined,
          email: normalizedEmail || undefined,
          creditLimitCents: creditLimitCents ?? undefined,
          omieBillingBlocked: form.omieBillingBlocked,
          observations: form.observations.trim() || undefined,
          defaultCarrierId: form.defaultCarrierId || undefined,
          defaultPaymentTermId: form.defaultPaymentTermId || undefined,
          zipcode: normalizedZipcode || undefined,
          addressStreet: form.addressStreet.trim() || undefined,
          addressNumber: form.addressNumber.trim() || undefined,
          addressComplement: form.addressComplement.trim() || undefined,
          neighborhood: form.neighborhood.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim().toUpperCase() || undefined
        })) as { id: string };
        customerId = created.id;
        setFeedback("Cliente criado.");
      }
      if (customerId && form.priceTableId) {
        try {
          await desktopApi.priceTablesLinkCustomer({
            customerId,
            priceTableId: form.priceTableId
          });
        } catch {
          /* ignore */
        }
      }
      setShowForm(false);
      resetForm();
      await loadCustomers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao salvar cliente.");
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!desktopApi) return;
    if (!window.confirm("Deseja realmente excluir este cliente?")) return;
    try {
      await desktopApi.customersDelete(id);
      setFeedback("Cliente excluido.");
      await loadCustomers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao excluir cliente.");
    }
  }

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total]
  );

  const isOmie = editingSource === "omie";

  return (
    <div style={styles.page}>
      <div style={styles.toolbar}>
        <input
          placeholder="Buscar cliente por nome, fantasia ou CNPJ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={styles.search}
        />
        <button type="button" onClick={openCreateForm} style={styles.primaryButton}>
          + Novo cliente
        </button>
      </div>

      {feedback ? <p style={styles.message}>{feedback}</p> : null}

      {showForm ? (
        <div style={styles.card}>
          <div style={styles.formHeader}>
            <h3 style={styles.formTitle}>
              {editingId ? `Editar cliente ${isOmie ? "(somente campos KyberRock)" : ""}` : "Novo cliente"}
            </h3>
            {formError ? <p style={styles.errorMessage}>{formError}</p> : null}
          </div>
          <div style={styles.formShell}>
            <section style={styles.formSection}>
              <h4 style={styles.formSectionTitle}>Identificacao</h4>
              <div style={styles.formGrid}>
                <label style={styles.fieldLabel}>
                  Razao social
                  <input
                    value={form.legalName}
                    onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                    disabled={isOmie}
                    style={isOmie ? styles.inputDisabled : styles.input}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Nome fantasia
                  <input
                    value={form.tradeName}
                    onChange={(e) => setForm({ ...form, tradeName: e.target.value })}
                    disabled={isOmie}
                    style={isOmie ? styles.inputDisabled : styles.input}
                  />
                </label>
                <div style={styles.fieldRow}>
                  <label style={styles.fieldLabel}>
                    CNPJ/CPF
                    <input
                      value={formatDocument(form.document)}
                      onChange={(e) =>
                        setForm({ ...form, document: normalizeDocument(e.target.value) })
                      }
                      disabled={isOmie}
                      style={isOmie ? styles.inputDisabled : styles.input}
                      placeholder="00.000.000/0000-00"
                    />
                  </label>
                  <label style={styles.fieldLabel}>
                    Limite (R$)
                    <input
                      value={form.creditLimitReais}
                      onChange={(e) => setForm({ ...form, creditLimitReais: e.target.value })}
                      disabled={isOmie}
                      style={isOmie ? styles.inputDisabled : styles.input}
                      placeholder="0,00"
                    />
                  </label>
                </div>
              </div>
            </section>

            <section style={styles.formSection}>
              <h4 style={styles.formSectionTitle}>Contato e endereco</h4>
              <div style={styles.formGrid}>
                <div style={styles.fieldRow}>
                  <label style={styles.fieldLabel}>
                    Telefone
                    <input
                      value={formatPhone(form.phone)}
                      onChange={(e) => setForm({ ...form, phone: normalizePhone(e.target.value) })}
                      disabled={isOmie}
                      style={isOmie ? styles.inputDisabled : styles.input}
                    />
                  </label>
                  <label style={styles.fieldLabel}>
                    E-mail
                    <input
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      disabled={isOmie}
                      style={isOmie ? styles.inputDisabled : styles.input}
                    />
                  </label>
                </div>
                <div style={styles.fieldRow3}>
                  <label style={styles.fieldLabel}>
                    CEP
                    <input
                      value={form.zipcode}
                      onChange={(e) => setForm({ ...form, zipcode: normalizeCep(e.target.value) })}
                      disabled={isOmie}
                      style={isOmie ? styles.inputDisabled : styles.input}
                      onBlur={() => undefined}
                      placeholder="00000-000"
                    />
                  </label>
                  <label style={styles.fieldLabel}>
                    Cidade
                    <input
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      disabled={isOmie}
                      style={isOmie ? styles.inputDisabled : styles.input}
                    />
                  </label>
                  <label style={styles.fieldLabel}>
                    UF
                    <input
                      value={form.state}
                      onChange={(e) =>
                        setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })
                      }
                      disabled={isOmie}
                      style={isOmie ? styles.inputDisabled : styles.input}
                      maxLength={2}
                    />
                  </label>
                </div>
                <label style={styles.fieldLabel}>
                  Endereco
                  <input
                    value={form.addressStreet}
                    onChange={(e) => setForm({ ...form, addressStreet: e.target.value })}
                    disabled={isOmie}
                    style={isOmie ? styles.inputDisabled : styles.input}
                    placeholder="Rua / avenida"
                  />
                </label>
                <div style={styles.fieldRow3}>
                  <label style={styles.fieldLabel}>
                    Numero
                    <input
                      value={form.addressNumber}
                      onChange={(e) => setForm({ ...form, addressNumber: e.target.value })}
                      disabled={isOmie}
                      style={isOmie ? styles.inputDisabled : styles.input}
                    />
                  </label>
                  <label style={styles.fieldLabel}>
                    Bairro
                    <input
                      value={form.neighborhood}
                      onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
                      disabled={isOmie}
                      style={isOmie ? styles.inputDisabled : styles.input}
                    />
                  </label>
                  <label style={styles.fieldLabel}>
                    Complemento
                    <input
                      value={form.addressComplement}
                      onChange={(e) => setForm({ ...form, addressComplement: e.target.value })}
                      disabled={isOmie}
                      style={isOmie ? styles.inputDisabled : styles.input}
                    />
                  </label>
                </div>
              </div>
            </section>

            <section style={styles.formSection}>
              <h4 style={styles.formSectionTitle}>Comercial</h4>
              <div style={styles.formGrid}>
                <label style={styles.fieldLabel}>
                  Transportadora
                  <select
                    value={form.defaultCarrierId}
                    onChange={(e) => setForm({ ...form, defaultCarrierId: e.target.value })}
                    style={styles.input}
                  >
                    <option value="">Selecione</option>
                    {carriers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={styles.fieldLabel}>
                  Condicao de pagamento
                  <select
                    value={form.defaultPaymentTermId}
                    onChange={(e) => setForm({ ...form, defaultPaymentTermId: e.target.value })}
                    style={styles.input}
                  >
                    <option value="">Selecione</option>
                    {paymentTerms.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={styles.fieldLabel}>
                  Tabela de preco
                  <select
                    value={form.priceTableId}
                    onChange={(e) => setForm({ ...form, priceTableId: e.target.value })}
                    style={styles.input}
                  >
                    <option value="">Selecione</option>
                    {priceTables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={form.omieBillingBlocked}
                    onChange={(e) =>
                      setForm({ ...form, omieBillingBlocked: e.target.checked })
                    }
                    disabled={isOmie}
                  />
                  Bloqueado para faturamento
                </label>
                <label style={styles.fieldLabel}>
                  Observacoes internas
                  <input
                    value={form.observations}
                    onChange={(e) => setForm({ ...form, observations: e.target.value })}
                    style={styles.input}
                    placeholder="Anotacoes visiveis apenas para a operacao"
                  />
                </label>
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
                  onClick={() => void handleDelete(editingId)}
                  style={styles.dangerButton}
                >
                  Excluir
                </button>
              ) : null}
              <button type="button" onClick={() => void handleSave()} style={styles.primaryButton}>
                {editingId ? "Salvar alteracoes" : "Cadastrar cliente"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={styles.card}>
        <div style={styles.listHeader}>
          <span>Cliente</span>
          <span>Documento</span>
          <span>Contato</span>
          <span>Origem / status</span>
          <span style={{ textAlign: "right" }}>Acoes</span>
        </div>
        {loading ? (
          <p style={{ ...styles.cellMuted, padding: "14px" }}>Carregando clientes...</p>
        ) : customers.length === 0 ? (
          <p style={{ ...styles.cellMuted, padding: "14px" }}>Nenhum cliente encontrado.</p>
        ) : (
          customers.map((customer) => (
            <div key={customer.id} style={styles.listRow}>
              <div>
                <div style={styles.cellPrimary}>{customer.tradeName || customer.legalName}</div>
                <div style={styles.cellMuted}>{customer.legalName}</div>
              </div>
              <div style={styles.cellMuted}>{formatDocument(customer.document ?? "") || "-"}</div>
              <div>
                <div style={styles.cellPrimary}>{formatPhone(customer.phone ?? "") || "-"}</div>
                <div style={styles.cellMuted}>{customer.email || "-"}</div>
              </div>
              <div>
                <span style={styles.sourceBadge(customer.source)}>
                  {customer.source === "omie" ? "OMIE" : "LOCAL"}
                </span>
                {customer.omieBillingBlocked ? (
                  <span
                    style={{ ...styles.pill("#b91c1c", "#fee2e2"), marginLeft: "6px" }}
                  >
                    Bloqueado
                  </span>
                ) : null}
              </div>
              <div style={styles.rowActions}>
                <button type="button" onClick={() => openEditForm(customer)} style={styles.secondaryButton}>
                  Editar
                </button>
              </div>
            </div>
          ))
        )}
        <div style={styles.pagination}>
          <span>
            {total === 0
              ? "0 clientes"
              : `${page * pageSize + 1}-${Math.min(total, (page + 1) * pageSize)} de ${total}`}
          </span>
          <div style={{ display: "flex", gap: "6px" }}>
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
      </div>
    </div>
  );
}
