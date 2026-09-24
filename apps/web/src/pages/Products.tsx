import { useMemo, useState } from "react";

import { EmptyState, IconAction, SearchBar, SectionHead } from "../components/desk";
import { Picker } from "../components/Picker";
import { Alert, DataTable, Field, Modal, useToast } from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { formatDocument, formatMoney, parseMoneyToCents } from "../lib/format";
import { matchesSearch } from "../lib/operation";
import { q, type Product } from "../lib/queries";
import { useAsync } from "../lib/use-async";

/**
 * Aba Produtos da tela Cadastros (a `ProductsView` do desktop): o preco padrao de cada produto
 * e, logo abaixo, o preco especial por cliente. Todos veem; publicar preco e do comercial e do
 * gestor.
 */
export function ProductsSection() {
  const user = useUser();
  const toast = useToast();
  const canEdit = user.canEditPrices;
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
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{
    product: Product;
    customerId?: string;
    current: number | null;
  } | null>(null);
  const [customerId, setCustomerId] = useState("");

  const defaultByProduct = useMemo(
    () => new Map(defaults.map((p) => [p.product_id, p.unit_price_cents])),
    [defaults]
  );
  const visibleProducts = products.filter((p) =>
    matchesSearch(`${p.description} ${p.code ?? ""}`, search)
  );

  const special = useAsync(
    () => (customerId ? q.customerSpecialPrices(user.companyId, customerId) : Promise.resolve([])),
    [user.companyId, customerId]
  );
  const specialByProduct = useMemo(
    () => new Map((special.data ?? []).map((p) => [p.product_id, p.unit_price_cents])),
    [special.data]
  );
  const customerOptions = useMemo(
    () =>
      customers
        .filter((c) => c.is_active)
        .map((c) => ({
          value: c.id,
          label: c.trade_name || c.legal_name,
          hint: formatDocument(c.document) || undefined
        })),
    [customers]
  );

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
      <SectionHead
        title="Produtos"
        count={products.length}
        description="Produtos sincronizados do OMIE com o preco padrao usado na pesagem. Preco especial do cliente tem prioridade sobre o preco padrao."
      />
      {error && <Alert kind="error">{error}</Alert>}
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Buscar produto por nome ou codigo..."
        onRefresh={() => void reload()}
      />
      {products.length === 0 && !loading ? (
        <EmptyState
          title="Nenhum produto sincronizado."
          hint="Os produtos vem do OMIE pela balanca principal."
        />
      ) : (
        <DataTable
          rows={visibleProducts}
          rowKey={(p) => p.id}
          empty={loading ? "Carregando..." : "Nenhum produto encontrado."}
          columns={[
            { key: "desc", header: "Produto", render: (p) => <strong>{p.description}</strong> },
            { key: "code", header: "Codigo", render: (p) => p.code || "-" },
            {
              key: "price",
              header: "Preco padrao",
              numeric: true,
              render: (p) =>
                defaultByProduct.has(p.id) ? (
                  <strong>{formatMoney(defaultByProduct.get(p.id))}/ton</strong>
                ) : (
                  <span style={{ color: "var(--kr-warning)", fontWeight: 700 }}>Sem preco</span>
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
                      label={defaultByProduct.has(p.id) ? "Editar preco" : "Definir preco"}
                      onClick={() =>
                        setEditing({ product: p, current: defaultByProduct.get(p.id) ?? null })
                      }
                    />
                  </span>
                )
            }
          ]}
        />
      )}

      <SectionHead
        title="Preco especial por cliente"
        description="Escolha o cliente para ver o preco dele em cada produto. Sem preco especial, vale o padrao."
      />
      <div style={{ maxWidth: 420, marginBottom: 10 }}>
        <Picker
          value={customerId}
          options={customerOptions}
          onChange={setCustomerId}
          placeholder="Buscar cliente..."
        />
      </div>
      {!customerId ? (
        <EmptyState title="Nenhum cliente escolhido." hint="Busque o cliente no campo acima." />
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
                      label="Definir preco especial"
                      onClick={() =>
                        setEditing({
                          product: p,
                          customerId,
                          current: specialByProduct.get(p.id) ?? null
                        })
                      }
                    />
                    {specialByProduct.has(p.id) && (
                      <IconAction
                        icon="trash"
                        label="Remover preco especial"
                        tone="danger"
                        onClick={() => void removeSpecial(p)}
                      />
                    )}
                  </span>
                )
            }
          ]}
        />
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
