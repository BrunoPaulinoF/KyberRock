import { Hash, LogOut, Moon, Search, Sun, Truck, User, type LucideIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth, useUser } from "../lib/auth";
import {
  plateFromQuery,
  plateLabel,
  rankCommands,
  receiptCodeFromQuery,
  type SearchCommand
} from "../lib/command-search";
import { formatDocument } from "../lib/format";
import { NAV_SECTIONS, NAV_SHORTCUTS } from "../lib/navigation";
import { canSee } from "../lib/permissions";
import { q } from "../lib/queries";
import { preloadScreen } from "../lib/screens";
import { useTheme } from "../lib/theme";

/**
 * Busca rapida (Ctrl+K, ou o botao "Buscar" do menu): digite o nome de uma tela, um cliente,
 * uma placa ou o numero de um cupom e va direto, sem procurar no menu (etapa 4 do plano de UI).
 * Mostra so o que o perfil pode abrir. As setas escolhem, Enter abre, Esc fecha.
 */

interface PaletteItem extends SearchCommand {
  group: string;
  hint?: string;
  icon?: LucideIcon;
  run: () => void;
}

const CUSTOMER_DEBOUNCE_MS = 250;

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const user = useUser();
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [customers, setCustomers] = useState<PaletteItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const canSeeCustomers = canSee(user.role, "cadastros");

  function go(to: string) {
    onClose();
    navigate(to);
  }

  const fixed = useMemo<PaletteItem[]>(() => {
    const screens: PaletteItem[] = NAV_SECTIONS.flatMap((section) =>
      section.items
        .filter((item) => canSee(user.role, item.screen))
        .map((item) => ({
          id: `tela:${item.to}`,
          label: item.label,
          keywords: item.keywords,
          group: "Telas",
          hint: section.title,
          icon: item.icon,
          run: () => {
            preloadScreen(item.screen);
            go(item.to);
          }
        }))
    );
    const shortcuts: PaletteItem[] = NAV_SHORTCUTS.filter((item) =>
      canSee(user.role, item.screen)
    ).map((item) => ({
      id: `atalho:${item.to}`,
      label: item.label,
      keywords: item.keywords,
      group: "Telas",
      icon: Search,
      run: () => go(item.to)
    }));
    const actions: PaletteItem[] = [
      {
        id: "acao:tema",
        label: theme === "light" ? "Usar tema escuro" : "Usar tema claro",
        keywords: ["tema", "escuro", "claro", "noite"],
        group: "Ações",
        icon: theme === "light" ? Moon : Sun,
        run: () => {
          toggle();
          onClose();
        }
      },
      {
        id: "acao:sair",
        label: "Sair",
        keywords: ["logout", "desconectar"],
        group: "Ações",
        icon: LogOut,
        run: () => {
          onClose();
          void logout();
        }
      }
    ];
    return [...screens, ...shortcuts, ...actions];
    // `go` e `onClose` mudam a cada render; o que muda a lista e o perfil e o tema.
  }, [user.role, theme]);

  // Clientes: procura no banco depois que a pessoa para de digitar.
  useEffect(() => {
    const text = query.trim();
    if (!canSeeCustomers || text.length < 2 || plateFromQuery(text) || receiptCodeFromQuery(text)) {
      setCustomers([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      q.searchCustomers(user.companyId, text, 6)
        .then((rows) => {
          if (cancelled) return;
          setCustomers(
            rows.map((row) => ({
              id: `cliente:${row.id}`,
              label: row.trade_name || row.legal_name || "Cliente sem nome",
              group: "Clientes",
              hint: formatDocument(row.document) || row.legal_name || undefined,
              icon: User,
              run: () => go(`/cadastros/clientes?cliente=${encodeURIComponent(row.id)}`)
            }))
          );
        })
        .catch(() => {
          if (!cancelled) setCustomers([]);
        });
    }, CUSTOMER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, canSeeCustomers, user.companyId]);

  const items = useMemo<PaletteItem[]>(() => {
    const found: PaletteItem[] = [];
    const plate = plateFromQuery(query);
    if (plate && canSee(user.role, "operacoes")) {
      found.push({
        id: `placa:${plate}`,
        label: `Placa ${plateLabel(plate)} nas operações abertas`,
        group: "Placa",
        icon: Truck,
        run: () => go(`/operacoes?placa=${plate}`)
      });
    }
    const code = receiptCodeFromQuery(query);
    if (code && canSee(user.role, "cupons")) {
      found.push({
        id: `cupom:${code}`,
        label: `Procurar o cupom ${code}`,
        group: "Cupom",
        icon: Hash,
        run: () => go(`/cupons?codigo=${encodeURIComponent(code)}`)
      });
    }
    return [...found, ...rankCommands(query, fixed, 8), ...customers];
    // `go` muda a cada render; a lista depende do texto, das telas e dos clientes achados.
  }, [query, fixed, customers, user.role]);

  useEffect(() => setActive(0), [query, customers.length]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const element = document.getElementById(`${listId}-${active}`);
    element?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  // Enquanto a busca esta aberta, a pagina de tras nao rola.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (items.length ? (current + 1) % items.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (items.length ? (current - 1 + items.length) % items.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      items[active]?.run();
    }
  }

  let lastGroup = "";
  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Busca rápida">
        <div className="palette-input">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              canSeeCustomers
                ? "Buscar tela, cliente, placa ou cupom…"
                : "Buscar tela, placa ou cupom…"
            }
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items.length ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" id={listId} role="listbox" aria-label="Resultados">
          {items.length === 0 && <li className="palette-empty">Nada encontrado.</li>}
          {items.map((item, index) => {
            const Icon = item.icon ?? Search;
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {header && (
                  <div className="palette-group" role="presentation">
                    {header}
                  </div>
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={`palette-item${index === active ? " active" : ""}`}
                  onMouseMove={() => setActive(index)}
                  onClick={() => item.run()}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span className="palette-label">{item.label}</span>
                  {item.hint && <span className="palette-hint">{item.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> escolher
          </span>
          <span>
            <kbd>Enter</kbd> abrir
          </span>
        </div>
      </div>
    </div>
  );
}

/** Ctrl+K (ou Cmd+K no Mac) abre e fecha a busca rapida. */
export function isPaletteShortcut(event: globalThis.KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k";
}
