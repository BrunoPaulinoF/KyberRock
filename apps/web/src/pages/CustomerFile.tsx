import { Car, FileText, Tag, Truck, Wallet, type LucideIcon } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { EmptyState, IconAction, Pill, PlateBadge } from "../components/desk";
import { Picker } from "../components/Picker";
import { PricePasswordField } from "../components/PricePassword";
import { Alert, DataTable, Field, Modal, useToast } from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import {
  customerFreightEntries,
  defaultPriceByProduct,
  normalizeNfeNumber,
  parseTotalWeightKg,
  type CustomerFreightEntry
} from "../lib/customer-cadastro";
import { dedupePaymentMethods, dedupeVehicles, representativeIds } from "../lib/dedupe";
import { FREIGHT_MODALITIES } from "../lib/desktop/freight";
import { formatMoney, formatPlate, parseMoneyToCents } from "../lib/format";
import { matchesSearch } from "../lib/operation";
import { q, type Customer, type Product } from "../lib/queries";
import { useAsync } from "../lib/use-async";

/**
 * A ficha do cliente no site, com o que na balanca fica nas abas Comercial, Credito, Precos,
 * Frete, Transporte e Fiscal do cadastro do cliente (`CustomersView` do desktop): o bloco
 * comercial/credito, preco especial por produto, valor de frete combinado, transportadoras e
 * placas dele, tipo de frete padrao e as notas de venda para entrega futura. O cadastro em si
 * (nome, documento, endereco) continua no lapis da lista. Tudo grava pela `web-api` e chega as balancas pelo pull de cadastro.
 */

export type CustomerFileTab = "comercial" | "precos" | "frete" | "transporte" | "entrega";

const TABS: Array<{ id: CustomerFileTab; label: string; icon: LucideIcon }> = [
  { id: "comercial", label: "Comercial e credito", icon: Wallet },
  { id: "precos", label: "Precos especiais", icon: Tag },
  { id: "frete", label: "Frete", icon: Truck },
  { id: "transporte", label: "Transporte", icon: Car },
  { id: "entrega", label: "Entrega futura", icon: FileText }
];

const TAB_HINTS: Record<CustomerFileTab, string> = {
  comercial:
    "Forma de pagamento e transportadora padrao, nota fiscal e conta de credito (fiado / pre-pago).",
  precos:
    "Preco especial do cliente em cada produto. Ele vale no lugar do preco padrao na pesagem.",
  frete:
    "Valor de frete por tonelada combinado com o cliente — para todos os produtos ou por produto.",
  transporte:
    "Tipo de frete padrao, transportadoras e placas do cliente. A nova entrada ja abre com eles.",
  entrega:
    "Notas de venda para entrega futura (CFOP 5.922): cada pesagem do produto sai com a referencia da nota."
};

export function CustomerFileModal({
  customer,
  initialTab = "comercial",
  onClose
}: {
  customer: Customer;
  initialTab?: CustomerFileTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<CustomerFileTab>(initialTab);
  const name = customer.trade_name || customer.legal_name;
  return (
    <Modal
      wide
      title={name}
      description={TAB_HINTS[tab]}
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          Fechar
        </button>
      }
    >
      <nav className="file-tabs" aria-label="Ficha do cliente">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`file-tab${item.id === tab ? " active" : ""}`}
            aria-pressed={item.id === tab}
            onClick={() => setTab(item.id)}
          >
            <item.icon size={15} />
            {item.label}
          </button>
        ))}
      </nav>
      {tab === "comercial" && <CommercialTab customer={customer} />}
      {tab === "precos" && <SpecialPricesTab customer={customer} />}
      {tab === "frete" && <FreightTab customer={customer} />}
      {tab === "transporte" && <TransportTab customer={customer} />}
      {tab === "entrega" && <FutureBillingTab customer={customer} />}
    </Modal>
  );
}

/** Produtos e preco padrao de cada um — a base das abas Precos e Frete. */
function useProducts() {
  const user = useUser();
  const base = useAsync(
    () => Promise.all([q.products(user.companyId), q.productDefaultPrices(user.companyId)]),
    [user.companyId]
  );
  useOnCadastroChange(base.refresh, CADASTRO_TABLES.products);
  const [products, defaults] = base.data ?? [[], []];
  const defaultByProduct = useMemo(
    () => defaultPriceByProduct(products, defaults),
    [products, defaults]
  );
  return { products, defaultByProduct, loading: base.loading, error: base.error };
}

