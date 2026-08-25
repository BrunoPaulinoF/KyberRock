import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { CustomerReportOption } from "../services/customer-report";
import { CUSTOMER_OPTION_LIMIT, rankCustomerOptions } from "./customer-option-search";
import { SearchPicker } from "./SearchPicker";
import { useDebouncedValue } from "./use-debounced-value";

interface CustomerSearchSelectProps {
  /** Lista completa vinda do cadastro. A tela nunca pinta tudo — quem corta e daqui. */
  customers: readonly CustomerReportOption[];
  value: string;
  onChange: (customerId: string) => void;
  /** Linha fixa no topo (ex.: "Todos os clientes"). */
  leadingOption?: { value: string; label: string } | null;
  inputStyle: CSSProperties;
  hintStyle: CSSProperties;
  placeholder?: string;
  /** Texto de apoio proprio da tela, mostrado abaixo do campo. */
  children?: ReactNode;
}

/**
 * Escolha de cliente das telas de relatorio: escreva o nome, a lista aparece logo abaixo.
 *
 * As tres telas que usam isto (Relatorio por cliente, Fechamento e Conferencia de
 * faturamento) tinham um `<select>` nativo com o cadastro inteiro: clicar abria a lista com
 * TODOS os clientes, e mesmo com a barra de pesquisa ao lado era preciso digitar e SO
 * ENTAO abrir o dropdown para ver o que tinha sobrado. Agora e um movimento so.
 */
export function CustomerSearchSelect({
  customers,
  value,
  onChange,
  leadingOption = null,
  inputStyle,
  hintStyle,
  placeholder = "Buscar cliente por nome ou CNPJ/CPF...",
  children
}: CustomerSearchSelectProps) {
  const [search, setSearch] = useState("");
  // A lista inteira e varrida a cada tecla; esperar a palavra evita refazer a varredura seis
  // vezes enquanto o operador digita um nome.
  const debouncedSearch = useDebouncedValue(search);

  const page = useMemo(
    () => rankCustomerOptions(customers, debouncedSearch, value),
    [customers, debouncedSearch, value]
  );

  const options = useMemo(
    () =>
      page.options.map((customer) => ({
        id: customer.id,
        label: customer.name,
        sublabel: customer.document
      })),
    [page.options]
  );

  const selectedLabel = useMemo(
    () => customers.find((customer) => customer.id === value)?.name ?? null,
    [customers, value]
  );

  return (
    <>
      <SearchPicker
        options={options}
        value={value}
        onChange={onChange}
        search={search}
        onSearchChange={setSearch}
        placeholder={placeholder}
        selectedLabel={selectedLabel}
        leadingOption={
          leadingOption ? { id: leadingOption.value, label: leadingOption.label } : null
        }
        totalMatches={page.total}
        inputStyle={inputStyle}
      />
      {/*
        O corte precisa aparecer fora da lista tambem: quem fechou o campo sem escolher
        continua precisando saber que ha mais cliente do que apareceu ali.
      */}
      {page.total > CUSTOMER_OPTION_LIMIT ? (
        <p style={hintStyle}>
          {debouncedSearch.trim()
            ? `${page.total} clientes casam com a busca — a lista mostra os ${CUSTOMER_OPTION_LIMIT} mais proximos.`
            : `${page.total} clientes cadastrados. Escreva o nome, o nome fantasia ou o CNPJ/CPF.`}
        </p>
      ) : null}
      {children}
    </>
  );
}
