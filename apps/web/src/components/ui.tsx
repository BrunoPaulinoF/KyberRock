import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { useAutoLoadMore } from "../lib/auto-load-more";
import { PHONE_QUERY, useMediaQuery } from "../lib/use-media-query";

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  text: string;
  kind: "ok" | "error";
}

const ToastContext = createContext<{ push: (text: string, kind?: "ok" | "error") => void }>({
  push: () => undefined
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, text, kind }]);
    window.setTimeout(() => setItems((current) => current.filter((t) => t.id !== id)), 6000);
  }, []);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast ${item.kind === "error" ? "error" : ""}`}>
            {item.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------------------
// Page head, panel, table
// ---------------------------------------------------------------------------

export function PageHead({
  kicker,
  title,
  description,
  actions
}: {
  /** A secao da tela, em caixa alta acima do titulo — o "kicker" do hero do desktop. */
  kicker?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {kicker && <p className="kicker">{kicker}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
}

/** Quantas linhas as listas mostram de cada vez; "Ver mais" traz outras tantas. */
export const PAGE_SIZE = 50;

/**
 * "Mostrando 50 de 2.301" + "Ver mais". Serve a lista paginada na tela (`DataTable`) e a
 * paginada no banco (clientes). No computador a proxima pagina vem no clique; no celular ela
 * vem sozinha quando o rodape chega perto da tela (`useAutoLoadMore`) — o botao fica como
 * reserva, para quando a pagina falhou.
 */
export function LoadMore({
  shown,
  total,
  loading,
  onMore,
  step = PAGE_SIZE
}: {
  shown: number;
  total: number;
  loading?: boolean;
  onMore: () => void;
  step?: number;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const footerRef = useAutoLoadMore({
    enabled: phone,
    shown,
    total,
    loading: loading === true,
    onMore
  });
  // Lista que cabe numa pagina so nao precisa de rodape.
  if (total <= 0 || (shown >= total && total <= step)) return null;
  const left = Math.max(0, total - shown);
  return (
    <div className="load-more" ref={footerRef}>
      <span>
        Mostrando {Math.min(shown, total).toLocaleString("pt-BR")} de{" "}
        {total.toLocaleString("pt-BR")}
      </span>
      {left > 0 && (
        <button type="button" className="btn" disabled={loading} onClick={onMore}>
          {loading ? "Carregando..." : `Ver mais ${Math.min(step, left).toLocaleString("pt-BR")}`}
        </button>
      )}
    </div>
  );
}

/**
 * Quantas linhas uma lista mostra agora: comeca em `pageSize` e cresce de `pageSize` a cada
 * "Ver mais"; volta ao comeco quando `resetKey` muda (a busca, o filtro, a aba).
 */
export function useShowMore(resetKey: string, pageSize = PAGE_SIZE) {
  const [limit, setLimit] = useState(pageSize);
  useEffect(() => setLimit(pageSize), [resetKey, pageSize]);
  return { limit, more: () => setLimit((current) => current + pageSize) };
}

/**
 * Tabela das listas. Mostra `pageSize` linhas (50) e o "Ver mais" embaixo: desenhar as 2 mil
 * linhas de uma vez era o que deixava as telas pesadas. `pageKey` volta para a primeira pagina
 * quando muda (a busca, o filtro); `pageSize={0}` desliga (lista que ja vem paginada do banco).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  empty = "Nada por aqui.",
  pageSize = PAGE_SIZE,
  pageKey,
  footer
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  empty?: string;
  pageSize?: number;
  pageKey?: string;
  /** Rodape dentro da moldura da tabela (o "Ver mais" da lista paginada no banco). */
  footer?: ReactNode;
}) {
  const page = useShowMore(pageKey ?? "", pageSize);
  if (rows.length === 0) return <div className="empty">{empty}</div>;
  const visible = pageSize > 0 ? rows.slice(0, page.limit) : rows;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.numeric ? "num" : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={rowKey(row)} className={rowClassName?.(row)}>
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? "num" : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pageSize > 0 && rows.length > pageSize && (
        <LoadMore shown={visible.length} total={rows.length} step={pageSize} onMore={page.more} />
      )}
      {footer}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal, field
// ---------------------------------------------------------------------------

export function Modal({
  title,
  description,
  onClose,
  footer,
  wide,
  children
}: {
  title: string;
  description?: string;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Badge({
  kind,
  children
}: {
  kind?: "ok" | "warn" | "err" | "accent";
  children: ReactNode;
}) {
  return <span className={`badge ${kind ?? ""}`}>{children}</span>;
}

export function Alert({
  kind,
  children
}: {
  kind: "error" | "warn" | "info";
  children: ReactNode;
}) {
  return <div className={`alert ${kind}`}>{children}</div>;
}

/** Aviso da `web-api` (`warnings[]`): o cadastro foi gravado, mas algo merece atencao. */
export function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Alert kind="warn">
      {items.map((item) => (
        <div key={item}>{item}</div>
      ))}
    </Alert>
  );
}
