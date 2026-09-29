import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Inbox,
  Info,
  RefreshCw,
  X,
  XCircle,
  type LucideIcon
} from "lucide-react";
import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode
} from "react";

import { useAutoLoadMore } from "../lib/auto-load-more";
import { PHONE_QUERY, useMediaQuery } from "../lib/use-media-query";

/*
 * O kit de pecas do site: um jeito so de fazer cada coisa em todas as telas (etapa 2 do plano
 * de UI). Topo de tela (`PageHeader`), abas (`Tabs`), etiqueta (`Pill`), lista vazia
 * (`EmptyState`), carregando (`Skeleton*`), erro com "Tentar de novo" (`ErrorState`), janela
 * (`Modal`), confirmacao (`useConfirm`), mensagem (`useToast`), campo (`Field`) e ajuda que
 * funciona no toque (`HelpTip`). Tela nova usa estas pecas; a vitrine `/kit` (so em
 * desenvolvimento) mostra todas nos dois temas.
 */

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export type ToastKind = "ok" | "error" | "warn" | "info";

export interface ToastOptions {
  /** Botao dentro da mensagem ("Desfazer"). Clicar executa e fecha. */
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
  text: string;
  kind: ToastKind;
}

/**
 * Quanto cada mensagem fica na tela. Erro NAO some sozinho: sumir em 6 s fazia a pessoa perder o
 * motivo da recusa antes de ler. Aviso fica mais que sucesso porque pede leitura.
 */
const TOAST_MS: Record<ToastKind, number | null> = {
  ok: 5000,
  info: 6000,
  warn: 9000,
  error: null
};
/** Mensagens na tela ao mesmo tempo: a mais velha sai quando chega outra. */
const TOAST_LIMIT = 4;

const TOAST_ICONS: Record<ToastKind, LucideIcon> = {
  ok: CheckCircle2,
  info: Info,
  warn: AlertTriangle,
  error: XCircle
};

type PushToast = (text: string, kind?: ToastKind, options?: ToastOptions) => void;

const ToastContext = createContext<{ push: PushToast }>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const push = useCallback<PushToast>(
    (text, kind = "ok", options) => {
      const id = Date.now() + Math.random();
      setItems((current) => [...current, { id, text, kind, ...options }].slice(-TOAST_LIMIT));
      const ms = options?.action ? Math.max(TOAST_MS[kind] ?? 0, 8000) : TOAST_MS[kind];
      if (ms !== null) window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss]
  );
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => {
          const Icon = TOAST_ICONS[item.kind];
          return (
            <div
              key={item.id}
              className={`toast ${item.kind}`}
              role={item.kind === "error" ? "alert" : "status"}
            >
              <Icon size={18} className="toast-icon" aria-hidden="true" />
              <span className="toast-text">{item.text}</span>
              {item.action && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    item.action?.onClick();
                    dismiss(item.id);
                  }}
                >
                  {item.action.label}
                </button>
              )}
              <button
                type="button"
                className="toast-close"
                aria-label="Fechar mensagem"
                onClick={() => dismiss(item.id)}
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------------------
// Topo de tela e ajuda
// ---------------------------------------------------------------------------

/**
 * O topo de toda tela: secao em caixa alta, titulo, ajuda, etiquetas ao lado do titulo, uma
 * frase de descricao e os botoes da tela a direita (embaixo, no celular).
 */
