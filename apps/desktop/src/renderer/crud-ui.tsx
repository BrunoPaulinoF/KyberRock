import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import { CrudFormModal } from "./CrudFormModal";
import { Tooltip } from "./Tooltip";

// Primitivas compartilhadas das telas de cadastro. Todas as listas CRUD do
// KyberRock (clientes, produtos, veiculos, motoristas, transportadoras,
// condicoes) devem compor estas pecas para manter comportamento e visual
// identicos: busca que nao perde foco durante carregamento, feedback que
// expira sozinho, exclusao com confirmacao estilizada e formulario em modal
// com envio unico.

// ---------------------------------------------------------------------------
// Feedback ("flash") com expiracao automatica
// ---------------------------------------------------------------------------

export type FlashKind = "success" | "error" | "info";

export interface FlashState {
  kind: FlashKind;
  text: string;
}

export function useFlash(
  timeoutMs = 4000
): [FlashState | null, (kind: FlashKind, text: string) => void] {
  const [flash, setFlash] = useState<FlashState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const showFlash = useCallback(
    (kind: FlashKind, text: string) => {
      setFlash({ kind, text });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setFlash(null), timeoutMs);
    },
    [timeoutMs]
  );

  return [flash, showFlash];
}

const flashTones: Record<FlashKind, CSSProperties> = {
  success: {
    color: "var(--kr-success)",
    background: "var(--kr-success-soft)",
    borderColor: "var(--kr-success-border)"
  },
  error: {
    color: "var(--kr-danger)",
    background: "var(--kr-danger-soft)",
    borderColor: "var(--kr-danger-border)"
  },
  info: {
    color: "var(--kr-info-text)",
    background: "var(--kr-info-bg)",
    borderColor: "var(--kr-info-border)"
  }
};

export function FlashBanner({ flash }: { flash: FlashState | null }) {
  if (!flash) return null;
  return (
    <p
      role="status"
      style={{
        margin: "0 0 10px 0",
        padding: "8px 12px",
        borderRadius: "10px",
        border: "1px solid",
        fontSize: "13px",
        fontWeight: 600,
        ...flashTones[flash.kind]
      }}
    >
      {flash.text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Cabecalho e barra de busca
// ---------------------------------------------------------------------------

export function CrudSectionHeader({
  title,
  description,
  count,
  actionLabel,
  onAction
}: {
  title: string;
  description?: string;
  count?: number | null;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "12px",
        marginBottom: "12px",
        flexWrap: "wrap"
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <h3 style={{ margin: 0, fontSize: "16px", color: "var(--kr-text-strong)" }}>{title}</h3>
          {typeof count === "number" ? (
            <span
              style={{
                padding: "2px 9px",
                borderRadius: "999px",
                background: "var(--kr-surface-soft)",
                border: "1px solid var(--kr-border)",
                color: "var(--kr-muted)",
                fontSize: "11px",
                fontWeight: 800
              }}
            >
              {count}
            </span>
          ) : null}
        </div>
        {description ? (
          <p style={{ margin: "4px 0 0 0", color: "var(--kr-muted)", fontSize: "12px" }}>
            {description}
          </p>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            border: "none",
            borderRadius: "10px",
            padding: "9px 14px",
            background: "var(--kr-primary-strong)",
            color: "var(--kr-primary-text)",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: "13px",
            flexShrink: 0
          }}
        >
          <Plus size={15} strokeWidth={2.6} />
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function CrudSearchBar({
  value,
  onChange,
  placeholder,
  onRefresh,
  right
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onRefresh?: () => void;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        marginBottom: "10px",
        flexWrap: "wrap",
        alignItems: "center"
      }}
    >
      <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
        <Search
          size={15}
          style={{
            position: "absolute",
            left: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--kr-muted)",
            pointerEvents: "none"
          }}
        />
        <input
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%",
            border: "1px solid var(--kr-input-border)",
            borderRadius: "10px",
            padding: "9px 10px 9px 32px",
            font: "inherit",
            fontSize: "13px",
            background: "var(--kr-input-bg)",
            color: "var(--kr-text-strong)"
          }}
        />
      </div>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          title="Atualizar lista"
          aria-label="Atualizar lista"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "36px",
            height: "36px",
            border: "1px solid var(--kr-input-border)",
            borderRadius: "10px",
            background: "var(--kr-surface)",
            color: "var(--kr-muted)",
            cursor: "pointer"
          }}
        >
          <RefreshCw size={15} />
        </button>
      ) : null}
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabela de dados
// ---------------------------------------------------------------------------

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  width: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
}

