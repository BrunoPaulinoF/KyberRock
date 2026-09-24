import { useEffect, useId, useMemo, useRef, useState } from "react";

import { matchesSearch } from "../lib/operation";

export interface PickerOption {
  value: string;
  label: string;
  /** Texto menor embaixo (documento, descricao). Tambem entra na busca. */
  hint?: string;
}

const MAX_VISIBLE = 8;

/**
 * Campo de escolha com busca — o "digita um pedaco e escolhe" do desktop. Enter escolhe o
 * primeiro da lista, setas navegam, Esc fecha. `allowEmpty` mostra a opcao de deixar vazio
 * (transportadora, forma de pagamento).
 */
export function Picker({
  value,
  options,
  onChange,
  placeholder = "Buscar...",
  allowEmpty,
  emptyLabel = "Nenhum",
  autoFocus,
  disabled
}: {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? null;
  const [text, setText] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // A escolha veio de fora (padrao do cliente, formulario reaberto): mostra o nome dela.
  useEffect(() => {
    if (!open) setText(selected?.label ?? "");
  }, [selected?.label, open]);

  const matches = useMemo(() => {
    const search = open && text !== (selected?.label ?? "") ? text : "";
    const found = options.filter((option) =>
      matchesSearch(`${option.label} ${option.hint ?? ""}`, search)
    );
    return found.slice(0, MAX_VISIBLE);
  }, [options, text, open, selected?.label]);

  const items: Array<PickerOption | null> = allowEmpty ? [null, ...matches] : matches;

  function choose(option: PickerOption | null) {
    onChange(option?.value ?? "");
    setText(option?.label ?? "");
    setOpen(false);
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
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onFocus={(event) => {
          setOpen(true);
          setActive(0);
          event.currentTarget.select();
        }}
        onBlur={() => {
          // Da tempo do clique na lista chegar antes de fechar.
          window.setTimeout(() => setOpen(false), 120);
        }}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, items.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open && items.length > 0) {
            event.preventDefault();
            choose(items[Math.min(active, items.length - 1)] ?? null);
          } else if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
            setText(selected?.label ?? "");
          }
        }}
      />
      {open && !disabled && (
        <ul className="picker-list" id={listId} role="listbox">
          {items.length === 0 && <li className="picker-empty">Nada encontrado.</li>}
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
