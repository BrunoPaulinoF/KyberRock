import { useMemo, useState } from "react";

import { Alert, DataTable, Field, Modal, PageHead, useToast } from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { formatMoney, parseMoneyToCents } from "../lib/format";
import { q, type Customer, type Product } from "../lib/queries";
import { useAsync } from "../lib/use-async";

/** Precos: padrao por produto e especial por cliente. So o gestor chega aqui. */
export function Prices() {
  const user = useUser();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(
    () =>
      Promise.all([
        q.products(user.companyId),
        q.productDefaultPrices(user.companyId),
        q.customers(user.companyId)
      ]),
    [user.companyId]
  );
  const [products, defaults, customers] = data ?? [[], [], []];
  const [tab, setTab] = useState<"default" | "special">("default");
  const [editing, setEditing] = useState<{
    product: Product;
    customerId?: string;
    current: number | null;
  } | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");

  const defaultByProduct = useMemo(
    () => new Map(defaults.map((p) => [p.product_id, p.unit_price_cents])),
    [defaults]
  );

  const special = useAsync(
    () => (customerId ? q.customerSpecialPrices(user.companyId, customerId) : Promise.resolve([])),
    [user.companyId, customerId]
  );
  const specialByProduct = useMemo(
    () => new Map((special.data ?? []).map((p) => [p.product_id, p.unit_price_cents])),
    [special.data]
  );

  const customerOptions = useMemo(() => {
    const needle = customerSearch.trim().toLowerCase();
    return customers
      .filter((c) => c.is_active && (!needle || c.trade_name.toLowerCase().includes(needle)))
      .slice(0, 50);
  }, [customers, customerSearch]);

  async function save(cents: number) {
    if (!editing) return;
    try {
      if (editing.customerId) {
        await callWebApi("set_customer_special_price", {
          customerId: editing.customerId,
          productId: editing.product.id,
          unitPriceCents: cents
        });
        await special.reload();
      } else {
        await callWebApi("set_product_default_price", {
          productId: editing.product.id,
          unitPriceCents: cents
        });
        await reload();
      }
      toast.push("Preco publicado para as balancas.");
      setEditing(null);
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  }

  async function removeSpecial(product: Product) {
    if (!customerId) return;
    try {
      await callWebApi("remove_customer_special_price", { customerId, productId: product.id });
      toast.push("Preco especial removido; volta a valer o padrao.");
      await special.reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  }

  return (
    <>
      <PageHead
        title="Precos"
        description="O preco tem dono: o que voce publica aqui vale em todas as balancas da pedreira."
      />
      {error && <Alert kind="error">{error}</Alert>}
      <div className="tabs">
        <button
          className={`tab ${tab === "default" ? "active" : ""}`}
          onClick={() => setTab("default")}
        >
          Preco padrao
        </button>
        <button
          className={`tab ${tab === "special" ? "active" : ""}`}
          onClick={() => setTab("special")}
        >
          Preco especial por cliente
        </button>
      </div>

      {tab === "default" ? (
        <div className="panel">
          <DataTable
            rows={products}
            rowKey={(p) => p.id}
            empty={loading ? "Carregando..." : "Nenhum produto (os produtos vem do OMIE)."}
            columns={[
              { key: "code", header: "Codigo", render: (p) => p.code },
              { key: "desc", header: "Produto", render: (p) => <strong>{p.description}</strong> },
              {
                key: "price",
                header: "Preco / ton",
                numeric: true,
                render: (p) =>
                  defaultByProduct.has(p.id) ? (
                    formatMoney(defaultByProduct.get(p.id))
                  ) : (
                    <span style={{ color: "var(--muted)" }}>sem preco</span>
                  )
              },
              {
                key: "actions",
                header: "",
                render: (p) => (
                  <button
                    className="btn small"
                    onClick={() =>
                      setEditing({ product: p, current: defaultByProduct.get(p.id) ?? null })
                    }
                  >
                    Definir
                  </button>
                )
              }
            ]}
          />
        </div>
      ) : (
        <div className="panel">
          <div className="toolbar">
            <input
              className="input"
              placeholder="Buscar cliente"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <select
              className="select"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              style={{ minWidth: 280 }}
            >
              <option value="">Escolha o cliente</option>
              {customerOptions.map((c: Customer) => (
                <option key={c.id} value={c.id}>
                  {c.trade_name}
                </option>
              ))}
            </select>
          </div>
          {!customerId ? (
            <div className="empty">
              Escolha um cliente para ver e definir os precos especiais dele.
            </div>
          ) : (
            <DataTable
              rows={products}
              rowKey={(p) => p.id}
              empty={special.loading ? "Carregando..." : "Nenhum produto."}
              columns={[
                { key: "desc", header: "Produto", render: (p) => <strong>{p.description}</strong> },
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
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )
                },
                {
                  key: "actions",
                  header: "",
                  render: (p) => (
                    <span className="actions">
                      <button
                        className="btn small"
                        onClick={() =>
                          setEditing({
                            product: p,
                            customerId,
                            current: specialByProduct.get(p.id) ?? null
                          })
                        }
                      >
                        Definir
                      </button>
                      {specialByProduct.has(p.id) && (
                        <button className="btn small danger" onClick={() => void removeSpecial(p)}>
                          Remover
                        </button>
                      )}
                    </span>
                  )
                }
              ]}
            />
          )}
        </div>
      )}

      {editing && (
        <PriceModal
          product={editing.product}
          current={editing.current}
          special={Boolean(editing.customerId)}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </>
  );
}

function PriceModal({
  product,
  current,
  special,
  onClose,
  onSave
}: {
  product: Product;
  current: number | null;
  special: boolean;
  onClose: () => void;
  onSave: (cents: number) => Promise<void>;
}) {
  const [value, setValue] = useState(
    current != null ? (current / 100).toFixed(2).replace(".", ",") : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`${special ? "Preco especial" : "Preco padrao"} — ${product.description}`}
      description="Valor por tonelada, em reais."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              const cents = parseMoneyToCents(value);
              if (cents == null) {
                setError("Informe um valor valido, ex.: 65,00");
                return;
              }
              setBusy(true);
              await onSave(cents);
              setBusy(false);
            }}
          >
            {busy ? "Publicando..." : "Publicar"}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <Field label="Preco (R$ / ton)">
        <input
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          placeholder="65,00"
        />
      </Field>
    </Modal>
  );
}
