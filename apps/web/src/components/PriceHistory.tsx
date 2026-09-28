import { useState } from "react";

import { useUser } from "../lib/auth";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import { formatDateTime, formatMoney } from "../lib/format";
import {
  PRICE_HISTORY_TABLES,
  priceChangeActionLabel,
  priceChangePercent,
  priceChangeSourceLabel,
  priceChangeTone,
  priceHistoryPage,
  type PriceChange,
  type PriceHistorySource
} from "../lib/price-history";
import { usePaged } from "../lib/use-paged";
import { useDebounced } from "../pages/Customers";
import { Pill, SearchBar, SectionHead } from "./desk";
import { Alert, DataTable, LoadMore } from "./ui";

const SOURCE_OPTIONS: Array<{ value: PriceHistorySource; label: string }> = [
  { value: "todas", label: "Balanca e site" },
  { value: "balanca", label: "So balanca" },
  { value: "site", label: "So site" }
];

function priceOrDash(cents: number | null): string {
  return cents === null ? "—" : formatMoney(cents);
}

/**
 * Historico das alteracoes de preco especial (`lib/price-history.ts`): quem adicionou, trocou
 * ou excluiu, quando, e o preco de antes e de depois. Na balanca cada uma dessas alteracoes
 * pediu a senha que o comercial ve na tela "Senha de preco". Entrada nova aparece na hora, pelo
 * aviso de cadastro da nuvem.
 */
export function PriceHistory() {
  const user = useUser();
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<PriceHistorySource>("todas");
  const debouncedSearch = useDebounced(search);

  const list = usePaged(
    (from, to) => priceHistoryPage(user.companyId, { search: debouncedSearch, source }, from, to),
    [user.companyId, debouncedSearch, source]
  );
  useOnCadastroChange(list.refresh, PRICE_HISTORY_TABLES);

  return (
    <section className="price-history" aria-label="Alteracoes de preco especial">
      <SectionHead
        title="Alteracoes de preco especial"
        count={list.total}
        description="Tudo o que foi adicionado, trocado ou excluido — na balanca (com a senha de preco) e no site. Atualiza sozinho."
      />
      {list.error && <Alert kind="error">{list.error}</Alert>}
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Buscar por cliente, produto ou quem alterou..."
        onRefresh={() => void list.refresh()}
      >
        <select
          aria-label="Origem da alteracao"
          value={source}
          onChange={(event) => setSource(event.target.value as PriceHistorySource)}
        >
          {SOURCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </SearchBar>
      <DataTable<PriceChange>
        rows={list.rows}
        rowKey={(row) => row.id}
        empty={list.loading ? "Carregando..." : "Nenhuma alteracao de preco especial registrada."}
        pageSize={0}
        footer={
          <LoadMore
            shown={list.rows.length}
            total={list.total}
            loading={list.loading}
            onMore={() => void list.more()}
          />
        }
        columns={[
          {
            key: "when",
            header: "Quando",
            render: (row) => formatDateTime(row.changed_at)
          },
          {
            key: "action",
            header: "O que",
            render: (row) => (
              <Pill tone={priceChangeTone(row)}>{priceChangeActionLabel(row.action)}</Pill>
            )
          },
          {
            key: "customer",
            header: "Cliente / produto",
            render: (row) => (
              <>
                <strong>{row.customer_name ?? "Cliente nao identificado"}</strong>
                <span className="cell-sub">
                  {row.product_description ?? "Produto nao identificado"}
                </span>
              </>
            )
          },
          {
            key: "price",
            header: "Antes → depois (por ton)",
            numeric: true,
            render: (row) => {
              const percent = priceChangePercent(row);
              return (
                <>
                  {priceOrDash(row.old_price_cents)} →{" "}
                  <strong>{priceOrDash(row.new_price_cents)}</strong>
                  {percent && <span className="cell-sub">{percent}</span>}
                </>
              );
            }
          },
          {
            key: "who",
            header: "Quem",
            render: (row) => (
              <>
                <strong>{row.author_name ?? "—"}</strong>
                <span className="cell-sub">{priceChangeSourceLabel(row.source)}</span>
              </>
            )
          }
        ]}
      />
    </section>
  );
}
