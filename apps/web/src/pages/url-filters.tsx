import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";

import {
  INVOICE_CLOSING_PERIOD_KINDS,
  defaultInvoiceClosingPeriod,
  type InvoiceClosingPeriodKind,
  type InvoiceClosingPeriodSelection
} from "../lib/invoice-closing";
import { useUrlState } from "../lib/url-state";

/**
 * Pecas das telas de relatorio para os filtros que ficam no endereco (`useUrlState`, etapa 4 do
 * plano de UI): ler com seguranca o que veio no link e ligar os campos digitados ao endereco.
 */

/** O valor do endereco quando e um dos permitidos; link velho ou digitado errado vira o padrao. */
export function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** `"a,b"` do endereco vira lista: so os permitidos, sem repetir (filtro de multipla escolha). */
export function listOf<T extends string>(value: string, allowed: readonly T[]): T[] {
  const picked: T[] = [];
  for (const item of value.split(",")) {
    const trimmed = item.trim();
    if ((allowed as readonly string[]).includes(trimmed) && !picked.includes(trimmed as T)) {
      picked.push(trimmed as T);
    }
  }
  return picked;
}

/**
 * Data AAAA-MM-DD do endereco. Data que nao existe viraria `Invalid Date` na leitura do periodo
 * (e o `toISOString` quebra a tela): fica o padrao.
 */
export function isoDayOr(value: string, fallback: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
    ? value
    : fallback;
}

/** Mes AAAA-MM do endereco, ou o padrao. */
export function isoMonthOr(value: string, fallback: string): string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : fallback;
}

/**
 * Campo digitado (busca, data, mes) de um filtro que mora no endereco. O endereco muda dentro de
 * uma transicao do roteador, e input controlado direto por ele perde letra e pula o cursor
 * (o React devolve o valor antigo ate a transicao terminar). Aqui o campo guarda o que a pessoa
 * digita e o endereco acompanha; se o endereco mudar por fora (atalho de periodo, link), o campo
 * mostra o novo valor.
 */
export function FilterInput({
  value,
  onValue,
  keepLastValid,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> & {
  value: string;
  onValue: (next: string) => void;
  /**
   * Data e mes: o campo vazio no meio da digitacao (dia apagado) nao muda o filtro, que fica na
   * ultima data valida ate a pessoa terminar.
   */
  keepLastValid?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setDraft(value);
  }, [value]);
  return (
    <input
      {...props}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (keepLastValid && !next) return;
        committed.current = next;
        onValue(next);
      }}
    />
  );
}

/**
 * Periodo de atalho + datas do "Personalizado" no endereco: `periodo`, `de` e `ate`. As datas
 * so contam no personalizado; nos atalhos elas ficam de fora da conta.
 */
export function usePeriodParams<T extends string>(
  allowed: readonly T[],
  fallback: T,
  defaultStart: string,
  defaultEnd: string
) {
  const [periodParam, setPeriod] = useUrlState("periodo", fallback);
  const [startParam, setCustomStart] = useUrlState("de", defaultStart);
  const [endParam, setCustomEnd] = useUrlState("ate", defaultEnd);
  return {
    period: oneOf(periodParam, allowed, fallback),
    setPeriod: setPeriod as (next: T) => void,
    customStart: isoDayOr(startParam, defaultStart),
    setCustomStart,
    customEnd: isoDayOr(endParam, defaultEnd),
    setCustomEnd
  };
}

/**
 * O periodo do Fechamento de faturas e da Carteira (quinzena, mes, semana ou datas livres) no
 * endereco: `periodo` (o tipo), `mes`, `quinzena` (1 ou 2), `semana` (um dia dela), `de` e `ate`.
 * Com `defaultKind` vazio (a Carteira), `periodo` ausente quer dizer "sem recorte".
 */
export function useClosingPeriodParams(defaultKind: InvoiceClosingPeriodKind | "") {
  const defaults = defaultInvoiceClosingPeriod(new Date());
  const [kindParam, setKind] = useUrlState("periodo", defaultKind);
  const [monthParam, setMonth] = useUrlState("mes", defaults.month);
  const [halfParam, setHalfParam] = useUrlState("quinzena", String(defaults.half));
  const [weekDayParam, setWeekDay] = useUrlState("semana", defaults.weekDay);
  const [startParam, setCustomStart] = useUrlState("de", defaults.customStart);
  const [endParam, setCustomEnd] = useUrlState("ate", defaults.customEnd);

  const enabled = (INVOICE_CLOSING_PERIOD_KINDS as readonly string[]).includes(kindParam);
  const kind = oneOf(kindParam, INVOICE_CLOSING_PERIOD_KINDS, defaultKind || defaults.kind);
  const month = isoMonthOr(monthParam, defaults.month);
  const half: 1 | 2 = halfParam === "1" ? 1 : halfParam === "2" ? 2 : defaults.half;
  const weekDay = isoDayOr(weekDayParam, defaults.weekDay);
  const customStart = isoDayOr(startParam, defaults.customStart);
  const customEnd = isoDayOr(endParam, defaults.customEnd);

  const selection = useMemo<InvoiceClosingPeriodSelection>(
    () => ({ kind, month, half, weekDay, customStart, customEnd }),
    [kind, month, half, weekDay, customStart, customEnd]
  );
  return {
    selection,
    /** Algum tipo de periodo escolhido (na Carteira, falso e "Tudo em aberto"). */
    enabled,
    setKind: setKind as (next: InvoiceClosingPeriodKind | "") => void,
    setMonth,
    setHalf: (next: 1 | 2) => setHalfParam(String(next)),
    setWeekDay,
    setCustomStart,
    setCustomEnd
  };
}
