import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";

/** Uma linha da lista. `sublabel` e o dado de apoio que separa homonimos (CNPJ, cidade). */
export interface SearchPickerOption {
  id: string;
  label: string;
  sublabel?: string | null;
  /** Marca visual a direita ("Inativo", "3x"). */
  badge?: string | null;
}

interface SearchPickerProps {
  /** Ja filtradas e ordenadas por quem chama — este componente nao reordena nada. */
  options: SearchPickerOption[];
  value: string;
  onChange: (id: string) => void;
  /** O texto digitado. Controlado por fora para quem precisa buscar no cache. */
  search: string;
  onSearchChange: (search: string) => void;
  placeholder: string;
  /** Rotulo do item selecionado quando ele nao esta na lista visivel (outra busca). */
  selectedLabel?: string | null;
  /**
   * Linha fixa no topo da lista, sempre visivel (ex.: "Todos os clientes"). Nao entra na
   * busca: ela nao e um cadastro, e some-la ao digitar tiraria a saida do operador.
   */
  leadingOption?: SearchPickerOption | null;
  loading?: boolean;
  disabled?: boolean;
  /** Quantos casaram ao todo — o rodape avisa quando ha mais do que cabe na lista. */
  totalMatches?: number;
  /** Texto de rodape proprio da tela, no lugar da contagem. */
  footNote?: string | null;
  inputStyle?: CSSProperties;
  /** Mostra o "x" que limpa a selecao. */
  clearable?: boolean;
  autoFocus?: boolean;
}

const listStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  zIndex: 40,
  maxHeight: "280px",
  overflowY: "auto",
  border: "1px solid var(--kr-border)",
  borderRadius: "10px",
  background: "var(--kr-surface)",
  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.18)"
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  width: "100%",
  textAlign: "left",
  padding: "9px 11px",
  border: "none",
  borderBottom: "1px solid var(--kr-border)",
  background: "transparent",
  cursor: "pointer",
  fontSize: "13px",
  color: "var(--kr-text-strong)"
};

/**
 * A barra de pesquisa com a lista LOGO ABAIXO dela.
 *
 * Substitui o `<select>` nativo em toda escolha de cadastro do aplicativo. O `<select>`
 * abria a lista inteira ao clique — milhares de clientes numa caixa que ninguem consegue
 * rolar — e obrigava a um passo a mais: digitar numa barra ao lado e SO ENTAO abrir o
 * dropdown para ver o que sobrou. Aqui e um movimento so: escreve e a lista abaixo ja
 * mostra o que corresponde, com o mais parecido no topo.
 *
 * Quem filtra e ordena e quem chama (o cache, para os cadastros grandes; o ranking em
 * memoria, para as listas pequenas) — este componente so desenha e cuida do teclado.
 */
export function SearchPicker({
  options,
  value,
  onChange,
  search,
  onSearchChange,
  placeholder,
  selectedLabel = null,
  leadingOption = null,
  loading = false,
  disabled = false,
  totalMatches,
  footNote = null,
  inputStyle,
  clearable = false,
  autoFocus = false
}: SearchPickerProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const rows = leadingOption ? [leadingOption, ...options] : options;
  const selected =
    rows.find((option) => option.id === value) ??
    (value && selectedLabel ? { id: value, label: selectedLabel } : null);

  // Fechado, o campo mostra QUEM esta escolhido; aberto, mostra o que esta sendo digitado.
  // Sem isso o operador abria a tela e via o campo em branco num cliente ja selecionado.
  const inputValue = open ? search : (selected?.label ?? "");

  useEffect(() => {
    setHighlighted(0);
  }, [search, options]);

  // Clique fora fecha. Precisa ser no documento: a lista flutua sobre o resto da tela.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      onSearchChange("");
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onSearchChange]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  function pick(option: SearchPickerOption): void {
    onChange(option.id);
    setOpen(false);
    onSearchChange("");
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlighted((index) => Math.min(Math.max(0, rows.length - 1), index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      const option = rows[highlighted];
      if (!open || !option) return;
      event.preventDefault();
      pick(option);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      onSearchChange("");
    }
  }

  const hiddenByLimit =
    typeof totalMatches === "number" && totalMatches > options.length ? totalMatches : null;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={inputValue}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => {
          if (!open) setOpen(true);
          onSearchChange(event.target.value);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        style={{
          ...inputStyle,
          width: "100%",
          paddingRight: clearable && value ? "34px" : inputStyle?.paddingRight
        }}
      />
      {clearable && value && !disabled ? (
        <button
          type="button"
          aria-label="Limpar selecao"
          title="Limpar selecao"
          onClick={() => {
            onChange("");
            onSearchChange("");
          }}
          style={{
            position: "absolute",
            right: "8px",
            top: "50%",
            transform: "translateY(-50%)",
            border: "none",
            background: "transparent",
            color: "var(--kr-muted)",
            cursor: "pointer",
            fontSize: "16px",
            lineHeight: 1,
            padding: "2px 4px"
          }}
        >
          ×
        </button>
      ) : null}

      {open ? (
        <div ref={listRef} id={listId} role="listbox" style={listStyle}>
          {loading ? (
            <div style={{ padding: "12px", color: "var(--kr-muted)", fontSize: "13px" }}>
              Procurando...
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "12px", color: "var(--kr-muted)", fontSize: "13px" }}>
              {search.trim() ? `Nenhum resultado para "${search.trim()}".` : "Nada cadastrado."}
            </div>
          ) : (
            rows.map((option, index) => (
              <button
                key={option.id || `leading-${index}`}
                type="button"
                role="option"
                aria-selected={option.id === value}
                data-index={index}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => pick(option)}
                style={{
                  ...rowStyle,
                  background:
                    highlighted === index
                      ? "var(--kr-card-hover)"
                      : (rowStyle.background as string),
                  fontWeight: option.id === value ? 700 : 400
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {option.label}
                  </span>
                  {option.sublabel ? (
                    <span
                      style={{
                        display: "block",
                        fontSize: "11px",
                        color: "var(--kr-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {option.sublabel}
                    </span>
                  ) : null}
                </span>
                {option.badge ? (
                  <span
                    style={{
                      flexShrink: 0,
                      borderRadius: "999px",
                      background: "var(--kr-surface-soft)",
                      border: "1px solid var(--kr-border)",
                      color: "var(--kr-muted)",
                      fontSize: "10px",
                      fontWeight: 800,
                      padding: "2px 7px"
                    }}
                  >
                    {option.badge}
                  </span>
                ) : null}
              </button>
            ))
          )}

          {footNote || hiddenByLimit ? (
            <p
              style={{
                margin: 0,
                padding: "8px 11px",
                fontSize: "11px",
                color: "var(--kr-muted)",
                borderTop: "1px solid var(--kr-border)"
              }}
            >
              {footNote ??
                (search.trim()
                  ? `Mostrando ${options.length} de ${hiddenByLimit} — escreva mais para afunilar.`
                  : `${hiddenByLimit} cadastrados. Escreva o nome para achar o resto.`)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
