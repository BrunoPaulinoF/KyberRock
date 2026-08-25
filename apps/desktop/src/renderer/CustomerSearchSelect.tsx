import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { CustomerReportOption } from "../services/customer-report";
import {
  CUSTOMER_OPTION_LIMIT,
  customerOptionLabel,
  rankCustomerOptions
} from "./customer-option-search";
import { useDebouncedValue } from "./use-debounced-value";

interface CustomerSearchSelectProps {
  /** Lista completa vinda do cadastro. A tela nunca pinta tudo — quem corta e daqui. */
  customers: readonly CustomerReportOption[];
  value: string;
  onChange: (customerId: string) => void;
  /** Opcoes fixas que vem antes dos clientes (ex.: "Todos os clientes"). */
  leadingOptions?: Array<{ value: string; label: string }>;
  inputStyle: CSSProperties;
  hintStyle: CSSProperties;
  placeholder?: string;
  /** Texto de apoio proprio da tela, mostrado abaixo da contagem. */
  children?: ReactNode;
}

/**
 * Seletor de cliente das telas de relatorio: escreva o nome, escolha na lista.
 *
 * As tres telas que usam isto (Relatorio por cliente, Fechamento e Conferencia de
 * faturamento) traziam o cadastro inteiro num `<select>` nativo — clicar abria a lista com
 * TODOS os clientes, e em duas delas nem havia campo de busca: achar um cliente era rolar
 * milhares de linhas. Agora a lista e o resultado da busca, do que mais se aproxima para o
 * que menos, cortada num tamanho que a tela pinta sem travar.
 */
export function CustomerSearchSelect({
  customers,
  value,
  onChange,
  leadingOptions = [],
  inputStyle,
  hintStyle,
  placeholder = "Buscar por nome ou CNPJ/CPF",
  children
}: CustomerSearchSelectProps) {
  const [search, setSearch] = useState("");
  // A lista inteira e varrida a cada tecla; esperar a palavra evita refazer a varredura (e
  // repintar o `<select>`) seis vezes enquanto o operador digita um nome.
  const debouncedSearch = useDebouncedValue(search);

  const page = useMemo(
    () => rankCustomerOptions(customers, debouncedSearch, value),
    [customers, debouncedSearch, value]
  );

  return (
    <>
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        style={inputStyle}
      />
      <select value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle}>
        {leadingOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {page.options.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customerOptionLabel(customer)}
          </option>
        ))}
      </select>
      {/*
        O corte precisa aparecer: sem esta linha o operador via 50 clientes, nao achava o
        dele e concluia que ele nao estava cadastrado.
      */}
      {page.total > CUSTOMER_OPTION_LIMIT ? (
        <p style={hintStyle}>
          {debouncedSearch.trim()
            ? `${page.total} clientes casam com a busca — mostrando os ${CUSTOMER_OPTION_LIMIT} mais proximos. Escreva mais para afunilar.`
            : `${page.total} clientes cadastrados — mostrando os ${CUSTOMER_OPTION_LIMIT} primeiros. Escreva o nome para achar o resto.`}
        </p>
      ) : null}
      {debouncedSearch.trim() && page.total === 0 ? (
        <p style={hintStyle}>Nenhum cliente para &quot;{debouncedSearch.trim()}&quot;.</p>
      ) : null}
      {children}
    </>
  );
}