function productOptions(products: Product[]) {
  return products.map((p) => ({
    value: p.id,
    label: p.description,
    hint: p.code ? `Codigo ${p.code}` : undefined
  }));
}

function reais(cents: number | null | undefined): string {
  return cents != null ? (cents / 100).toFixed(2).replace(".", ",") : "";
}

// ---------------------------------------------------------------------------
// Precos especiais
// ---------------------------------------------------------------------------

function SpecialPricesTab({ customer }: { customer: Customer }) {
  const user = useUser();
  const toast = useToast();
  const canEdit = user.canEditPrices;
  const askPassword = user.requiresPricePassword;
  const { products, defaultByProduct, loading, error } = useProducts();
  const special = useAsync(
    () => q.customerSpecialPrices(user.companyId, customer.id),
    [user.companyId, customer.id]
  );
  useOnCadastroChange(special.refresh, CADASTRO_TABLES.specialPrices);
  const specialByProduct = useMemo(
    () => new Map((special.data ?? []).map((p) => [p.product_id, p.unit_price_cents])),
    [special.data]
  );

  const [productId, setProductId] = useState("");
  const [value, setValue] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [onlySpecial, setOnlySpecial] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = products.filter(
    (p) =>
      (!onlySpecial || specialByProduct.has(p.id)) &&
      matchesSearch(`${p.description} ${p.code ?? ""}`, search)
  );

  function pick(product: Product) {
    setProductId(product.id);
    setValue(reais(specialByProduct.get(product.id) ?? defaultByProduct.get(product.id)));
    setFormError(null);
  }

  function passwordOrError(): string | undefined | false {
    if (!askPassword) return undefined;
    if (!password.trim()) {
      setFormError("Digite a senha de preco que o comercial passou.");
      return false;
    }
    return password.trim();
  }

  async function save() {
    if (!productId) {
      setFormError("Escolha o produto.");
      return;
    }
    const cents = parseMoneyToCents(value);
    if (cents == null || cents <= 0) {
      setFormError("Informe um preco valido, ex.: 65,00");
      return;
    }
    const pricePassword = passwordOrError();
    if (pricePassword === false) return;
    setBusy(true);
    setFormError(null);
    try {
      await callWebApi("set_customer_special_price", {
        customerId: customer.id,
        productId,
        unitPriceCents: cents,
        pricePassword
      });
      toast.push("Preco especial publicado para as balancas.");
      setProductId("");
      setValue("");
      setPassword("");
      await special.reload();
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(product: Product) {
    const pricePassword = passwordOrError();
    if (pricePassword === false) return;
    setFormError(null);
    try {
      await callWebApi("remove_customer_special_price", {
        customerId: customer.id,
        productId: product.id,
        pricePassword
      });
      toast.push("Preco especial removido; volta a valer o padrao.");
      setPassword("");
      await special.reload();
    } catch (caught) {
      setFormError(errorMessage(caught));
    }
  }

  return (
    <>
      {(error ?? special.error) && <Alert kind="error">{error ?? special.error}</Alert>}
      {canEdit && (
        <div className="file-form">
          {formError && <Alert kind="error">{formError}</Alert>}
          <div className="grid-2">
            <Field label="Produto">
              <Picker
                value={productId}
                options={productOptions(products)}
                onChange={(id) => {
                  const product = products.find((p) => p.id === id);
                  if (product) pick(product);
                  else setProductId(id);
                }}
                placeholder="Buscar produto..."
                loading={loading}
              />
            </Field>
            <Field
              label="Preco especial (R$ / ton)"
              hint={
                productId && defaultByProduct.has(productId)
                  ? `Preco padrao: ${formatMoney(defaultByProduct.get(productId))}/ton`
                  : undefined
              }
            >
              <input
                className="input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="65,00"
                inputMode="decimal"
              />
            </Field>
          </div>
          {askPassword && <PricePasswordField value={password} onChange={setPassword} />}
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Publicando..." : "Salvar preco especial"}
          </button>
        </div>
      )}

      <div className="toolbar" style={{ marginTop: 14 }}>
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar produto..."
          style={{ flex: 1, minWidth: 180 }}
        />
        <label className="check" style={{ margin: 0, whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={onlySpecial}
            onChange={(e) => setOnlySpecial(e.target.checked)}
          />
          So com preco especial ({specialByProduct.size})
        </label>
      </div>
      <DataTable
        rows={rows}
        rowKey={(p) => p.id}
        pageSize={0}
        empty={
          loading || special.loading
            ? "Carregando..."
            : onlySpecial
              ? "Este cliente nao tem preco especial."
              : "Nenhum produto encontrado."
        }
        columns={[
          {
            key: "desc",
            header: "Produto",
            render: (p) => (
              <>
                <strong>{p.description}</strong>
                {p.code && <span className="cell-sub">Codigo {p.code}</span>}
              </>
            )
          },
          {
            key: "default",
            header: "Padrao",
            numeric: true,
            render: (p) =>
              defaultByProduct.has(p.id) ? formatMoney(defaultByProduct.get(p.id)) : "—"
          },
          {
            key: "special",
            header: "Especial",
            numeric: true,
            render: (p) =>
              specialByProduct.has(p.id) ? (
                <strong>{formatMoney(specialByProduct.get(p.id))}</strong>
              ) : (
                <span style={{ color: "var(--kr-muted)" }}>—</span>
              )
          },
          {
            key: "actions",
            header: "Acoes",
            numeric: true,
            render: (p) =>
              canEdit && (
                <span className="row-actions">
                  <IconAction
                    icon="edit"
                    label={
                      specialByProduct.has(p.id)
                        ? "Editar preco especial"
                        : "Definir preco especial"
                    }
                    onClick={() => pick(p)}
                  />
                  {specialByProduct.has(p.id) && (
                    <IconAction
                      icon="trash"
                      label="Remover preco especial"
                      tone="danger"
                      onClick={() => void remove(p)}
                    />
                  )}
                </span>
              )
          }
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Frete
// ---------------------------------------------------------------------------

function FreightTab({ customer }: { customer: Customer }) {
  const user = useUser();
  const toast = useToast();
  const canEdit = user.canEditPrices;
  const askPassword = user.requiresPricePassword;
  const { products, loading } = useProducts();
  const rules = useAsync(
    () => q.customerFreightRules(user.companyId, customer.id),
    [user.companyId, customer.id]
  );
  useOnCadastroChange(rules.refresh, CADASTRO_TABLES.customerFreight);
  const productNames = useMemo(
    () => new Map(products.map((p) => [p.id, p.description])),
    [products]
  );
  const entries = useMemo(
    () => customerFreightEntries(rules.data ?? [], productNames),
    [rules.data, productNames]
  );

  const [productId, setProductId] = useState("");
  const [value, setValue] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function passwordOrError(): string | undefined | false {
    if (!askPassword) return undefined;
    if (!password.trim()) {
      setFormError("Digite a senha de preco que o comercial passou.");
      return false;
    }
    return password.trim();
  }

  async function save() {
    const cents = parseMoneyToCents(value);
    if (cents == null || cents <= 0) {
      setFormError("Informe o frete por tonelada, ex.: 15,00");
      return;
    }
    const pricePassword = passwordOrError();
    if (pricePassword === false) return;
    setBusy(true);
    setFormError(null);
    try {
      await callWebApi("set_customer_freight_value", {
        customerId: customer.id,
        productId: productId || null,
        baseValueCents: cents,
        pricePassword
      });
      toast.push("Frete publicado para as balancas.");
      setValue("");
      setPassword("");
      await rules.reload();
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: CustomerFreightEntry) {
    const pricePassword = passwordOrError();
    if (pricePassword === false) return;
    setFormError(null);
    try {
      await callWebApi("remove_customer_freight_value", {
        customerId: customer.id,
        productId: entry.productId,
        modality: entry.modality,
        pricePassword
      });
      toast.push("Frete removido.");
      setPassword("");
      await rules.reload();
    } catch (caught) {
      setFormError(errorMessage(caught));
    }
  }

  return (
    <>
      {rules.error && <Alert kind="error">{rules.error}</Alert>}
      {canEdit && (
        <div className="file-form">
          {formError && <Alert kind="error">{formError}</Alert>}
          <div className="grid-2">
            <Field label="Vale para" hint="Frete de um produto vence o de todos os produtos.">
              <Picker
                value={productId}
                options={productOptions(products)}
                onChange={setProductId}
                placeholder="Buscar produto..."
                allowEmpty
                emptyLabel="Todos os produtos"
                loading={loading}
              />
            </Field>
            <Field label="Frete (R$ / ton)">
              <input
                className="input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="15,00"
                inputMode="decimal"
              />
            </Field>
          </div>
          {askPassword && <PricePasswordField value={password} onChange={setPassword} />}
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Publicando..." : "Salvar frete"}
          </button>
          <p className="desk-muted" style={{ marginTop: 8 }}>
            Vale quando a pesagem e com frete (valor na nota ou valor so no sistema). O valor
            combinado aqui vence o que o cliente usou na ultima venda.
          </p>
        </div>
      )}
      <DataTable
        rows={entries}
        rowKey={(entry) => entry.key}
        pageSize={0}
        empty={rules.loading ? "Carregando..." : "Nenhum frete cadastrado para este cliente."}
        columns={[
          {
            key: "scope",
            header: "Vale para",
            render: (entry) => <strong>{entry.scopeLabel}</strong>
          },
          {
            key: "modality",
            header: "Tipo de frete",
            render: (entry) => (
              <>
                {entry.modalityLabel}
                {entry.source === "last_used" && (
                  <span className="cell-sub">Memoria da ultima venda</span>
                )}
              </>
            )
          },
          {
            key: "value",
            header: "R$ / ton",
            numeric: true,
            render: (entry) => <strong>{formatMoney(entry.baseValueCents)}</strong>
          },
          {
            key: "actions",
            header: "Acoes",
            numeric: true,
            render: (entry) =>
              canEdit && (
                <span className="row-actions">
                  <IconAction
                    icon="trash"
                    label="Remover frete"
                    tone="danger"
                    onClick={() => void remove(entry)}
                  />
                </span>
              )
          }
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Transporte
// ---------------------------------------------------------------------------

function TransportTab({ customer }: { customer: Customer }) {
  const user = useUser();
  const toast = useToast();
  const canEdit = user.canEditCustomers;
  const data = useAsync(
    () =>
      Promise.all([
        q.carriers(user.companyId),
        q.vehicles(user.companyId),
        q.customerCarrierLinks(customer.id),
        q.customerVehicleLinks(user.companyId, customer.id)
      ]),
    [user.companyId, customer.id]
  );
  useOnCadastroChange(data.refresh, [
    ...CADASTRO_TABLES.customerTransport,
    ...CADASTRO_TABLES.carriers,
    ...CADASTRO_TABLES.vehicles
  ]);
  const [carriers, vehicles, carrierLinks, vehicleLinks] = data.data ?? [[], [], [], []];
  const [modality, setModality] = useState(customer.default_freight_modality ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const linkedCarrierIds = new Set(carrierLinks.map((link) => link.carrier_id));
  const linkedVehicleIds = new Set(vehicleLinks.map((link) => link.vehicle_id));
  const linkedCarriers = carriers.filter((c) => linkedCarrierIds.has(c.id));
  const linkedVehicles = vehicles.filter((v) => linkedVehicleIds.has(v.id));
  const plateGroups = useMemo(() => dedupeVehicles(vehicles), [vehicles]);

  async function run(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      toast.push(message);
      await data.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function saveModality(next: string) {
    const previous = modality;
    setModality(next);
    void run(
      () =>
        callWebApi("set_customer_commercial", {
          id: customer.id,
          defaultFreightModality: next || null
        }).catch((caught: unknown) => {
          setModality(previous);
          throw caught;
        }),
      "Tipo de frete padrao salvo."
    );
  }

  const linkCarrier = (carrierId: string, isActive: boolean) =>
    run(
      () => callWebApi("set_customer_carrier", { customerId: customer.id, carrierId, isActive }),
      isActive ? "Transportadora vinculada." : "Transportadora desvinculada."
    );
  const linkVehicle = (vehicleId: string, isActive: boolean) =>
    run(
      () => callWebApi("set_customer_vehicle", { customerId: customer.id, vehicleId, isActive }),
      isActive ? "Placa vinculada." : "Placa desvinculada."
    );

  return (
    <>
      {(error ?? data.error) && <Alert kind="error">{error ?? data.error}</Alert>}
      <Field
        label="Tipo de frete padrao"
        hint="Preenche a nova entrada quando este cliente e escolhido. O operador ainda pode trocar."
      >
        <select
          className="select"
          value={modality}
          disabled={!canEdit || busy}
          onChange={(e) => saveModality(e.target.value)}
        >
          <option value="">Sem padrao (escolher na entrada)</option>
          <optgroup label="Com frete">
            {FREIGHT_MODALITIES.filter((m) => m.group === "with_freight").map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Sem frete">
            {FREIGHT_MODALITIES.filter((m) => m.group === "without_freight").map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>

      <h3 className="file-subtitle">Transportadoras deste cliente</h3>
      {canEdit && (
        <Field label="Vincular transportadora">
          <Picker
            value=""
            options={carriers
              .filter((c) => c.is_active && !linkedCarrierIds.has(c.id))
              .map((c) => ({ value: c.id, label: c.name }))}
            onChange={(id) => id && void linkCarrier(id, true)}
            placeholder="Buscar transportadora para vincular..."
            disabled={busy}
            loading={data.loading}
          />
        </Field>
      )}
      {linkedCarriers.length === 0 ? (
        <EmptyState title="Nenhuma transportadora vinculada." />
      ) : (
        <ul className="file-list">
          {linkedCarriers.map((carrier) => (
            <li key={carrier.id}>
              <span>
                <strong>{carrier.name}</strong>
                {carrier.id === customer.default_carrier_id && <Pill tone="success">PADRAO</Pill>}
              </span>
              {canEdit && (
                <button
                  className="btn small ghost-danger"
                  disabled={busy}
                  onClick={() => void linkCarrier(carrier.id, false)}
                >
                  Remover
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="file-subtitle">Placas deste cliente</h3>
      {canEdit && (
        <Field
          label="Vincular placa"
          hint="A nova entrada abre o campo Placa ja com estas. A placa precisa estar cadastrada em Transporte > Placas."
        >
          <Picker
            value=""
            options={plateGroups
              .filter((g) => g.row.is_active && !g.ids.some((id) => linkedVehicleIds.has(id)))
              .map((g) => ({
                value: g.row.id,
                label: formatPlate(g.row.plate),
                hint: g.row.description ?? undefined
              }))}
            onChange={(id) => id && void linkVehicle(id, true)}
            placeholder="Buscar placa para vincular..."
            disabled={busy}
            loading={data.loading}
          />
        </Field>
      )}
      {linkedVehicles.length === 0 ? (
        <EmptyState
          title="Nenhuma placa vinculada."
          hint="A nova entrada segue oferecendo todas as placas da pedreira."
        />
      ) : (
        <ul className="file-list">
          {linkedVehicles.map((vehicle) => (
            <li key={vehicle.id}>
              <span>
                <PlateBadge plate={formatPlate(vehicle.plate)} />
                {vehicle.description && <span className="cell-sub">{vehicle.description}</span>}
              </span>
              {canEdit && (
                <button
                  className="btn small ghost-danger"
                  disabled={busy}
                  onClick={() => void linkVehicle(vehicle.id, false)}
                >
                  Remover
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Entrega futura
// ---------------------------------------------------------------------------

const ANY_PRODUCT = "__any__";

function FutureBillingTab({ customer }: { customer: Customer }) {
  const user = useUser();
  const toast = useToast();
  const canEdit = user.canEditCustomers;
  const { products, loading } = useProducts();
  const invoices = useAsync(
    () => q.customerFutureBillingInvoices(user.companyId, customer.id),
    [user.companyId, customer.id]
  );
  useOnCadastroChange(invoices.refresh, CADASTRO_TABLES.futureBilling);
  const productNames = useMemo(
    () => new Map(products.map((p) => [p.id, p.description])),
    [products]
  );

  // Comeca sem produto de proposito, como na balanca: "qualquer produto" carimba tambem o que
  // nao foi faturado naquela nota, e isso tem de ser escolha, nao o que sobra de um Salvar.
  const [productId, setProductId] = useState("");
  const [nfeNumber, setNfeNumber] = useState("");
  const [totalKg, setTotalKg] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!productId) {
      setFormError('Escolha o produto da nota (ou "Qualquer produto do cliente").');
      return;
    }
    if (!normalizeNfeNumber(nfeNumber)) {
      setFormError("Informe o numero da NF-e.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await callWebApi("set_customer_future_billing_invoice", {
        customerId: customer.id,
        productId: productId === ANY_PRODUCT ? null : productId,
        nfeNumber: normalizeNfeNumber(nfeNumber),
        totalWeightKg: parseTotalWeightKg(totalKg)
      });
      toast.push("Nota de entrega futura salva.");
      setProductId("");
      setNfeNumber("");
      setTotalKg("");
      await invoices.reload();
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await callWebApi("remove_customer_future_billing_invoice", { id });
      toast.push("Nota removida.");
      await invoices.reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  }

  return (
    <>
      {invoices.error && <Alert kind="error">{invoices.error}</Alert>}
      {canEdit && (
        <div className="file-form">
          {formError && <Alert kind="error">{formError}</Alert>}
          <Field label="Produto da nota">
            <Picker
              value={productId}
              options={[
                { value: ANY_PRODUCT, label: "Qualquer produto do cliente" },
                ...productOptions(products)
              ]}
              onChange={setProductId}
              placeholder="Buscar produto da nota..."
              loading={loading}
            />
          </Field>
          <div className="grid-2">
            <Field label="Numero da NF-e" hint="Numero da nota ja emitida (so digitos).">
              <input
                className="input"
                value={nfeNumber}
                onChange={(e) => setNfeNumber(e.target.value)}
                inputMode="numeric"
              />
            </Field>
            <Field
              label="Total da nota (kg)"
              hint="Quanto a nota faturou, em quilos (30 t = 30000). Vazio = sem controle de saldo."
            >
              <input
                className="input"
                value={totalKg}
                onChange={(e) => setTotalKg(e.target.value)}
                inputMode="decimal"
              />
            </Field>
          </div>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Salvando..." : "Salvar nota"}
          </button>
          <p className="desk-muted" style={{ marginTop: 8 }}>
            As notas sao usadas da mais antiga para a mais nova: quando o saldo de uma acaba, a
            proxima do mesmo produto assume. O saldo e baixado pela balanca a cada pesagem.
          </p>
        </div>
      )}
      <DataTable
        rows={invoices.data ?? []}
        rowKey={(invoice) => invoice.id}
        pageSize={0}
        empty={invoices.loading ? "Carregando..." : "Nenhuma nota de entrega futura."}
        columns={[
          {
            key: "nfe",
            header: "NF-e",
            render: (invoice) => <strong>{invoice.nfe_number}</strong>
          },
          {
            key: "product",
            header: "Produto",
            render: (invoice) =>
              invoice.product_id
                ? (productNames.get(invoice.product_id) ?? "Produto")
                : "Qualquer produto"
          },
          {
            key: "total",
            header: "Total da nota",
            numeric: true,
            render: (invoice) =>
              invoice.total_weight_kg != null
                ? `${Number(invoice.total_weight_kg).toLocaleString("pt-BR")} kg`
                : "Sem controle de saldo"
          },
          {
            key: "actions",
            header: "Acoes",
            numeric: true,
            render: (invoice) =>
              canEdit && (
                <span className="row-actions">
                  <IconAction
                    icon="trash"
                    label="Remover nota"
                    tone="danger"
                    onClick={() => void remove(invoice.id)}
                  />
                </span>
              )
          }
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

const WEEKDAYS = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];

/**
 * Bloco comercial e credito do cliente (forma de pagamento e transportadora padrao, exige NF,
 * conta de credito). Tem dono: o que se publica aqui vale em todas as balancas.
 */
function CommercialTab({ customer }: { customer: Customer }) {
  const user = useUser();
  const toast = useToast();
  const canEdit = user.canEditCustomers;
  const lists = useAsync(
    () => Promise.all([q.paymentMethods(user.companyId), q.carriers(user.companyId)]),
    [user.companyId]
  );
  useOnCadastroChange(lists.refresh, [...CADASTRO_TABLES.payment, ...CADASTRO_TABLES.carriers]);
  const [methods, carriers] = lists.data ?? [[], []];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cada balanca tem a sua copia de "Dinheiro", "Pix"...: o seletor mostra uma de cada, e a
  // escolha atual (que pode ser a copia de outra maquina) aparece pela representante.
  const methodGroups = useMemo(
    () => dedupePaymentMethods(methods.filter((m) => m.is_active)),
    [methods]
  );
  const methodRepresentative = useMemo(() => representativeIds(methodGroups), [methodGroups]);
  const currentMethodId = customer.default_payment_method_id ?? "";
  const [form, setForm] = useState({
    defaultPaymentMethodId: currentMethodId,
    defaultCarrierId: customer.default_carrier_id ?? "",
    nfRequired: customer.nf_required ?? false,
    creditAccountEnabled: customer.credit_account_enabled ?? false,
    creditMode: customer.credit_mode ?? "normal",
    creditPeriodicity: customer.credit_periodicity ?? "",
    creditClosingDay: customer.credit_closing_day?.toString() ?? "",
    creditSecondClosingDay: customer.credit_second_closing_day?.toString() ?? "",
    creditBoletoDays: customer.credit_boleto_days?.toString() ?? "",
    creditSecondBoletoDays: customer.credit_second_boleto_days?.toString() ?? "",
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
        creditSecondBoletoDays: form.creditSecondBoletoDays || null,
        creditClosingWeekday: form.creditClosingWeekday || null
      });
      toast.push("Bloco comercial publicado para as balancas.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="desk-muted" style={{ marginTop: 0 }}>
        Estas configuracoes tem dono: o que voce publicar aqui vale em todas as balancas.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={(e) => void onSubmit(e)}>
        <div className="grid-2">
          <Field label="Forma de pagamento padrao">
            <Picker
              // A escolha atual pode ser a copia de outra maquina: aparece pela representante.
              value={
                methodRepresentative.get(form.defaultPaymentMethodId) ?? form.defaultPaymentMethodId
              }
              loading={lists.loading}
              options={methodGroups.map(({ row: m }) => ({
                value: m.id,
                label: m.alias || m.name
              }))}
              onChange={(id) => setForm((f) => ({ ...f, defaultPaymentMethodId: id }))}
              placeholder="Buscar forma de pagamento..."
              allowEmpty
              emptyLabel="Sem forma padrao"
            />
          </Field>
          <Field label="Transportadora padrao">
            <Picker
              value={form.defaultCarrierId}
              loading={lists.loading}
              options={carriers
                .filter((c) => c.is_active)
                .map((c) => ({ value: c.id, label: c.name }))}
              onChange={(id) => setForm((f) => ({ ...f, defaultCarrierId: id }))}
              placeholder="Buscar transportadora..."
              allowEmpty
              emptyLabel="Sem transportadora padrao"
            />
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
            <div className="grid-2">
              <Field
                label="Dias p/ vencimento (2o fechamento)"
                hint="Quinzenal: prazo do 2o boleto"
              >
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={365}
                  value={form.creditSecondBoletoDays}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, creditSecondBoletoDays: e.target.value }))
                  }
                />
              </Field>
              <Field label="Dia da semana (semanal)">
                <select
                  className="select"
                  value={form.creditClosingWeekday}
                  onChange={(e) => setForm((f) => ({ ...f, creditClosingWeekday: e.target.value }))}
                >
                  <option value="">—</option>
                  {WEEKDAYS.map((label, index) => (
                    <option key={label} value={String(index)}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        )}
        {customer.credit_limit_cents != null && (
          <p style={{ color: "var(--kr-muted)" }}>
            Limite de credito (OMIE): {formatMoney(customer.credit_limit_cents)}
          </p>
        )}
        {canEdit && (
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Publicando..." : "Publicar"}
          </button>
        )}
      </form>
    </>
  );
}