// Cliques em botoes/inputs dentro da linha nao devem disparar a abertura do
// registro (duplo clique): o alvo interativo ja tem acao propria.
function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("button, a, input, select, textarea, label") !== null
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyTitle,
  emptyHint,
  minWidth = "680px",
  maxHeight,
  footer,
  expandedRow,
  onRowOpen
}: {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyTitle: string;
  emptyHint?: string;
  minWidth?: string;
  maxHeight?: string;
  footer?: ReactNode;
  expandedRow?: (row: T) => ReactNode;
  /**
   * Abre o registro da linha: duplo clique (fora de botoes/inputs) ou Enter com
   * a linha focada. Usado para abrir o modal de visualizacao dos cadastros.
   */
  onRowOpen?: (row: T) => void;
}) {
  const gridTemplateColumns = columns.map((column) => column.width).join(" ");

  if (!loading && rows.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          padding: "30px 26px",
          borderRadius: "14px",
          border: "1px dashed var(--kr-border)",
          background: "var(--kr-surface-soft)",
          color: "var(--kr-muted)",
          textAlign: "center"
        }}
      >
        <strong style={{ color: "var(--kr-text-strong)", fontSize: "14px" }}>{emptyTitle}</strong>
        {emptyHint ? <span style={{ fontSize: "12px" }}>{emptyHint}</span> : null}
      </div>
    );
  }

  return (
    <div
      style={{
        overflowX: "auto",
        overflowY: maxHeight ? "auto" : undefined,
        maxHeight,
        border: "1px solid var(--kr-border)",
        borderRadius: "14px",
        background: "var(--kr-surface)",
        boxShadow: "var(--kr-shadow)",
        minHeight: 0
      }}
    >
      <style>{`
        .kr-table-row { transition: background-color 100ms ease; }
        .kr-table-row:hover { background: var(--kr-card-hover); }
        .kr-table-row:focus-visible {
          outline: 2px solid var(--kr-accent);
          outline-offset: -2px;
          background: var(--kr-card-hover);
        }
        @keyframes krSkeleton {
          0% { opacity: 0.45; }
          50% { opacity: 1; }
          100% { opacity: 0.45; }
        }
      `}</style>
      <div
        role="row"
        style={{
          display: "grid",
          gridTemplateColumns,
          minWidth,
          background: "var(--kr-surface-soft)",
          color: "var(--kr-muted)",
          fontSize: "11px",
          fontWeight: 800,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          position: "sticky",
          top: 0,
          zIndex: 1,
          borderBottom: "1px solid var(--kr-border)"
        }}
      >
        {columns.map((column) => (
          <span
            key={column.key}
            style={{
              padding: "9px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: column.align === "right" ? "flex-end" : "flex-start",
              minWidth: 0
            }}
          >
            {column.header}
          </span>
        ))}
      </div>
      {loading
        ? [0, 1, 2].map((index) => (
            <div
              key={`skeleton-${index}`}
              style={{ display: "grid", gridTemplateColumns, minWidth }}
            >
              {columns.map((column) => (
                <span key={column.key} style={{ padding: "13px 12px" }}>
                  <span
                    style={{
                      display: "block",
                      height: "12px",
                      borderRadius: "6px",
                      background: "var(--kr-border)",
                      animation: "krSkeleton 1.1s ease-in-out infinite",
                      animationDelay: `${index * 120}ms`
                    }}
                  />
                </span>
              ))}
            </div>
          ))
        : rows.map((row, index) => {
            const expanded = expandedRow?.(row) ?? null;
            return (
              <div key={rowKey(row)}>
                <div
                  className="kr-table-row"
                  role="row"
                  tabIndex={onRowOpen ? 0 : undefined}
                  title={onRowOpen ? "Duplo clique para visualizar" : undefined}
                  onDoubleClick={
                    onRowOpen
                      ? (event) => {
                          if (isInteractiveTarget(event.target)) return;
                          // O duplo clique seleciona texto da celula; limpa a
                          // selecao antes de abrir a visualizacao.
                          window.getSelection()?.removeAllRanges();
                          onRowOpen(row);
                        }
                      : undefined
                  }
                  onKeyDown={
                    onRowOpen
                      ? (event) => {
                          if (event.key === "Enter" && event.target === event.currentTarget) {
                            event.preventDefault();
                            onRowOpen(row);
                          }
                        }
                      : undefined
                  }
                  style={{
                    display: "grid",
                    gridTemplateColumns,
                    minWidth,
                    alignItems: "center",
                    borderTop: index === 0 ? "none" : "1px solid var(--kr-border)",
                    fontSize: "13px",
                    color: "var(--kr-text)"
                  }}
                >
                  {columns.map((column) => (
                    <div
                      key={column.key}
                      style={{
                        padding: "10px 12px",
                        minHeight: "46px",
                        display: "flex",
                        flexDirection: column.align === "right" ? "row" : "column",
                        alignItems: column.align === "right" ? "center" : "stretch",
                        justifyContent: column.align === "right" ? "flex-end" : "center",
                        gap: column.align === "right" ? "6px" : "2px",
                        minWidth: 0
                      }}
                    >
                      {column.render(row)}
                    </div>
                  ))}
                </div>
                {expanded ? (
                  <div
                    style={{
                      minWidth,
                      borderTop: "1px solid var(--kr-border)",
                      background: "var(--kr-surface-soft)",
                      padding: "12px 14px"
                    }}
                  >
                    {expanded}
                  </div>
                ) : null}
              </div>
            );
          })}
      {footer ? (
        <div
          style={{
            minWidth,
            borderTop: "1px solid var(--kr-border)",
            padding: "8px 12px",
            background: "var(--kr-surface-soft)"
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

// Celulas auxiliares -------------------------------------------------------

export function CellPrimary({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontWeight: 700,
        color: "var(--kr-text-strong)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }}
    >
      {children}
    </span>
  );
}

export function CellMuted({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        color: "var(--kr-muted)",
        fontSize: "12px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }}
    >
      {children}
    </span>
  );
}

export function CellText({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        color: "var(--kr-text)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }}
    >
      {children}
    </span>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const isOmie = source === "omie";
  return (
    <span
      style={{
        justifySelf: "start",
        alignSelf: "start",
        display: "inline-flex",
        width: "fit-content",
        fontSize: "10px",
        padding: "2px 8px",
        borderRadius: "999px",
        border: "1px solid",
        background: isOmie ? "var(--kr-info-bg)" : "var(--kr-success-soft)",
        color: isOmie ? "var(--kr-info-text)" : "var(--kr-success)",
        borderColor: isOmie ? "var(--kr-info-border)" : "var(--kr-success-border)",
        fontWeight: 800,
        letterSpacing: "0.04em"
      }}
    >
      {isOmie ? "OMIE" : "LOCAL"}
    </span>
  );
}

// Acoes de linha -----------------------------------------------------------

// Botao de acao de linha compacto, so com icone: mostra a dica (o que faz) no
// hover/foco e usa o `label` como nome acessivel. Mesmo visual (30x30) dos
// botoes de acao da tela de operacoes.
const rowIconButtonBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "30px",
  height: "30px",
  padding: 0,
  border: "1px solid var(--kr-border)",
  borderRadius: "8px",
  background: "var(--kr-surface)",
  color: "var(--kr-text-strong)",
  cursor: "pointer",
  flexShrink: 0,
  lineHeight: 0
};

export function EditRowButton({ onClick, label = "Editar" }: { onClick: () => void; label?: string }) {
  return (
    <Tooltip content={label} placement="left">
      <button type="button" onClick={onClick} aria-label={label} style={rowIconButtonBase}>
        <Pencil size={15} />
      </button>
    </Tooltip>
  );
}

export function DeleteRowButton({
  onClick,
  disabled = false,
  label = "Excluir"
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Tooltip content={label} placement="left">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        style={{
          ...rowIconButtonBase,
          borderColor: "var(--kr-danger-border)",
          background: "var(--kr-danger-soft)",
          color: "var(--kr-danger)",
          opacity: disabled ? 0.55 : 1,
          cursor: disabled ? "not-allowed" : "pointer"
        }}
      >
        <Trash2 size={15} />
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Dialogo de confirmacao (substitui window.confirm)
// ---------------------------------------------------------------------------

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Excluir",
  cancelLabel = "Cancelar",
  busyLabel = "Excluindo...",
  tone = "danger",
  busy = false,
  onCancel,
  onConfirm
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busyLabel?: string;
  /** "danger" (padrao) para acoes destrutivas; "primary" para confirmacoes neutras. */
  tone?: "danger" | "primary";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(12, 10, 9, 0.6)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        zIndex: 1200
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--kr-surface)",
          border: "1px solid var(--kr-border)",
          borderRadius: "16px",
          boxShadow: "0 25px 60px rgba(0,0,0,0.45)",
          width: "100%",
          maxWidth: "420px",
          padding: "18px"
        }}
      >
        <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", color: "var(--kr-text-strong)" }}>
          {title}
        </h3>
        <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "var(--kr-muted)" }}>
          {description}
        </p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              border: "1px solid var(--kr-input-border)",
              borderRadius: "10px",
              padding: "8px 14px",
              background: "var(--kr-surface)",
              color: "var(--kr-text-strong)",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "13px"
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            style={{
              border: "none",
              borderRadius: "10px",
              padding: "8px 14px",
              background: tone === "danger" ? "var(--kr-danger-strong)" : "var(--kr-primary-strong)",
              color: tone === "danger" ? "#ffffff" : "var(--kr-primary-text)",
              cursor: busy ? "wait" : "pointer",
              fontWeight: 700,
              fontSize: "13px",
              opacity: busy ? 0.7 : 1
            }}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// useConfirm: confirmacao imperativa (substitui window.confirm)
// ---------------------------------------------------------------------------

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
}

/**
 * Confirmacao com a mesma ergonomia do window.confirm, mas usando o
 * ConfirmDialog estilizado: `const ok = await requestConfirm({...})`.
 * Renderize `confirmElement` no JSX do componente que usa o hook.
 */
export function useConfirm(): {
  confirmElement: ReactNode;
  requestConfirm: (request: ConfirmRequest) => Promise<boolean>;
} {
  const [pending, setPending] = useState<{
    request: ConfirmRequest;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const requestConfirm = useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setPending({ request, resolve });
      }),
    []
  );

  function settle(confirmed: boolean): void {
    pending?.resolve(confirmed);
    setPending(null);
  }

  const confirmElement = pending ? (
    <ConfirmDialog
      title={pending.request.title}
      description={pending.request.description}
      confirmLabel={pending.request.confirmLabel ?? "Confirmar"}
      cancelLabel={pending.request.cancelLabel ?? "Cancelar"}
      tone={pending.request.tone ?? "primary"}
      onCancel={() => settle(false)}
      onConfirm={() => settle(true)}
    />
  ) : null;

  return { confirmElement, requestConfirm };
}

