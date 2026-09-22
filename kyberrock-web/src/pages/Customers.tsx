import { useMemo, useState, type FormEvent } from "react";

import {
  Alert,
  Badge,
  DataTable,
  Field,
  Modal,
  PageHead,
  Warnings,
  useToast
} from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { formatDocument, formatMoney, isValidDocument, normalizeDocument } from "../lib/format";
import {
  q,
  type Carrier,
  type Customer,
  type PaymentMethod,
  type PaymentTerm
} from "../lib/queries";
import { useAsync } from "../lib/use-async";

function matches(customer: Customer, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const doc = normalizeDocument(needle);
  return (
    customer.trade_name.toLowerCase().includes(needle) ||
    customer.legal_name.toLowerCase().includes(needle) ||
    (doc.length > 0 && normalizeDocument(customer.document ?? "").includes(doc))
  );
}

export function Customers() {
  const user = useUser();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(
    () =>
      Promise.all([
        q.customers(user.companyId),
        q.paymentTerms(user.companyId),
        q.paymentMethods(user.companyId),
        q.carriers(user.companyId)
      ]),
    [user.companyId]
  );
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [commercial, setCommercial] = useState<Customer | null>(null);

  const [customers, terms, methods, carriers] = data ?? [[], [], [], []];
  const rows = useMemo(
    () => customers.filter((c) => (showInactive || c.is_active) && matches(c, search)),
    [customers, search, showInactive]
  );

  async function toggleActive(customer: Customer) {
    try {
      await callWebApi("set_customer_active", { id: customer.id, isActive: !customer.is_active });
      toast.push(customer.is_active ? "Cliente inativado." : "Cliente reativado.");
      await reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  }

  return (
    <>
      <PageHead
        title="Clientes"
        description="Cadastro compartilhado com as balancas. Cliente com historico nunca e excluido: inative."
        actions={
          <button className="btn primary" onClick={() => setEditing("new")}>
            Novo cliente
          </button>
        }
      />
      {error && <Alert kind="error">{error}</Alert>}
      <div className="panel">
        <div className="toolbar">
          <input
            className="input"
            placeholder="Buscar por nome ou CNPJ/CPF"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Mostrar inativos
          </label>
          <span style={{ marginLeft: "auto", color: "var(--muted)" }}>
            {loading ? "Carregando..." : `${rows.length} de ${customers.length}`}
          </span>
        </div>
        <DataTable
          rows={rows}
          rowKey={(c) => c.id}
          rowClassName={(c) => (c.is_active ? undefined : "inactive")}
          empty={loading ? "Carregando..." : "Nenhum cliente encontrado."}
          columns={[
            {
              key: "name",
              header: "Cliente",
              render: (c) => (
                <>
                  {c.trade_name}
                  <span className="cell-sub">{c.legal_name}</span>
                </>
              )
            },
            { key: "doc", header: "CNPJ/CPF", render: (c) => formatDocument(c.document) || "—" },
            {
              key: "city",
              header: "Cidade",
              render: (c) => [c.city, c.state].filter(Boolean).join(" / ") || "—"
            },
            {
              key: "omie",
              header: "OMIE",
              render: (c) =>
                c.omie_customer_id ? (
                  <Badge kind="ok">{c.omie_customer_id}</Badge>
                ) : (
                  <Badge kind="warn">nao enviado</Badge>
                )
            },
            {
              key: "credit",
              header: "Credito",
              render: (c) =>
                c.credit_account_enabled ? (
                  <Badge kind="accent">{c.credit_mode === "prepaid" ? "pre-pago" : "fiado"}</Badge>
                ) : (
                  "—"
                )
            },
            {
              key: "status",
              header: "Situacao",
              render: (c) => (c.is_active ? <Badge kind="ok">ativo</Badge> : <Badge>inativo</Badge>)
            },
            {
              key: "actions",
              header: "",
              render: (c) => (
                <span className="actions">
                  <button className="btn small" onClick={() => setEditing(c)}>
                    Editar
                  </button>
                  {user.canManagePrices && (
                    <button className="btn small" onClick={() => setCommercial(c)}>
                      Comercial
                    </button>
                  )}
                  <button className="btn small" onClick={() => void toggleActive(c)}>
                    {c.is_active ? "Inativar" : "Reativar"}
                  </button>
                </span>
              )
            }
          ]}
        />
      </div>

      {editing && (
        <CustomerForm
          customer={editing === "new" ? null : editing}
          terms={terms}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
      {commercial && (
        <CommercialForm
          customer={commercial}
          methods={methods}
          carriers={carriers}
          onClose={() => setCommercial(null)}
          onSaved={async () => {
            setCommercial(null);
            await reload();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function CustomerForm({
  customer,
  terms,
  onClose,
  onSaved
}: {
  customer: Customer | null;
  terms: PaymentTerm[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [form, setForm] = useState({
    legalName: customer?.legal_name ?? "",
    tradeName: customer?.trade_name ?? "",
    document: formatDocument(customer?.document) ?? "",
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
    contactName: customer?.contact_name ?? "",
    zipcode: customer?.zipcode ?? "",
    addressStreet: customer?.address_street ?? "",
    addressNumber: customer?.address_number ?? "",
    addressComplement: customer?.address_complement ?? "",
    neighborhood: customer?.neighborhood ?? "",
    city: customer?.city ?? "",
    state: customer?.state ?? "",
    stateRegistration: customer?.state_registration ?? "",
    defaultPaymentTermId: customer?.default_payment_term_id ?? "",
    observations: customer?.observations ?? ""
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (form.document.trim() && !isValidDocument(form.document)) {
      setError("CNPJ/CPF invalido. Confira os digitos.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Campo vazio vai como null (limpa); a web-api nao mexe no que nao for enviado.
      const payload: Record<string, unknown> = { ...(customer ? { id: customer.id } : {}) };
      for (const [key, value] of Object.entries(form)) payload[key] = value.trim() || null;
      const result = await callWebApi("upsert_customer", payload);
      setWarnings(result.warnings);
      toast.push(customer ? "Cliente salvo." : "Cliente cadastrado.");
      if (result.warnings.length === 0) await onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const formId = "customer-form";
  return (
    <Modal
      title={customer ? `Editar ${customer.trade_name}` : "Novo cliente"}
      description="Nome, documento e endereco sobem para o OMIE ao salvar."
      onClose={onClose}
      wide
      footer={
        <>
          {warnings.length > 0 ? (
            <button className="btn primary" onClick={() => void onSaved()}>
              Entendi
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>
                Cancelar
              </button>
              <button className="btn primary" type="submit" form={formId} disabled={busy}>
                {busy ? "Salvando..." : "Salvar"}
              </button>
            </>
          )}
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <Warnings items={warnings} />
      <form id={formId} onSubmit={(e) => void onSubmit(e)}>
        <div className="grid-2">
          <Field label="Razao social">
            <input
              className="input"
              value={form.legalName}
              onChange={set("legalName")}
              required
              autoFocus
            />
          </Field>
          <Field label="Nome fantasia" hint="Vazio = usa a razao social.">
            <input className="input" value={form.tradeName} onChange={set("tradeName")} />
          </Field>
          <Field label="CNPJ/CPF" hint="CNPJ novo pode ter letras; digite como esta no documento.">
            <input className="input" value={form.document} onChange={set("document")} />
          </Field>
          <Field label="Inscricao estadual">
            <input
              className="input"
              value={form.stateRegistration}
              onChange={set("stateRegistration")}
            />
          </Field>
          <Field label="E-mail">
            <input className="input" type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Telefone">
            <input
              className="input"
              value={form.phone}
              onChange={set("phone")}
              placeholder="(15) 99999-9999"
            />
          </Field>
          <Field label="Contato">
            <input className="input" value={form.contactName} onChange={set("contactName")} />
          </Field>
          <Field label="Condicao de pagamento padrao">
            <select
              className="select"
              value={form.defaultPaymentTermId}
              onChange={set("defaultPaymentTermId")}
            >
              <option value="">—</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid-3">
          <Field label="CEP">
            <input className="input" value={form.zipcode} onChange={set("zipcode")} />
          </Field>
          <Field label="Cidade">
            <input className="input" value={form.city} onChange={set("city")} />
          </Field>
          <Field label="UF">
            <input className="input" value={form.state} onChange={set("state")} maxLength={2} />
          </Field>
        </div>
        <div className="grid-3">
          <Field label="Logradouro">
            <input className="input" value={form.addressStreet} onChange={set("addressStreet")} />
          </Field>
          <Field label="Numero">
            <input className="input" value={form.addressNumber} onChange={set("addressNumber")} />
          </Field>
          <Field label="Bairro">
            <input className="input" value={form.neighborhood} onChange={set("neighborhood")} />
          </Field>
        </div>
        <Field label="Complemento">
          <input
            className="input"
            value={form.addressComplement}
            onChange={set("addressComplement")}
          />
        </Field>
        <Field label="Observacoes internas">
          <textarea
            className="textarea"
            rows={3}
            value={form.observations}
            onChange={set("observations")}
          />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function CommercialForm({
  customer,
  methods,
  carriers,
  onClose,
  onSaved
}: {
  customer: Customer;
  methods: PaymentMethod[];
  carriers: Carrier[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    defaultPaymentMethodId: customer.default_payment_method_id ?? "",
    defaultCarrierId: customer.default_carrier_id ?? "",
    nfRequired: customer.nf_required ?? false,
    creditAccountEnabled: customer.credit_account_enabled ?? false,
    creditMode: customer.credit_mode ?? "normal",
    creditPeriodicity: customer.credit_periodicity ?? "",
    creditClosingDay: customer.credit_closing_day?.toString() ?? "",
    creditSecondClosingDay: customer.credit_second_closing_day?.toString() ?? "",
    creditBoletoDays: customer.credit_boleto_days?.toString() ?? "",
    creditClosingWeekday: customer.credit_closing_weekday?.toString() ?? ""
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await callWebApi("set_customer_commercial", {
        id: customer.id,
        defaultPaymentMethodId: form.defaultPaymentMethodId || null,
        defaultCarrierId: form.defaultCarrierId || null,
        nfRequired: form.nfRequired,
        creditAccountEnabled: form.creditAccountEnabled,
        creditMode: form.creditMode,
        creditPeriodicity: form.creditPeriodicity || null,
        creditClosingDay: form.creditClosingDay || null,
        creditSecondClosingDay: form.creditSecondClosingDay || null,
        creditBoletoDays: form.creditBoletoDays || null,
        creditClosingWeekday: form.creditClosingWeekday || null
      });
      toast.push("Bloco comercial publicado para as balancas.");
      await onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const formId = "commercial-form";
  return (
    <Modal
      title={`Comercial e credito — ${customer.trade_name}`}
      description="Estas configuracoes tem dono: o que voce salvar aqui vale em todas as balancas."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" type="submit" form={formId} disabled={busy}>
            {busy ? "Salvando..." : "Publicar"}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <form id={formId} onSubmit={(e) => void onSubmit(e)}>
        <div className="grid-2">
          <Field label="Forma de pagamento padrao">
            <select
              className="select"
              value={form.defaultPaymentMethodId}
              onChange={(e) => setForm((f) => ({ ...f, defaultPaymentMethodId: e.target.value }))}
            >
              <option value="">—</option>
              {methods
                .filter((m) => m.is_active)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.alias || m.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Transportadora padrao">
            <select
              className="select"
              value={form.defaultCarrierId}
              onChange={(e) => setForm((f) => ({ ...f, defaultCarrierId: e.target.value }))}
            >
              <option value="">—</option>
              {carriers
                .filter((c) => c.is_active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={form.nfRequired}
            onChange={(e) => setForm((f) => ({ ...f, nfRequired: e.target.checked }))}
          />
          Exige nota fiscal
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.creditAccountEnabled}
            onChange={(e) => setForm((f) => ({ ...f, creditAccountEnabled: e.target.checked }))}
          />
          Conta de credito habilitada (fiado / pre-pago)
        </label>
        {form.creditAccountEnabled && (
          <>
            <div className="grid-2">
              <Field label="Modo">
                <select
                  className="select"
                  value={form.creditMode}
                  onChange={(e) => setForm((f) => ({ ...f, creditMode: e.target.value }))}
                >
                  <option value="normal">Fiado (fechamento periodico)</option>
                  <option value="prepaid">Pre-pago (adiantamento no OMIE)</option>
                </select>
              </Field>
              <Field label="Periodicidade do fechamento">
                <select
                  className="select"
                  value={form.creditPeriodicity}
                  onChange={(e) => setForm((f) => ({ ...f, creditPeriodicity: e.target.value }))}
                >
                  <option value="">—</option>
                  <option value="monthly">Mensal</option>
                  <option value="biweekly">Quinzenal</option>
                  <option value="weekly">Semanal</option>
                </select>
              </Field>
            </div>
            <div className="grid-3">
              <Field label="Dia do fechamento" hint="1 a 31">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={31}
                  value={form.creditClosingDay}
                  onChange={(e) => setForm((f) => ({ ...f, creditClosingDay: e.target.value }))}
                />
              </Field>
              <Field label="2o fechamento (quinzenal)">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={31}
                  value={form.creditSecondClosingDay}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, creditSecondClosingDay: e.target.value }))
                  }
                />
              </Field>
              <Field label="Prazo do boleto (dias)">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={365}
                  value={form.creditBoletoDays}
                  onChange={(e) => setForm((f) => ({ ...f, creditBoletoDays: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="Dia da semana (semanal)" hint="0 = domingo ... 6 = sabado">
              <input
                className="input"
                type="number"
                min={0}
                max={6}
                value={form.creditClosingWeekday}
                onChange={(e) => setForm((f) => ({ ...f, creditClosingWeekday: e.target.value }))}
              />
            </Field>
          </>
        )}
        {customer.credit_limit_cents != null && (
          <p style={{ color: "var(--muted)" }}>
            Limite de credito (OMIE): {formatMoney(customer.credit_limit_cents)}
          </p>
        )}
      </form>
    </Modal>
  );
}
