import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";

import { CrudFormModal } from "./CrudFormModal";
import { filterEntityPickerItems } from "./entity-picker";
import type { EntityPickerItem } from "./entity-picker";

interface EntityPickerDialogProps {
  title: string;
  /** Linha de contexto da operacao sendo alterada (placa, produto, cliente atual). */
  contextLines: string[];
  searchPlaceholder: string;
  items: EntityPickerItem[];
  loading: boolean;
  /** Id ja vinculado a operacao, destacado como "Atual" na lista. */
  selectedId: string | null;
  /** Quando presente, mostra a opcao de desvincular (ex.: "Sem transportadora"). */
  clearOption?: { label: string; description: string } | null;
  onSelect: (id: string) => void;
  onClear?: () => void;
  onClose: () => void;
}

const listBoxStyle: CSSProperties = {
  border: "1px solid var(--kr-border)",
  borderRadius: "12px",
  background: "var(--kr-surface-soft)",
  overflowY: "auto",
  maxHeight: "46vh",
  minHeight: "180px"
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  border: "none",
  borderBottom: "1px solid var(--kr-border)",
  background: "transparent",
  cursor: "pointer",
  fontSize: "13px",
  color: "var(--kr-text-strong)"
};

const badgeStyle: CSSProperties = {
  flexShrink: 0,
  borderRadius: "999px",
  fontSize: "10px",
  fontWeight: 800,
  letterSpacing: "0.02em",
  padding: "2px 7px",
  textTransform: "uppercase"
};

/**
 * Modal de troca de cliente/transportadora em operacoes: lista COMPLETA do cadastro
 * com barra de pesquisa por nome.
 *
 * Antes era um `<select>` nativo carregado com uma unica pagina do cache — quem tinha
 * muitos cadastros perdia os que ficavam fora da pagina e nao tinha como procurar
 * pelo nome dentro da lista.
 */
export function EntityPickerDialog({
  title,
  contextLines,
  searchPlaceholder,
  items,
  loading,
  selectedId,
  clearOption = null,
  onSelect,
  onClear,
  onClose
}: EntityPickerDialogProps) {
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const visibleItems = useMemo(() => filterEntityPickerItems(items, search), [items, search]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [search, items]);

  // Mantem a linha destacada dentro da area visivel quando o operador navega pelo teclado.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlightedIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(Math.max(0, visibleItems.length - 1), index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      const item = visibleItems[highlightedIndex];
      if (!item) return;
      event.preventDefault();
      onSelect(item.id);
    }
  }

  return (
    <CrudFormModal onClose={onClose} maxWidth={620}>
      <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>{title}</h3>
          {contextLines.length > 0 ? (
            <p style={{ margin: "6px 0 0", fontSize: "13px", color: "var(--kr-muted)" }}>
              {contextLines.map((line) => (
                <span key={line} style={{ display: "block" }}>
                  {line}
                </span>
              ))}
            </p>
          ) : null}
        </div>

        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          autoFocus
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          style={{
            width: "100%",
            border: "1px solid var(--kr-input-border)",
            borderRadius: "10px",
            padding: "9px 11px",
            fontSize: "13px",
            background: "var(--kr-input-bg)",
            color: "var(--kr-text-strong)"
          }}
        />

        <div ref={listRef} style={listBoxStyle}>
          {loading ? (
            <div style={{ padding: "14px", color: "var(--kr-muted)", fontSize: "13px" }}>
              Carregando lista completa...
            </div>
          ) : visibleItems.length === 0 ? (
            <div style={{ padding: "14px", color: "var(--kr-muted)", fontSize: "13px" }}>
              {items.length === 0
                ? "Nenhum cadastro disponivel."
                : "Nenhum resultado para a pesquisa."}
            </div>
          ) : (
            visibleItems.map((item, index) => {
              const isCurrent = selectedId !== null && item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-index={index}
                  onClick={() => onSelect(item.id)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  style={{
                    ...rowStyle,
                    background:
                      highlightedIndex === index ? "var(--kr-card-hover)" : rowStyle.background
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontWeight: 700,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {item.title}
                    </span>
                    {item.subtitle ? (
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
                        {item.subtitle}
                      </span>
                    ) : null}
                  </span>
                  <span style={{ display: "flex", flexShrink: 0, gap: "6px" }}>
                    {item.isActive ? null : (
                      <span
                        style={{
                          ...badgeStyle,
                          background: "var(--kr-surface)",
                          color: "var(--kr-muted)",
                          border: "1px solid var(--kr-border)"
                        }}
                      >
                        Inativo
                      </span>
                    )}
                    {isCurrent ? (
                      <span
                        style={{
                          ...badgeStyle,
                          background: "var(--kr-primary)",
                          color: "white"
                        }}
                      >
                        Atual
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            flexWrap: "wrap"
          }}
        >
          <span style={{ fontSize: "12px", color: "var(--kr-muted)" }}>
            {loading
              ? "Carregando..."
              : search.trim()
                ? `${visibleItems.length} de ${items.length} cadastro(s)`
                : `${items.length} cadastro(s)`}
          </span>
          <span style={{ display: "flex", gap: "8px" }}>
            {clearOption && onClear ? (
              <button
                type="button"
                onClick={onClear}
                title={clearOption.description}
                style={{
                  border: "1px solid var(--kr-border)",
                  background: "var(--kr-surface-soft)",
                  color: "var(--kr-text)",
                  borderRadius: "10px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: "12px"
                }}
              >
                {clearOption.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              style={{
                border: "1px solid var(--kr-border)",
                background: "var(--kr-surface)",
                color: "var(--kr-text-strong)",
                borderRadius: "10px",
                padding: "8px 12px",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: "12px"
              }}
            >
              Cancelar
            </button>
          </span>
        </div>
      </div>
    </CrudFormModal>
  );
}
