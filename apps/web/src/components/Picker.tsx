import { ChevronDown } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import { matchesSearch } from "../lib/operation";
import { Skeleton } from "./ui";

export interface PickerOption {
  value: string;
  label: string;
  /** Texto menor embaixo (documento, descricao). Tambem entra na busca. */
  hint?: string;
}

/** Quantos itens a lista mostra de uma vez (rola dentro dela). */
const MAX_VISIBLE = 60;

/**
 * Campo de escolha com busca — o `SearchPicker` do desktop: clicar (ou a seta para baixo) abre
 * a lista inteira (e a setinha deixa claro que e uma selecao), digitar filtra. Enter escolhe o primeiro da lista,
 * setas navegam, Esc fecha. `allowEmpty` mostra a opcao de deixar vazio (transportadora, forma
 * de pagamento); `loading` avisa que a lista ainda esta chegando, em vez de "Nada encontrado".
 */
export function Picker({
  value,
  options,
  onChange,
  placeholder = "Buscar...",
  allowEmpty,
  emptyLabel = "Nenhum",
  autoFocus,
  disabled,
  loading,
  onSearch
}: {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /**
   * Busca no banco: recebe o texto digitado e quem chama troca `options` pelo resultado. A lista
   * entao nao filtra de novo aqui (o banco acha o CNPJ com pontuacao que o filtro local nao
   * acharia).
   */
  onSearch?: (text: string) => void;
}) {
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? null;
  // `text` e so a BUSCA. Fechado, o campo mostra quem esta escolhido; aberto, mostra o que esta
  // sendo digitado, e o escolhido vira a dica em cinza. Antes a caixa abria com o nome escolhido
  // dentro e o que se digitava grudava nele ("RONALDO ...joao"), sem achar ninguem.
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const search = open ? text : "";
    const found = onSearch
      ? options
      : options.filter((option) => matchesSearch(`${option.label} ${option.hint ?? ""}`, search));
    return found.slice(0, MAX_VISIBLE);
  }, [options, text, open, onSearch]);

  const items: Array<PickerOption | null> = allowEmpty ? [null, ...matches] : matches;

  /** Abre com a busca vazia: a lista inteira aparece e o que se digita comeca do zero. */
  function openList() {
    setActive(0);
    if (open) return;
    setText("");
    onSearch?.("");
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setText("");
  }

  function choose(option: PickerOption | null) {
    onChange(option?.value ?? "");
    close();
  }

  return (
    <div className="picker">
      <input
        ref={inputRef}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={open ? text : (selected?.label ?? "")}
        placeholder={open && selected ? selected.label : placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        // A lista abre no clique, ao digitar ou na seta para baixo — nao so por ganhar foco:
        // o Cliente ja entra focado na Nova entrada, e a lista aberta sozinha cobria Produto e
        // Forma de pagamento, entao o clique nesses campos escolhia um cliente sem querer.
        onFocus={(event) => event.currentTarget.select()}
        onMouseDown={openList}
        onBlur={() => {
          // Da tempo do clique na lista chegar antes de fechar.
          window.setTimeout(close, 120);
        }}
        onChange={(event) => {
          let typed = event.target.value;
          // Fechado, a caixa ainda mostrava o nome escolhido: se o cursor estava no fim dele, a
          // letra nova chega grudada. A busca e so o que foi digitado agora.
          if (!open && selected && typed.startsWith(selected.label)) {
            typed = typed.slice(selected.label.length);
          }
          setText(typed);
          setOpen(true);
          setActive(0);
          onSearch?.(typed);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              openList();
              return;
            }
            setActive((index) => Math.min(index + 1, items.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open && items.length > 0) {
            event.preventDefault();
            choose(items[Math.min(active, items.length - 1)] ?? null);
          } else if (event.key === "Escape" && open) {
            event.stopPropagation();
            close();
          }
        }}
      />
      <button
        type="button"
        className="picker-toggle"
        tabIndex={-1}
        aria-label="Abrir lista"
        disabled={disabled}
        onMouseDown={(event) => {
          event.preventDefault();
          if (open) {
            close();
          } else {
            inputRef.current?.focus();
            openList();
          }
        }}
      >
        <ChevronDown size={16} />
      </button>
      {open && !disabled && (
        <ul className="picker-list" id={listId} role="listbox">
          {loading && options.length === 0 && (
            <li className="picker-empty picker-loading" role="status" aria-label="Carregando">
              <Skeleton width="70%" />
              <Skeleton width="50%" />
              <Skeleton width="60%" />
            </li>
          )}
          {items.length === 0 && !(loading && options.length === 0) && (
            <li className="picker-empty">Nada encontrado.</li>
          )}
          {items.map((option, index) => (
            <li
              key={option?.value ?? "__empty"}
              role="option"
              aria-selected={index === active}
              className={index === active ? "active" : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => setActive(index)}
            >
              {option ? (
                <>
                  <span>{option.label}</span>
                  {option.hint && <small>{option.hint}</small>}
                </>
              ) : (
                <span className="picker-none">{emptyLabel}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
