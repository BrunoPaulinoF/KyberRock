import { useEffect, useRef, useState } from "react";

import { formatDocument } from "../lib/format";
import { q } from "../lib/queries";
import { Picker, type PickerOption } from "./Picker";

/**
 * Seletor de cliente que busca NO BANCO enquanto a pessoa digita (30 por vez), em vez de trazer
 * os 2 mil clientes da pedreira para a tela. A escolha atual fica sempre na lista, para o nome
 * dela nao sumir quando a busca seguinte nao a traz.
 */
export function CustomerPicker({
  companyId,
  value,
  onChange,
  placeholder = "Buscar cliente..."
}: {
  companyId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [chosen, setChosen] = useState<PickerOption | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      q.searchCustomers(companyId, text)
        .then((rows) => {
          if (current !== request.current) return;
          setOptions(
            rows.map((row) => ({
              value: row.id,
              label: row.trade_name || row.legal_name,
              hint: formatDocument(row.document) || undefined
            }))
          );
        })
        .catch(() => current === request.current && setOptions([]))
        .finally(() => current === request.current && setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [companyId, text]);

  const merged =
    chosen && chosen.value === value && !options.some((option) => option.value === value)
      ? [chosen, ...options]
      : options;

  return (
    <Picker
      value={value}
      options={merged}
      loading={loading}
      placeholder={placeholder}
      onSearch={setText}
      onChange={(next) => {
        setChosen(merged.find((option) => option.value === next) ?? null);
        onChange(next);
      }}
    />
  );
}
