import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { rankByText } from "@kyberrock/shared";

import { SearchPicker } from "./SearchPicker";
import type { SearchPickerOption } from "./SearchPicker";

/** Quantos resultados a lista mostra de uma vez. */
export const OPTION_PICKER_LIMIT = 50;

interface OptionSearchPickerProps {
  /** A lista COMPLETA, ja em memoria. O filtro e a ordem sao daqui. */
  options: readonly SearchPickerOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  /** Linha fixa no topo (ex.: "Todos", "Sem transportadora"). */
  leadingOption?: SearchPickerOption | null;
  disabled?: boolean;
  inputStyle?: CSSProperties;
  clearable?: boolean;
}

/**
 * O `SearchPicker` para as listas que a tela JA TEM em memoria — produto na tabela de
 * preco, transportadora padrao do cliente, categoria do OMIE, cliente do Insights.
 *
 * Sao listas de dezenas a centenas de linhas: pequenas demais para valer uma ida ao cache
 * a cada tecla, grandes demais para caberem num `<select>` que o operador consiga rolar.
 * A busca acontece aqui, com a mesma regra do resto do aplicativo — todos os termos casam,
 * quem casa melhor sobe, acento e pontuacao nao atrapalham.
 */
export function OptionSearchPicker({
  options,
  value,
  onChange,
  placeholder,
  leadingOption = null,
  disabled = false,
  inputStyle,
  clearable = false
}: OptionSearchPickerProps) {
  const [search, setSearch] = useState("");

  const ranked = useMemo(
    () =>
      rankByText(
        options,
        (option) => [option.label, option.sublabel ?? ""].filter(Boolean).join(" "),
        search
      ),
    [options, search]
  );

  const visible = useMemo(() => ranked.slice(0, OPTION_PICKER_LIMIT), [ranked]);

  const selectedLabel = useMemo(
    () => options.find((option) => option.id === value)?.label ?? null,
    [options, value]
  );

  return (
    <SearchPicker
      options={visible}
      value={value}
      onChange={onChange}
      search={search}
      onSearchChange={setSearch}
      placeholder={placeholder}
      selectedLabel={selectedLabel}
      leadingOption={leadingOption}
      totalMatches={ranked.length}
      disabled={disabled}
      inputStyle={inputStyle}
      clearable={clearable}
    />
  );
}
