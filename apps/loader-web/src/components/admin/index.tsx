/**
 * Primitivos do painel administrativo.
 *
 * Contrato: componente aqui NAO sabe nada de negocio. Ele recebe dados prontos e
 * desenha; toda regra continua na tela ou na Edge Function. O objetivo e que uma
 * mudanca de espacamento, de cor de estado ou de comportamento de tabela aconteca
 * em um arquivo, e nao espalhada em milhares de linhas de estilo inline.
 *
 * As classes vivem em `admin-ui.css` (prefixo `adm-`).
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info";

const BADGE_CLASS: Record<Tone, string> = {
  neutral: "adm-badge",
  ok: "adm-badge adm-badge-ok",
  warn: "adm-badge adm-badge-warn",
  danger: "adm-badge adm-badge-danger",
  info: "adm-badge adm-badge-info"
};

export function Badge({
  children,
  tone = "neutral",
  dot = false
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return <span className={`${BADGE_CLASS[tone]}${dot ? " adm-badge-dot" : ""}`}>{children}</span>;
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "default",
  size = "md",
  disabled = false,
  title,
  form
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "default" | "primary" | "warn" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
  form?: string;
}) {
  const classes = [
    "adm-btn",
    variant === "primary" ? "adm-btn-primary" : "",
    // Laranja: gesto que anda para tras (voltar a frota para uma versao
    // anterior). Nao e destrutivo como o vermelho, mas tambem nao pode sair
    // por engano no meio dos botoes de sempre.
    variant === "warn" ? "adm-btn-warn" : "",
    variant === "danger" ? "adm-btn-danger" : "",
    size === "sm" ? "adm-btn-sm" : ""
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled}
      title={title}
      form={form}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  size = "md"
}: {
  href: string;
  children: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <a
      className={`adm-btn${size === "sm" ? " adm-btn-sm" : ""}`}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}

/**
 * Olho: acao de "ver credenciais" de um cadastro. Icone em vez de texto porque
 * ele repete em toda linha da tabela — quatro colunas de acao com rotulo escrito
 * empurrariam a informacao para fora da tela.
 */
export function EyeIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Botao de olho com rotulo acessivel — o icone sozinho nao diz nada a um leitor de tela. */
export function EyeButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      className="adm-btn adm-btn-sm adm-btn-icon"
      onClick={onClick}
      title={title}
    >
      <EyeIcon />
      <span className="adm-sr-only">{title}</span>
    </button>
  );
}

export function ButtonGroup({ children }: { children: ReactNode }) {
  return <div className="adm-btn-group">{children}</div>;
}

