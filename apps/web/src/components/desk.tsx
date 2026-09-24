import {
  Ban,
  Check,
  Clock,
  FileText,
  Pencil,
  Plus,
  Power,
  Printer,
  RefreshCw,
  Repeat2,
  Search,
  Trash2,
  Truck,
  Wallet,
  X,
  type LucideIcon
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * As pecas de tela do KyberRock Desktop, em React para a web: o mesmo cartao unico por tela,
 * as mesmas abas so com icone, o mesmo cabecalho de secao com contador, a mesma barra de busca
 * e os mesmos botoes de acao quadrados. O objetivo e o operador nao perceber que trocou de
 * programa (`apps/desktop/src/renderer/App.tsx`, `crud-ui.tsx`, `IconActionButton.tsx`).
 */

/** O cartao que ocupa a coluna de conteudo inteira (o `styles.panel` do desktop). */
export function DeskPanel({ children, fill }: { children: ReactNode; fill?: boolean }) {
  return <section className={`desk-panel${fill ? " fill" : ""}`}>{children}</section>;
}

/** Abas so com icone, sublinhadas em ambar (Cadastros, Transporte). */
export function IconTabs<T extends string>({
  tabs,
  active,
  onChange,
  label
}: {
  tabs: Array<{ id: T; label: string; icon: LucideIcon }>;
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <nav className="icon-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`icon-tab${tab.id === active ? " active" : ""}`}
          aria-label={tab.label}
          aria-pressed={tab.id === active}
          title={tab.label}
          onClick={() => onChange(tab.id)}
        >
          <tab.icon size={16} />
        </button>
      ))}
    </nav>
  );
}

/** Abas redondas da tela Operacoes (abertas, canceladas, concluidas). */
export function PillTabs<T extends string>({
  tabs,
  active,
  onChange
}: {
  tabs: Array<{ id: T; label: string; icon: LucideIcon }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="pill-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`pill-tab${tab.id === active ? " active" : ""}`}
          aria-label={tab.label}
          aria-pressed={tab.id === active}
          title={tab.label}
          onClick={() => onChange(tab.id)}
        >
          <tab.icon size={16} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}

/** "Clientes [4]" + descricao + botao "Novo ..." (o cabecalho das listas do desktop). */
export function SectionHead({
  title,
  count,
  description,
  action
}: {
  title: string;
  count?: number;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        <h2>
          {title}
          {count !== undefined && <span className="section-count">{count}</span>}
        </h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Botao preto com "+" (Novo cliente, Nova condicao, Novo motorista). */
export function NewButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="btn primary new-btn" onClick={onClick}>
      <Plus size={16} strokeWidth={2.4} />
      {children}
    </button>
  );
}

/** Busca com lupa e o botao de recarregar ao lado. */
export function SearchBar({
  value,
  onChange,
  placeholder,
  onRefresh,
  children
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onRefresh?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="search-bar">
      <label className="search-box">
        <Search size={15} />
        <input
          type="search"
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {children}
      {onRefresh && (
        <button
          type="button"
          className="icon-action"
          aria-label="Atualizar"
          title="Atualizar"
          onClick={onRefresh}
        >
          <RefreshCw size={15} />
        </button>
      )}
    </div>
  );
}

const ACTION_ICONS = {
  "file-text": FileText,
  swap: Repeat2,
  edit: Pencil,
  truck: Truck,
  check: Check,
  ban: Ban,
  printer: Printer,
  trash: Trash2,
  power: Power,
  close: X,
  clock: Clock,
  wallet: Wallet
} satisfies Record<string, LucideIcon>;

export type ActionIcon = keyof typeof ACTION_ICONS;

/** Botao de acao quadrado de 30 px, so com icone (o `IconActionButton` do desktop). */
export function IconAction({
  icon,
  label,
  tone = "neutral",
  disabled,
  onClick
}: {
  icon: ActionIcon;
  label: string;
  tone?: "neutral" | "primary" | "danger";
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = ACTION_ICONS[icon];
  return (
    <button
      type="button"
      className={`icon-action ${tone}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}

/** Placa em fundo escuro e letra de monoespaco. */
export function PlateBadge({ plate }: { plate: string }) {
  return <strong className="plate-badge">{plate || "--"}</strong>;
}

/** Contador ambar redondo ("4 abertas"). */
export function CountBadge({ children }: { children: ReactNode }) {
  return <span className="count-badge">{children}</span>;
}

/** Luz do carregador embaixo da placa: aguardando (vermelha, pulsando) ou concluida. */
export function LoaderLight({ completedAt }: { completedAt: string | null | undefined }) {
  const done = Boolean(completedAt);
  return (
    <span
      className={`loader-light${done ? " done" : ""}`}
      title={
        done ? "Carga concluida pelo carregador." : "Aguardando o carregador concluir a carga."
      }
    >
      <span aria-hidden="true" />
      {done ? "Concluida" : "Aguardando"}
    </span>
  );
}

/** Estado vazio centralizado, com titulo e dica. */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}

/** Etiqueta de situacao (OMIE, LOCAL, Enviando ao OMIE...). */
export function Pill({
  tone = "neutral",
  children
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
}) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
