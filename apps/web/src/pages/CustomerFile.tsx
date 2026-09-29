import { Car, FileText, SearchCheck, Tag, Truck, Wallet, type LucideIcon } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { ConditionLegend } from "../components/ConditionLegend";
import { CustomerBalanceCard } from "../components/CustomerPanels";
import { IconAction, PlateBadge, SearchBar } from "../components/desk";
import { Picker } from "../components/Picker";
import { PricePasswordField } from "../components/PricePassword";
import {
  Alert,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Pill,
  Tabs,
  Warnings,
  useConfirm,
  useToast
} from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import {
  customerFreightEntries,
  defaultPriceByProduct,
  futureInvoiceFill,
  normalizeNfeNumber,
  parseFutureInvoices,
  parseTotalWeightKg,
  quantityLabel,
  type CustomerFreightEntry,
  type FutureInvoice,
  type FutureInvoiceItem
} from "../lib/customer-cadastro";
import { dedupePaymentMethods, dedupeVehicles, representativeIds } from "../lib/dedupe";
import { FREIGHT_MODALITIES } from "../lib/desktop/freight";
import { conditionTextOf, describePaymentCondition } from "../lib/entry-freight";
import { formatDate, formatMoney, formatPlate, parseMoneyToCents } from "../lib/format";
import { matchesSearch } from "../lib/operation";
import { q, type Carrier, type Customer, type Product, type Vehicle } from "../lib/queries";
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
  { id: "comercial", label: "Comercial e crédito", icon: Wallet },
  { id: "precos", label: "Preços especiais", icon: Tag },
  { id: "frete", label: "Frete", icon: Truck },
  { id: "transporte", label: "Transporte", icon: Car },
  { id: "entrega", label: "Entrega futura", icon: FileText }
];

const TAB_HINTS: Record<CustomerFileTab, string> = {
  comercial:
    "Saldo do cliente, forma e condição de pagamento, transportadora padrão, nota fiscal e conta de crédito (fiado / pré-pago).",
  precos:
    "Preço especial do cliente em cada produto. Ele vale no lugar do preço padrão na pesagem.",
  frete:
    "Valor de frete por tonelada combinado com o cliente — para todos os produtos ou por produto.",
  transporte:
    "Tipo de frete padrão, transportadoras e placas do cliente. A nova entrada já abre com eles.",
  entrega:
    "Notas de venda para entrega futura (CFOP 5.922): cada pesagem do produto sai com a referência da nota."
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
      <Tabs label="Ficha do cliente" tabs={TABS} active={tab} onChange={setTab} />
      {tab === "comercial" && <CommercialTab customer={customer} />}
      {tab === "precos" && <SpecialPricesTab customer={customer} />}
      {tab === "frete" && <FreightTab customer={customer} />}
      {tab === "transporte" && <TransportTab customer={customer} />}
      {tab === "entrega" && <FutureBillingTab customer={customer} />}
    </Modal>
  );
}

/**
 * Produtos e preco padrao de cada um — a base das abas Precos e Frete. A mesma leitura (e a
 * mesma chave de memoria) da aba Produtos dos Cadastros (`Products.tsx`).
 */
function useProducts() {
  const user = useUser();
  const base = useAsync(
    () => Promise.all([q.products(user.companyId), q.productDefaultPrices(user.companyId)]),
    [user.companyId],
    { key: `produtos:${user.companyId}` }
  );
  useOnCadastroChange(base.refresh, CADASTRO_TABLES.products);
  const [products, defaults] = base.data ?? [[], []];
  const defaultByProduct = useMemo(
    () => defaultPriceByProduct(products, defaults),
    [products, defaults]
  );
  return {
    products,
    defaultByProduct,
    loading: base.loading,
    error: base.error,
    reload: base.reload
  };
}

