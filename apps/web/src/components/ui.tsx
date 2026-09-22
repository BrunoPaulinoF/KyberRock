import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

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
  title,
  description,
  actions
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
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

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  empty = "Nada por aqui."
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  empty?: string;
}) {
  if (rows.length === 0) return <div className="empty">{empty}</div>;
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
          {rows.map((row) => (
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