// ---------------------------------------------------------------------------
// Modal de visualizacao de cadastro (abre com duplo clique na linha)
// ---------------------------------------------------------------------------

export interface DetailItem {
  label: string;
  /** Valor vazio ("", null, undefined) e exibido como "—". */
  value: ReactNode;
}

export interface DetailSectionData {
  title: string;
  items: DetailItem[];
}

function detailDisplayValue(value: ReactNode): ReactNode {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && value.trim() === "") return "—";
  return value;
}

/**
 * Modal grande, somente leitura, com todas as informacoes de um cadastro
 * agrupadas por secao. O botao "Editar" transiciona para o modal de edicao
 * ja existente da tela (via `onEdit`).
 */
export function RecordDetailModal({
  title,
  subtitle,
  badge,
  sections,
  onClose,
  onEdit,
  editLabel = "Editar",
  maxWidth = 860
}: {
  title: string;
  subtitle?: string;
  /** Selos exibidos ao lado do titulo (ex.: origem OMIE/LOCAL, bloqueado). */
  badge?: ReactNode;
  sections: DetailSectionData[];
  onClose: () => void;
  onEdit?: () => void;
  editLabel?: string;
  maxWidth?: number;
}) {
  return (
    <CrudFormModal onClose={onClose} maxWidth={maxWidth}>
      <div
        style={{
          padding: "16px 56px 12px 18px",
          borderBottom: "1px solid var(--kr-border)",
          background: "var(--kr-surface-soft)",
          borderTopLeftRadius: "16px",
          borderTopRightRadius: "16px"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, color: "var(--kr-text-strong)", fontSize: "16px", fontWeight: 700 }}>
            {title}
          </h3>
          {badge}
        </div>
        {subtitle ? (
          <p style={{ margin: "4px 0 0 0", color: "var(--kr-muted)", fontSize: "12px" }}>
            {subtitle}
          </p>
        ) : null}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "14px",
          padding: "18px"
        }}
      >
        {sections.map((section) => (
          <section
            key={section.title}
            style={{
              display: "grid",
              alignContent: "start",
              gap: "10px",
              padding: "14px",
              border: "1px solid var(--kr-border)",
              borderRadius: "12px",
              background: "var(--kr-surface-soft)",
              minWidth: 0
            }}
          >
            <h4
              style={{
                margin: "0 0 4px 0",
                fontSize: "11px",
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--kr-muted)"
              }}
            >
              {section.title}
            </h4>
            <dl style={{ margin: 0, display: "grid", gap: "10px" }}>
              {section.items.map((item) => (
                <div key={item.label} style={{ minWidth: 0 }}>
                  <dt
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--kr-muted)",
                      marginBottom: "2px"
                    }}
                  >
                    {item.label}
                  </dt>
                  <dd
                    style={{
                      margin: 0,
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "var(--kr-text-strong)",
                      overflowWrap: "anywhere"
                    }}
                  >
                    {detailDisplayValue(item.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "8px",
          padding: "14px 18px",
          borderTop: "1px solid var(--kr-border)",
          background: "var(--kr-surface-soft)",
          borderBottomLeftRadius: "16px",
          borderBottomRightRadius: "16px"
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            border: "1px solid var(--kr-input-border)",
            borderRadius: "10px",
            padding: "9px 14px",
            background: "var(--kr-surface)",
            color: "var(--kr-text-strong)",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: "13px"
          }}
        >
          Fechar
        </button>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            autoFocus
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              border: "none",
              borderRadius: "10px",
              padding: "9px 16px",
              background: "var(--kr-primary-strong)",
              color: "var(--kr-primary-text)",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "13px"
            }}
          >
            <Pencil size={15} />
            {editLabel}
          </button>
        ) : null}
      </div>
    </CrudFormModal>
  );
}