function productOptions(products: Product[]) {
  return products.map((p) => ({
    value: p.id,
    label: p.description,
    hint: p.code ? `Código ${p.code}` : undefined
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
  const confirm = useConfirm();
  const canEdit = user.canEditPrices;
  const askPassword = user.requiresPricePassword;
  const { products, defaultByProduct, loading, error, reload } = useProducts();
  const special = useAsync(
    () => q.customerSpecialPrices(user.companyId, customer.id),
    [user.companyId, customer.id],
    { key: `produtos:especial:${user.companyId}:${customer.id}` }
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
  const [fieldErrors, setFieldErrors] = useState<{ product?: string; value?: string }>({});
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
    setFieldErrors({});
  }

  function passwordOrError(): string | undefined | false {
    if (!askPassword) return undefined;
    if (!password.trim()) {
      setFormError("Digite a senha de preço que o comercial passou.");
      return false;
    }
    return password.trim();
  }

  async function save() {
    if (!productId) {
      setFieldErrors({ product: "Escolha o produto." });
      return;
    }
    const cents = parseMoneyToCents(value);
    if (cents == null || cents <= 0) {
      setFieldErrors({ value: "Informe um preço válido, ex.: 65,00" });
      return;
    }
    setFieldErrors({});
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
      toast.push("Preço especial publicado para as balanças.");
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
    const ok = await confirm({
      title: "Remover preço especial?",
      message: (
        <>
          <strong>{customer.trade_name || customer.legal_name}</strong> volta a pagar o preço padrão
          de <strong>{product.description}</strong>.
        </>
      ),
      confirmLabel: "Remover",
      tone: "danger"
    });
    if (!ok) return;
    setFormError(null);
    try {
      await callWebApi("remove_customer_special_price", {
        customerId: customer.id,
        productId: product.id,
        pricePassword
      });
      toast.push("Preço especial removido; volta a valer o padrão.");
      setPassword("");
      await special.reload();
    } catch (caught) {
      setFormError(errorMessage(caught));
    }
  }

  return (
    <>
      {(error ?? special.error) && (
        <ErrorState
          message={error ?? special.error ?? ""}
          onRetry={() => {
            void reload();
            void special.reload();
          }}
        />
      )}
      {canEdit && (
        <div className="file-form">
          {formError && <Alert kind="error">{formError}</Alert>}
          <div className="grid-2">
            <Field label="Produto" error={fieldErrors.product} required>
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
              label="Preço especial (R$ / ton)"
              hint={
                productId && defaultByProduct.has(productId)
                  ? `Preço padrão: ${formatMoney(defaultByProduct.get(productId))}/ton`
                  : undefined
              }
              error={fieldErrors.value}
            >
              <input
                className="input"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setFieldErrors((current) => ({ ...current, value: undefined }));
                }}
                placeholder="65,00"
                inputMode="decimal"
                required
              />
            </Field>
          </div>
          {askPassword && <PricePasswordField value={password} onChange={setPassword} />}
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Publicando..." : "Salvar preço especial"}
          </button>
        </div>
      )}

      <SearchBar value={search} onChange={setSearch} placeholder="Buscar produto...">
        <label className="check" style={{ margin: 0, whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={onlySpecial}
            onChange={(e) => setOnlySpecial(e.target.checked)}
          />
          Só com preço especial ({specialByProduct.size})
        </label>
      </SearchBar>
      <DataTable
        rows={rows}
        rowKey={(p) => p.id}
        pageSize={0}
        loading={loading || special.loading}
        empty={onlySpecial ? "Este cliente não tem preço especial." : "Nenhum produto encontrado."}
        columns={[
          {
            key: "desc",
            header: "Produto",
            sortValue: (p) => p.description,
            render: (p) => (
              <>
                <strong>{p.description}</strong>
                {p.code && <span className="cell-sub">Código {p.code}</span>}
              </>
            )
          },
          {
            key: "default",
            header: "Padrão",
            numeric: true,
            sortValue: (p) => defaultByProduct.get(p.id) ?? null,
            render: (p) =>
              defaultByProduct.has(p.id) ? formatMoney(defaultByProduct.get(p.id)) : "—"
          },
          {
            key: "special",
            header: "Especial",
            numeric: true,
            sortValue: (p) => specialByProduct.get(p.id) ?? null,
            render: (p) =>
              specialByProduct.has(p.id) ? (
                <strong>{formatMoney(specialByProduct.get(p.id))}</strong>
              ) : (
                <span style={{ color: "var(--kr-muted)" }}>—</span>
              )
          },
          {
            key: "actions",
            header: "Ações",
            numeric: true,
            render: (p) =>
              canEdit && (
                <span className="row-actions">
                  <IconAction
                    icon="edit"
                    label={
                      specialByProduct.has(p.id)
                        ? "Editar preço especial"
                        : "Definir preço especial"
                    }
                    onClick={() => pick(p)}
                  />
                  {specialByProduct.has(p.id) && (
                    <IconAction
                      icon="trash"
                      label="Remover preço especial"
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
  const confirm = useConfirm();
  const canEdit = user.canEditPrices;
  const askPassword = user.requiresPricePassword;
  const { products, loading } = useProducts();
  const rules = useAsync(
    () => q.customerFreightRules(user.companyId, customer.id),
    [user.companyId, customer.id],
    { key: `ficha:frete:${user.companyId}:${customer.id}` }
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
  const [valueError, setValueError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function passwordOrError(): string | undefined | false {
    if (!askPassword) return undefined;
    if (!password.trim()) {
      setFormError("Digite a senha de preço que o comercial passou.");
      return false;
    }
    return password.trim();
  }

  async function save() {
    const cents = parseMoneyToCents(value);
    if (cents == null || cents <= 0) {
      setValueError("Informe o frete por tonelada, ex.: 15,00");
      return;
    }
    setValueError(null);
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
      toast.push("Frete publicado para as balanças.");
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
    const ok = await confirm({
      title: "Remover frete?",
      message: (
        <>
          Sai o frete de <strong>{formatMoney(entry.baseValueCents)}/ton</strong> (
          {entry.scopeLabel}, {entry.modalityLabel}) deste cliente.
        </>
      ),
      confirmLabel: "Remover",
      tone: "danger"
    });
    if (!ok) return;
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
      {rules.error && <ErrorState message={rules.error} onRetry={() => void rules.reload()} />}
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
            <Field label="Frete (R$ / ton)" error={valueError}>
              <input
                className="input"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setValueError(null);
                }}
                placeholder="15,00"
                inputMode="decimal"
                required
              />
            </Field>
          </div>
          {askPassword && <PricePasswordField value={password} onChange={setPassword} />}
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Publicando..." : "Salvar frete"}
          </button>
          <p className="desk-muted" style={{ marginTop: 8 }}>
            Vale quando a pesagem é com frete (valor na nota ou valor só no sistema). O valor
            combinado aqui vence o que o cliente usou na última venda.
          </p>
        </div>
      )}
      <DataTable
        rows={entries}
        rowKey={(entry) => entry.key}
        pageSize={0}
        loading={rules.loading}
        empty="Nenhum frete cadastrado para este cliente."
        columns={[
          {
            key: "scope",
            header: "Vale para",
            sortValue: (entry) => entry.scopeLabel,
            render: (entry) => <strong>{entry.scopeLabel}</strong>
          },
          {
            key: "modality",
            header: "Tipo de frete",
            render: (entry) => (
              <>
                {entry.modalityLabel}
                {entry.source === "last_used" && (
                  <span className="cell-sub">Memória da última venda</span>
                )}
              </>
            )
          },
          {
            key: "value",
            header: "R$ / ton",
            numeric: true,
            sortValue: (entry) => entry.baseValueCents,
            render: (entry) => <strong>{formatMoney(entry.baseValueCents)}</strong>
          },
          {
            key: "actions",
            header: "Ações",
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
  const confirm = useConfirm();
  const canEdit = user.canEditCustomers;
  const data = useAsync(
    () =>
      Promise.all([
        q.carriers(user.companyId),
        q.vehicles(user.companyId),
        q.customerCarrierLinks(customer.id),
        q.customerVehicleLinks(user.companyId, customer.id)
      ]),
    [user.companyId, customer.id],
    { key: `ficha:transporte:${user.companyId}:${customer.id}` }
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
      "Tipo de frete padrão salvo."
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

  // Desvincular pergunta antes: nao ha "Desfazer" (voltar e vincular de novo pelo seletor).
  async function unlinkCarrier(carrier: Carrier) {
    const ok = await confirm({
      title: "Remover transportadora do cliente?",
      message: (
        <>
          <strong>{carrier.name}</strong> deixa de ser oferecida na nova entrada deste cliente.
        </>
      ),
      confirmLabel: "Remover",
      tone: "danger"
    });
    if (ok) await linkCarrier(carrier.id, false);
  }

  async function unlinkVehicle(vehicle: Vehicle) {
    const ok = await confirm({
      title: "Remover placa do cliente?",
      message: (
        <>
          A placa <strong>{formatPlate(vehicle.plate)}</strong> deixa de abrir junto com este
          cliente na nova entrada.
        </>
      ),
      confirmLabel: "Remover",
      tone: "danger"
    });
    if (ok) await linkVehicle(vehicle.id, false);
  }

  return (
    <>
      {data.error && <ErrorState message={data.error} onRetry={() => void data.reload()} />}
      {error && <Alert kind="error">{error}</Alert>}
      <Field
        label="Tipo de frete padrão"
        hint="Preenche a nova entrada quando este cliente é escolhido. O operador ainda pode trocar."
      >
        <select
          className="select"
          value={modality}
          disabled={!canEdit || busy}
          onChange={(e) => saveModality(e.target.value)}
        >
          <option value="">Sem padrão (escolher na entrada)</option>
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
                {carrier.id === customer.default_carrier_id && <Pill tone="success">PADRÃO</Pill>}
              </span>
              {canEdit && (
                <button
                  className="btn small ghost-danger"
                  disabled={busy}
                  onClick={() => void unlinkCarrier(carrier)}
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
          hint="A nova entrada abre o campo Placa já com estas. A placa precisa estar cadastrada em Transporte > Placas."
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
                  onClick={() => void unlinkVehicle(vehicle)}
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
  const confirm = useConfirm();
  const canEdit = user.canEditCustomers;
  const { products, loading } = useProducts();
  const invoices = useAsync(
    () => q.customerFutureBillingInvoices(user.companyId, customer.id),
    [user.companyId, customer.id],
    { key: `ficha:entrega:${user.companyId}:${customer.id}` }
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
  const [fieldErrors, setFieldErrors] = useState<{ nfe?: string; product?: string }>({});
  const [busy, setBusy] = useState(false);
  // O que o OMIE disse da nota digitada: produto e volume vem da propria NF-e.
  const [lookup, setLookup] = useState<{ invoices: FutureInvoice[]; warnings: string[] } | null>(
    null
  );
  const [lookupBusy, setLookupBusy] = useState(false);
  const [fillNotes, setFillNotes] = useState<string[]>([]);

  function applyItem(item: FutureInvoiceItem) {
    const fill = futureInvoiceFill(item);
    if (fill.productId) setProductId(fill.productId);
    setTotalKg(fill.totalKg);
    setFillNotes(fill.notes);
  }

  async function lookupInvoice() {
    const number = normalizeNfeNumber(nfeNumber);
    if (!number) {
      setFieldErrors({ nfe: "Digite o número da NF-e para buscar no OMIE." });
      return;
    }
    setLookupBusy(true);
    setFormError(null);
    setFieldErrors({});
    setFillNotes([]);
    setLookup(null);
    try {
      const result = await callWebApi("lookup_future_billing_invoice", {
        customerId: customer.id,
        nfeNumber: number
      });
      const found = parseFutureInvoices(result);
      setLookup({ invoices: found, warnings: result.warnings });
      // Nota de um item so (o caso comum): ja preenche. Mais de um, a pessoa escolhe abaixo.
      const items = found.flatMap((invoice) => invoice.items);
      if (items.length === 1) applyItem(items[0]);
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setLookupBusy(false);
    }
  }

  async function save() {
    const errors: { nfe?: string; product?: string } = {};
    if (!normalizeNfeNumber(nfeNumber)) errors.nfe = "Informe o número da NF-e.";
    if (!productId)
      errors.product = 'Escolha o produto da nota (ou "Qualquer produto do cliente").';
    setFieldErrors(errors);
    if (errors.nfe || errors.product) return;
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
      setLookup(null);
      setFillNotes([]);
      await invoices.reload();
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(invoice: { id: string; nfe_number: string | null }) {
    const ok = await confirm({
      title: "Remover nota de entrega futura?",
      message: (
        <>
          As próximas pesagens deste cliente deixam de sair com a referência da NF-e{" "}
          <strong>{invoice.nfe_number}</strong>.
        </>
      ),
      confirmLabel: "Remover",
      tone: "danger",
      irreversible: true
    });
    if (!ok) return;
    try {
      await callWebApi("remove_customer_future_billing_invoice", { id: invoice.id });
      toast.push("Nota removida.");
      await invoices.reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  }

  return (
    <>
      {invoices.error && (
        <ErrorState message={invoices.error} onRetry={() => void invoices.reload()} />
      )}
      {canEdit && (
        <div className="file-form">
          {formError && <Alert kind="error">{formError}</Alert>}
          <Field
            label="Número da NF-e"
            hint="Número da nota já emitida. Buscar no OMIE traz o produto e o total da própria nota."
            error={fieldErrors.nfe}
            required
          >
            <div className="input-with-action">
              <input
                className="input"
                value={nfeNumber}
                aria-label="Número da NF-e"
                aria-invalid={fieldErrors.nfe ? true : undefined}
                onChange={(e) => {
                  setNfeNumber(e.target.value);
                  setFieldErrors((current) => ({ ...current, nfe: undefined }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void lookupInvoice();
                  }
                }}
                inputMode="numeric"
              />
              <button
                type="button"
                className="btn"
                onClick={() => void lookupInvoice()}
                disabled={lookupBusy}
                title="Buscar a nota no OMIE e preencher produto e total"
              >
                <SearchCheck size={15} />
                {lookupBusy ? "Buscando..." : "Buscar no OMIE"}
              </button>
            </div>
          </Field>
          {lookup && (
            <FutureInvoiceLookup
              invoices={lookup.invoices}
              warnings={lookup.warnings}
              onUse={applyItem}
            />
          )}
          {fillNotes.length > 0 && (
            <Alert kind="info">
              {fillNotes.map((note) => (
                <div key={note}>{note}</div>
              ))}
            </Alert>
          )}
          <div className="grid-2">
            <Field label="Produto da nota" error={fieldErrors.product} required>
              <Picker
                value={productId}
                options={[
                  { value: ANY_PRODUCT, label: "Qualquer produto do cliente" },
                  ...productOptions(products)
                ]}
                onChange={(id) => {
                  setProductId(id);
                  setFieldErrors((current) => ({ ...current, product: undefined }));
                }}
                placeholder="Buscar produto da nota..."
                loading={loading}
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
            As notas são usadas da mais antiga para a mais nova: quando o saldo de uma acaba, a
            próxima do mesmo produto assume. O saldo é baixado pela balança a cada pesagem.
          </p>
        </div>
      )}
      <DataTable
        rows={invoices.data ?? []}
        rowKey={(invoice) => invoice.id}
        pageSize={0}
        loading={invoices.loading}
        empty="Nenhuma nota de entrega futura."
        columns={[
          {
            key: "nfe",
            header: "NF-e",
            sortValue: (invoice) => invoice.nfe_number,
            render: (invoice) => <strong>{invoice.nfe_number}</strong>
          },
          {
            key: "product",
            header: "Produto",
            sortValue: (invoice) =>
              invoice.product_id
                ? (productNames.get(invoice.product_id) ?? "Produto")
                : "Qualquer produto",
            render: (invoice) =>
              invoice.product_id
                ? (productNames.get(invoice.product_id) ?? "Produto")
                : "Qualquer produto"
          },
          {
            key: "total",
            header: "Total da nota",
            numeric: true,
            sortValue: (invoice) =>
              invoice.total_weight_kg != null ? Number(invoice.total_weight_kg) : null,
            render: (invoice) =>
              invoice.total_weight_kg != null
                ? `${Number(invoice.total_weight_kg).toLocaleString("pt-BR")} kg`
                : "Sem controle de saldo"
          },
          {
            key: "actions",
            header: "Ações",
            numeric: true,
            render: (invoice) =>
              canEdit && (
                <span className="row-actions">
                  <IconAction
                    icon="trash"
                    label="Remover nota"
                    tone="danger"
                    onClick={() => void remove(invoice)}
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

/** O que o OMIE achou da nota: cada item com o botao de usar no formulario. */
function FutureInvoiceLookup({
  invoices,
  warnings,
  onUse
}: {
  invoices: FutureInvoice[];
  warnings: string[];
  onUse: (item: FutureInvoiceItem) => void;
}) {
  const single = invoices.flatMap((invoice) => invoice.items).length === 1;
  return (
    <div className="future-lookup">
      <Warnings items={warnings} />
      {invoices.map((invoice) => (
        <div key={`${invoice.invoiceNumber}-${invoice.series ?? ""}`}>
          <p className="future-lookup-title">
            <strong>
              NF-e {invoice.invoiceNumber}
              {invoice.series ? ` · série ${invoice.series}` : ""}
            </strong>
            {invoice.issueDate && ` · emitida em ${formatDate(invoice.issueDate)}`}
            {invoice.customerName && ` · ${invoice.customerName}`}
          </p>
          {invoice.items.length === 0 ? (
            <p className="desk-muted">A nota não tem itens de produto.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Produto na nota</th>
                    <th>Produto do cadastro</th>
                    <th className="num">Quantidade</th>
                    <th className="num">Total (kg)</th>
                    <th className="num">{single ? "" : "Usar"}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item, index) => (
                    <tr key={`${item.invoiceDescription}-${index}`}>
                      <td>{item.invoiceDescription}</td>
                      <td>
                        {item.productDescription ?? (
                          <span className="desk-muted">Não casou — escolha abaixo</span>
                        )}
                      </td>
                      <td className="num">{quantityLabel(item)}</td>
                      <td className="num">
                        {item.totalWeightKg === null
                          ? "—"
                          : item.totalWeightKg.toLocaleString("pt-BR")}
                      </td>
                      <td className="num">
                        {single ? (
                          <span className="desk-muted">Preenchido</span>
                        ) : (
                          <button type="button" className="btn small" onClick={() => onUse(item)}>
                            Usar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/**
 * Bloco comercial e credito do cliente (forma de pagamento e transportadora padrao, exige NF,
 * conta de credito). Tem dono: o que se publica aqui vale em todas as balancas. A condicao de
 * pagamento padrao mora ao lado da forma, mas grava pelo cadastro do cliente (sobe ao OMIE). No
 * topo, o saldo do cliente (`CustomerBalanceCard`).
 */
function CommercialTab({ customer }: { customer: Customer }) {
  const user = useUser();
  const toast = useToast();
  const canEdit = user.canEditCustomers;
  const lists = useAsync(
    () =>
      Promise.all([
        q.paymentMethods(user.companyId),
        q.carriers(user.companyId),
        q.paymentTerms(user.companyId)
      ]),
    [user.companyId],
    { key: `ficha:listas:${user.companyId}` }
  );
  useOnCadastroChange(lists.refresh, [...CADASTRO_TABLES.payment, ...CADASTRO_TABLES.carriers]);
  const [methods, carriers, terms] = lists.data ?? [[], [], []];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conditionError, setConditionError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  // A condicao padrao fica aqui, ao lado da forma de pagamento (o combinado com o cliente e um
  // par). Como no cadastro, e TEXTO ("30", "7 14 21"): a web-api reusa a condicao com a mesma
  // regra ou cria uma. Ela nao e do bloco comercial — sobe ao OMIE com o cliente
  // (`upsert_customer`), por isso so vai quando mudou.
  const [savedCondition, setSavedCondition] = useState<string | null>(null);
  const [conditionText, setConditionText] = useState<string | null>(null);
  const currentCondition = useMemo(() => {
    const term = terms.find((t) => t.id === customer.default_payment_term_id);
    return term ? conditionTextOf(term.rules_json, term.name) : "";
  }, [terms, customer.default_payment_term_id]);
  const initialCondition = savedCondition ?? currentCondition;
  const condition = conditionText ?? initialCondition;
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
    const conditionChanged = condition.trim() !== initialCondition.trim();
    // So confere o que foi digitado: a condicao guardada pode ter um nome antigo do OMIE que o
    // leitor nao reconhece, e isso nao pode travar o resto do bloco comercial.
    if (conditionChanged && describePaymentCondition(condition).status === "invalid") {
      setConditionError(
        'Condição de pagamento padrão inválida. Veja os formatos em "Como escrever".'
      );
      return;
    }
    setBusy(true);
    setError(null);
    setConditionError(null);
    setWarnings([]);
    try {
      if (conditionChanged) {
        const result = await callWebApi("upsert_customer", {
          id: customer.id,
          defaultPaymentCondition: condition.trim() || null
        });
        setWarnings(result.warnings);
        setSavedCondition(condition.trim());
        setConditionText(null);
      }
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
      toast.push("Bloco comercial publicado para as balanças.");
    } catch (caught) {
      const message = errorMessage(caught);
      // A recusa da condicao aparece embaixo dela; o resto, no alto do bloco.
      if (/condi[cç][aã]o de pagamento/i.test(message)) setConditionError(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="cp" style={{ marginBottom: 14 }}>
        <CustomerBalanceCard customer={customer} />
      </div>
      <p className="desk-muted" style={{ marginTop: 0 }}>
        Estas configurações têm dono: o que você publicar aqui vale em todas as balanças.
      </p>
      {lists.error && <ErrorState message={lists.error} onRetry={() => void lists.reload()} />}
      {error && <Alert kind="error">{error}</Alert>}
      <Warnings items={warnings} />
      <form onSubmit={(e) => void onSubmit(e)}>
        <div className="grid-2">
          <Field label="Forma de pagamento padrão">
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
              emptyLabel="Sem forma padrão"
            />
          </Field>
          <Field
            label="Condição de pagamento padrão"
            hint="Vazio = sem padrão. Se não existir no OMIE, é criada no envio."
            error={conditionError}
          >
            <input
              className="input"
              value={condition}
              onChange={(e) => {
                setConditionText(e.target.value);
                setConditionError(null);
              }}
              placeholder='Ex.: "30", "7 14 21", "3 parcelas" ou "s+20"'
              disabled={!canEdit}
            />
          </Field>
        </div>
        <ConditionLegend value={condition} />
        <div className="grid-2">
          <Field label="Transportadora padrão">
            <Picker
              value={form.defaultCarrierId}
              loading={lists.loading}
              options={carriers
                .filter((c) => c.is_active)
                .map((c) => ({ value: c.id, label: c.name }))}
              onChange={(id) => setForm((f) => ({ ...f, defaultCarrierId: id }))}
              placeholder="Buscar transportadora..."
              allowEmpty
              emptyLabel="Sem transportadora padrão"
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
          Conta de crédito habilitada (fiado / pré-pago)
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
                  <option value="normal">Fiado (fechamento periódico)</option>
                  <option value="prepaid">Pré-pago (adiantamento no OMIE)</option>
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
              <Field label="2º fechamento (quinzenal)">
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
                label="Dias p/ vencimento (2º fechamento)"
                hint="Quinzenal: prazo do 2º boleto"
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
            Limite de crédito (OMIE): {formatMoney(customer.credit_limit_cents)}
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