export function Panel({
  title,
  description,
  actions,
  toolbar,
  footer,
  flush = false,
  children
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  /** `true` quando o conteudo e uma tabela, que ja tem o proprio respiro. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="adm-panel">
      {(title || actions) && (
        <header className="adm-panel-head">
          <div>
            {title && <h2 className="adm-panel-title">{title}</h2>}
            {description && <p className="adm-panel-desc">{description}</p>}
          </div>
          {actions && <div className="adm-panel-actions">{actions}</div>}
        </header>
      )}
      {toolbar && <div className="adm-toolbar">{toolbar}</div>}
      <div className={flush ? "adm-panel-body-flush" : "adm-panel-body"}>{children}</div>
      {footer && <footer className="adm-panel-foot">{footer}</footer>}
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  children
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="adm-field">
      <span className="adm-field-label">{label}</span>
      {children}
      {error ? (
        <span className="adm-field-error">{error}</span>
      ) : hint ? (
        <span className="adm-field-hint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Checkbox({
  name,
  label,
  defaultChecked
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="adm-check">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}

export function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="adm-fieldset">
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}

export function Note({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const toneClass =
    tone === "ok"
      ? " adm-note-ok"
      : tone === "warn"
        ? " adm-note-warn"
        : tone === "danger"
          ? " adm-note-danger"
          : "";
  return (
    <div className={`adm-note${toneClass}`} role={tone === "neutral" ? undefined : "status"}>
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral"
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "ok" | "warn" | "danger" | "accent";
}) {
  const toneClass = tone === "neutral" ? "" : ` adm-stat-${tone}`;
  return (
    <div className={`adm-stat${toneClass}`}>
      <p className="adm-stat-label">{label}</p>
      <p className="adm-stat-value">{value}</p>
      {hint && <p className="adm-stat-hint">{hint}</p>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="adm-stats">{children}</div>;
}

export interface Column<T> {
  key: string;
  header: string;
  /** Numero/valor: alinhado a direita e em monoespacada tabular. */
  numeric?: boolean;
  /** Coluna de acoes: alinhada a direita, sem quebra. */
  actions?: boolean;
  width?: string;
  render: (row: T) => ReactNode;
}

/**
 * Tabela densa. Existe porque a listagem em cartao gastava quatro vezes mais
 * altura por registro — com trinta pedreiras, achar uma exigia rolar a pagina
 * inteira.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  empty
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="adm-empty">{empty}</p>;
  }
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={column.numeric ? "adm-num" : undefined}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={rowClassName?.(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={
                    column.numeric ? "adm-num" : column.actions ? "adm-actions-cell" : undefined
                  }
                >
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

export function Modal({
  title,
  description,
  onClose,
  footer,
  size = "md",
  children
}: {
  title: string;
  description?: string;
  onClose: () => void;
  footer?: ReactNode;
  size?: "sm" | "md";
  children: ReactNode;
}) {
  // Esc fecha. Numa tela usada o dia inteiro, alcancar o mouse para sair de um
  // modal aberto por engano custa mais do que parece.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="adm-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`adm-modal-card${size === "sm" ? " adm-modal-card-sm" : ""}`}>
        <header className="adm-modal-head">
          <div>
            <h3 className="adm-modal-title">{title}</h3>
            {description && <p className="adm-modal-desc">{description}</p>}
          </div>
          <Button size="sm" onClick={onClose}>
            Fechar
          </Button>
        </header>
        <div className="adm-modal-body">{children}</div>
        {footer && <footer className="adm-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/**
 * Confirmacao de acao destrutiva. Substitui o `confirm()` do navegador, que nao
 * deixa explicar a consequencia nem destacar o que sera perdido.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  busy = false,
  onConfirm,
  onCancel
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Processando..." : confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: "13px", color: "#334155" }}>{message}</p>
      <p style={{ margin: "10px 0 0", fontSize: "12px", color: "#b91c1c" }}>
        Esta acao nao pode ser desfeita.
      </p>
    </Modal>
  );
}

export interface NavSection {
  id: string;
  label: string;
  group: string;
  count?: number;
}

/**
 * Shell do console: barra fixa + trilha lateral de secoes. A trilha vira uma
 * faixa de abas rolavel abaixo de 960px (ver `admin-ui.css`).
 */
export function AdminShell({
  sections,
  activeSection,
  onSelectSection,
  environmentLabel,
  headerActions,
  children
}: {
  sections: NavSection[];
  activeSection: string;
  onSelectSection: (id: string) => void;
  environmentLabel?: string;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  const groups = useMemo(() => {
    const byGroup = new Map<string, NavSection[]>();
    for (const section of sections) {
      const list = byGroup.get(section.group) ?? [];
      list.push(section);
      byGroup.set(section.group, list);
    }
    return [...byGroup.entries()];
  }, [sections]);

  return (
    <div className="adm adm-shell">
      <header className="adm-topbar">
        <div className="adm-brand">
          <img src="/kyberrocklogo.png" alt="" />
          <div>
            <p className="adm-brand-name">KyberRock Console</p>
            <p className="adm-brand-sub">Administracao da plataforma</p>
          </div>
        </div>
        <div className="adm-topbar-actions">
          {environmentLabel && <span className="adm-env">{environmentLabel}</span>}
          {headerActions}
        </div>
      </header>

      <div className="adm-body">
        <nav className="adm-nav" aria-label="Secoes administrativas">
          {groups.map(([group, items]) => (
            <div key={group}>
              <p className="adm-nav-group">{group}</p>
              {items.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className="adm-nav-item"
                  aria-current={activeSection === section.id ? "page" : undefined}
                  onClick={() => onSelectSection(section.id)}
                >
                  <span>{section.label}</span>
                  {section.count !== undefined && (
                    <span className="adm-nav-count">{section.count}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="adm-main">{children}</main>
      </div>
    </div>
  );
}

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
    <div className="adm-page-head">
      <div>
        <h1 className="adm-page-title">{title}</h1>
        {description && <p className="adm-page-desc">{description}</p>}
      </div>
      {actions && <div className="adm-panel-actions">{actions}</div>}
    </div>
  );
}

/**
 * Copia com feedback fiel. `navigator.clipboard` e undefined em contexto nao
 * seguro (HTTP puro atras de proxy interno) e a escrita e assincrona, entao o
 * "copiado!" otimista mentia justamente quando a copia falhava.
 */
export async function copyText(value: string, label = "Copiado!"): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      alert(label);
      return;
    }
  } catch {
    // cai para a copia manual abaixo
  }
  window.prompt("Copie o valor:", value);
}

/** Botao de copiar com estado momentaneo, para acoes repetidas em tabela. */
export function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      size="sm"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => window.prompt("Copie o valor:", value));
      }}
    >
      {copied ? "Copiado" : label}
    </Button>
  );
}