// ---------------------------------------------------------------------------
// Modal de formulario padronizado
// ---------------------------------------------------------------------------

export function CrudFormShell({
  title,
  subtitle,
  error,
  saving = false,
  submitLabel = "Salvar",
  onClose,
  onSubmit,
  maxWidth = 920,
  children,
  footerLeft
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  saving?: boolean;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: () => void;
  maxWidth?: number;
  children: ReactNode;
  footerLeft?: ReactNode;
}) {
  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!saving) onSubmit();
  }

  return (
    <CrudFormModal onClose={onClose} maxWidth={maxWidth}>
      <form onSubmit={handleSubmit}>
        <div
          style={{
            padding: "16px 56px 12px 18px",
            borderBottom: "1px solid var(--kr-border)",
            background: "var(--kr-surface-soft)",
            borderTopLeftRadius: "16px",
            borderTopRightRadius: "16px"
          }}
        >
          <h3 style={{ margin: 0, color: "var(--kr-text-strong)", fontSize: "16px", fontWeight: 700 }}>
            {title}
          </h3>
          {subtitle ? (
            <p style={{ margin: "4px 0 0 0", color: "var(--kr-muted)", fontSize: "12px" }}>
              {subtitle}
            </p>
          ) : null}
        </div>
        {error ? (
          <p
            role="alert"
            style={{
              margin: "12px 18px 0 18px",
              padding: "8px 12px",
              borderRadius: "10px",
              border: "1px solid var(--kr-danger-border)",
              background: "var(--kr-danger-soft)",
              color: "var(--kr-danger)",
              fontSize: "13px",
              fontWeight: 600
            }}
          >
            {error}
          </p>
        ) : null}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "14px",
            padding: "18px"
          }}
        >
          {children}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "8px",
            padding: "14px 18px",
            borderTop: "1px solid var(--kr-border)",
            flexWrap: "wrap",
            background: "var(--kr-surface-soft)",
            borderBottomLeftRadius: "16px",
            borderBottomRightRadius: "16px"
          }}
        >
          <span style={{ color: "var(--kr-muted)", fontSize: "12px" }}>{footerLeft}</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                border: "1px solid var(--kr-input-border)",
                borderRadius: "10px",
                padding: "9px 14px",
                background: "var(--kr-surface)",
                color: "var(--kr-text-strong)",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: "13px"
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                border: "none",
                borderRadius: "10px",
                padding: "9px 16px",
                background: "var(--kr-primary-strong)",
                color: "var(--kr-primary-text)",
                cursor: saving ? "wait" : "pointer",
                fontWeight: 700,
                fontSize: "13px",
                opacity: saving ? 0.7 : 1
              }}
            >
              {saving ? "Salvando..." : submitLabel}
            </button>
          </div>
        </div>
      </form>
    </CrudFormModal>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        display: "grid",
        alignContent: "start",
        gap: "10px",
        padding: "14px",
        border: "1px solid var(--kr-border)",
        borderRadius: "12px",
        background: "var(--kr-surface-soft)",
        minWidth: 0
      }}
    >
      <h4
        style={{
          margin: "0 0 4px 0",
          fontSize: "11px",
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--kr-muted)"
        }}
      >
        {title}
      </h4>
      {children}
    </section>
  );
}