export function PageHeader({
  kicker,
  title,
  description,
  help,
  meta,
  actions,
  level = 1
}: {
  /** A secao da tela, em caixa alta acima do titulo ("Análise", "Fila operacional"). */
  kicker?: string;
  title: string;
  description?: ReactNode;
  /** Explicacao mais longa, atras do "?" ao lado do titulo. */
  help?: string;
  /** Etiquetas ao lado do titulo ("3 abertas", "Ao vivo"). */
  meta?: ReactNode;
  actions?: ReactNode;
  /** `2` quando a tela ja tem um h1 (uma secao dentro de outra tela). */
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header className="page-header">
      <div className="page-header-text">
        {kicker && <p className="page-header-kicker">{kicker}</p>}
        <div className="page-header-title">
          <Heading>{title}</Heading>
          {help && <HelpTip text={help} label={`Sobre: ${title}`} />}
          {meta && <div className="page-header-meta">{meta}</div>}
        </div>
        {description && <p className="page-header-description">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

/**
 * O "?" de ajuda. O `title` do navegador nao aparece no toque do celular, entao a explicacao
 * abre ao passar o mouse, no foco do teclado e no toque (que a deixa aberta ate tocar fora).
 */
export function HelpTip({ text, label = "Ajuda" }: { text: string; label?: string }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = hovered || pinned;

  useEffect(() => {
    if (!pinned) return undefined;
    function onPointer(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setPinned(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPinned(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <span
      className="help-tip"
      ref={ref}
      onPointerEnter={(event) => event.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setHovered(false)}
    >
      <button
        type="button"
        className="help-tip-btn"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((current) => !current)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        <CircleHelp size={16} />
      </button>
      {open && (
        <span role="tooltip" id={id} className="help-tip-bubble">
          {text}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** Numero ao lado do nome ("Abertas 3"). `null`/ausente = sem contador. */
  count?: number | null;
  disabled?: boolean;
}

/**
 * As abas do site, de um jeito so: `underline` (sublinhada em ambar, as secoes de uma tela) ou
 * `pill` (redonda, os filtros de uma lista). Nome sempre escrito ao lado do icone. No teclado,
 * as setas trocam de aba; no celular a fileira sublinhada rola de lado.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
  variant = "underline"
}: {
  tabs: Array<TabItem<T>>;
  active: T;
  onChange: (id: T) => void;
  /** Nome da fileira para leitor de tela ("Seções de Cadastros"). */
  label: string;
  variant?: "underline" | "pill";
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const enabled = tabs.filter((tab) => !tab.disabled);
    const index = enabled.findIndex((tab) => tab.id === active);
    let next: TabItem<T> | undefined;
    if (event.key === "ArrowRight") next = enabled[(index + 1) % enabled.length];
    else if (event.key === "ArrowLeft")
      next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  }

  const pill = variant === "pill";
  return (
    <div
      role="tablist"
      aria-label={label}
      className={pill ? "pill-tabs" : "icon-tabs"}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) refs.current.set(tab.id, node);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            className={`${pill ? "pill-tab" : "icon-tab"}${selected ? " active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {Icon && <Icon size={16} strokeWidth={2} aria-hidden="true" />}
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count !== null && (
              <span className="tab-count">{tab.count.toLocaleString("pt-BR")}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etiqueta, lista vazia, erro, carregando
// ---------------------------------------------------------------------------

export type PillTone = "neutral" | "success" | "warning" | "danger" | "info";

/** A etiqueta de situacao do site (OMIE, LOCAL, Enviando ao OMIE...). */
export function Pill({
  tone = "neutral",
  title,
  children
}: {
  tone?: PillTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={`pill ${tone}`} title={title}>
      {children}
    </span>
  );
}

const BADGE_TONES: Record<"ok" | "warn" | "err" | "accent", PillTone> = {
  ok: "success",
  warn: "warning",
  err: "danger",
  accent: "info"
};

/** Nome antigo da etiqueta; desenha a mesma `Pill` para as duas nao ficarem diferentes. */
export function Badge({
  kind,
  children
}: {
  kind?: "ok" | "warn" | "err" | "accent";
  children: ReactNode;
}) {
  return <Pill tone={kind ? BADGE_TONES[kind] : "neutral"}>{children}</Pill>;
}

/** Lista vazia: o que nao ha e, quando ajuda, o que fazer (a acao). */
export function EmptyState({
  title,
  hint,
  icon: Icon = Inbox,
  action
}: {
  title: string;
  hint?: ReactNode;
  icon?: LucideIcon | null;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={22} className="empty-state-icon" aria-hidden="true" />}
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

/** Falha ao carregar, com o motivo e o botao de tentar de novo. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert error error-state" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn small" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          Tentar de novo
        </button>
      )}
    </div>
  );
}

/** Um bloco cinza do tamanho do que vai aparecer (o "esqueleto" da tela). */
export function Skeleton({
  width = "100%",
  height = 12,
  radius
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
}) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius }} aria-hidden />;
}

/** Linhas cinzas no formato de uma lista, enquanto ela chega. */
export function SkeletonRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="skeleton-rows" role="status" aria-label="Carregando">
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="skeleton-row"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton
              key={column}
              width={column === 0 ? "70%" : `${45 + ((row + column) % 3) * 15}%`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A tela inteira enquanto o arquivo dela ou a primeira leitura chega: topo e tres cartoes. */
export function PageSkeleton() {
  return (
    <div className="page-skeleton" role="status" aria-label="Carregando a tela">
      <div className="page-skeleton-head">
        <Skeleton width={90} height={10} />
        <Skeleton width={220} height={22} radius={8} />
      </div>
      <div className="page-skeleton-cards">
        <Skeleton height={86} radius={12} />
        <Skeleton height={86} radius={12} />
        <Skeleton height={86} radius={12} />
      </div>
      <SkeletonRows rows={6} columns={4} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

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

/** O alvo do clique e um controle da linha (botao, link, campo)? */
function isControl(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest("button, a, input, select, textarea, label") !== null
  );
}

/**
 * Tabela das listas. Mostra `pageSize` linhas (50) e o "Ver mais" embaixo: desenhar as 2 mil
 * linhas de uma vez era o que deixava as telas pesadas. `pageKey` volta para a primeira pagina
 * quando muda (a busca, o filtro); `pageSize={0}` desliga (lista que ja vem paginada do banco).
 * Com `loading` e nada ainda na lista, mostra o esqueleto das linhas no lugar de "Carregando...".
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  empty = "Nada por aqui.",
  emptyHint,
  loading,
  pageSize = PAGE_SIZE,
  pageKey,
  footer,
  onRowDoubleClick
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  empty?: string;
  /** Segunda linha da lista vazia (o que fazer). */
  emptyHint?: ReactNode;
  /** Primeira leitura a caminho: esqueleto em vez de "lista vazia". */
  loading?: boolean;
  pageSize?: number;
  pageKey?: string;
  /** Rodape dentro da moldura da tabela (o "Ver mais" da lista paginada no banco). */
  footer?: ReactNode;
  /**
   * Dois cliques na linha (a lista de clientes abre os dados do cliente). Clique duplo num botao
   * ou link da linha continua sendo daquele botao.
   */
  onRowDoubleClick?: (row: T) => void;
}) {
  const page = useShowMore(pageKey ?? "", pageSize);
  if (rows.length === 0) {
    if (loading) {
      return (
        <div className="table-wrap">
          <SkeletonRows rows={5} columns={Math.min(Math.max(columns.length, 2), 6)} />
        </div>
      );
    }
    return <EmptyState title={empty} hint={emptyHint} />;
  }
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
            <tr
              key={rowKey(row)}
              className={
                [rowClassName?.(row), onRowDoubleClick ? "row-open" : undefined]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              onDoubleClick={
                onRowDoubleClick
                  ? (event) => {
                      if (isControl(event.target)) return;
                      onRowDoubleClick(row);
                    }
                  : undefined
              }
            >
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
// Janela e confirmacao
// ---------------------------------------------------------------------------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Janelas abertas, da mais antiga para a de cima: o Esc fecha so a de cima. */
const openModals: string[] = [];
let scrollLocks = 0;

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement
  );
}

/**
 * Janela por cima da tela. Fecha no X, no Esc (so a de cima, quando uma abre sobre a outra) e
 * no clique fora. Ao abrir, o cursor vai para o primeiro campo; o Tab fica dentro da janela; ao
 * fechar, o cursor volta para o botao que a abriu. A pagina de tras nao rola.
 */
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
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openModals.push(id);
    scrollLocks += 1;
    const previousOverflow = scrollLocks === 1 ? document.body.style.overflow : null;
    if (scrollLocks === 1) document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      const body = dialog.querySelector<HTMLElement>(".modal-body");
      const first = body ? focusables(body)[0] : undefined;
      (first ?? dialog).focus();
    }

    function onKey(event: KeyboardEvent) {
      if (openModals[openModals.length - 1] !== id) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = focusables(dialogRef.current);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const index = openModals.lastIndexOf(id);
      if (index >= 0) openModals.splice(index, 1);
      scrollLocks -= 1;
      if (scrollLocks === 0) document.body.style.overflow = previousOverflow ?? "";
      if (previous?.isConnected) previous.focus();
    };
  }, [id]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1}
      >
        <div className="modal-head">
          <div className="modal-head-text">
            <h2 id={`${id}-title`}>{title}</h2>
            {description && <p id={`${id}-description`}>{description}</p>}
          </div>
          <button type="button" className="modal-close" aria-label="Fechar" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger`: botao vermelho (excluir, remover, cancelar pesagem). */
  tone?: "danger" | "default";
  /** Mostra "Esta ação não pode ser desfeita." embaixo da mensagem. */
  irreversible?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

// Sem provedor (teste de componente solto) a confirmacao responde "nao": nada destrutivo roda.
const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

/**
 * Confirmacao do proprio site, no lugar da janelinha cinza do navegador (`window.confirm`), que
 * nao deixa explicar a consequencia nem destacar o botao perigoso:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Remover destinatário?", tone: "danger" }))) return;
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);
  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setRequest((current) => {
          // Uma confirmacao por vez: a que estava aberta vale como "nao".
          current?.resolve(false);
          return { ...options, resolve };
        });
      }),
    []
  );
  const answer = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <Modal
          title={request.title}
          onClose={() => answer(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => answer(false)}>
                {request.cancelLabel ?? "Cancelar"}
              </button>
              <button
                type="button"
                className={`btn ${request.tone === "danger" ? "danger" : "primary"}`}
                onClick={() => answer(true)}
              >
                {request.confirmLabel ?? "Confirmar"}
              </button>
            </>
          }
        >
          {request.message && <div className="confirm-message">{request.message}</div>}
          {request.irreversible && (
            <p className="confirm-irreversible">Esta ação não pode ser desfeita.</p>
          )}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

// ---------------------------------------------------------------------------
// Campo e avisos
// ---------------------------------------------------------------------------

type FieldChildProps = {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * Rotulo + campo + dica/erro. Quando o campo e um `input`/`select`/`textarea` direto, o rotulo
 * fica ligado a ele (clicar no nome poe o cursor no campo, e o leitor de tela le o nome), o
 * asterisco aparece sozinho se o campo tem `required`, e o `error` aparece embaixo do campo.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children
}: {
  label: string;
  hint?: string;
  /** Erro deste campo, mostrado embaixo dele (no lugar da dica). */
  error?: string | null;
  /** Marca como obrigatorio quando o campo nao e um input direto (seletor, grupo). */
  required?: boolean;
  children: ReactNode;
}) {
  const autoId = useId();
  const direct =
    isValidElement(children) && typeof children.type === "string"
      ? (children as ReactElement<FieldChildProps>)
      : null;
  const inputId = direct ? (direct.props.id ?? autoId) : undefined;
  const noteId = `${autoId}-note`;
  const note = error || hint;
  const control = direct
    ? cloneElement(direct, {
        id: inputId,
        "aria-invalid": error ? true : direct.props["aria-invalid"],
        "aria-describedby":
          [direct.props["aria-describedby"], note ? noteId : undefined].filter(Boolean).join(" ") ||
          undefined
      })
    : children;
  const isRequired = required ?? direct?.props.required === true;
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={inputId}>
        {label}
        {isRequired && (
          <span className="field-required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {control}
      {error ? (
        <span className="field-error" id={noteId} role="alert">
          {error}
        </span>
      ) : (
        hint && (
          <span className="hint" id={noteId}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}

export function Alert({
  kind,
  children
}: {
  kind: "error" | "warn" | "info";
  children: ReactNode;
}) {
  return (
    <div className={`alert ${kind}`} role={kind === "error" ? "alert" : undefined}>
      {children}
    </div>
  );
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
