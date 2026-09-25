/**
 * Consulta de CNPJ na Receita (BrasilAPI `/cnpj/v1`), no formato que o cadastro de cliente usa.
 *
 * Duas portas usam a mesma consulta: a balanca (`cnpj-lookup`, autenticada pelo token do
 * dispositivo) e o site (`web-api`, acao `lookup_cnpj`, autenticada pelo login). A regra de
 * traducao vive aqui para as duas preencherem o formulario igual.
 */

import { documentKind, normalizeDocument } from "./document.ts";

/** Resposta normalizada. Campo ausente vem como null. */
export type CnpjLookupResult = {
  found: boolean;
  cnpj: string;
  legalName: string | null;
  tradeName: string | null;
  email: string | null;
  phone: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
};

/** Campos da BrasilAPI (/cnpj/v1) que consumimos. Fonte: Receita Federal. */
export type BrasilApiCnpj = {
  razao_social?: string | null;
  nome_fantasia?: string | null;
  cep?: string | number | null;
  logradouro?: string | null;
  numero?: string | number | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  ddd_telefone_1?: string | null;
  email?: string | null;
  descricao_situacao_cadastral?: string | null;
};

/** Erro com o status HTTP que a funcao deve devolver (400 documento, 502 Receita fora). */
export class CnpjLookupError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function clean(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

/** "1130611000" -> "(11) 30611000"; devolve o texto original quando nao casa. */
function formatPhone(raw: string | null | undefined): string | null {
  const digits = onlyDigits(String(raw ?? ""));
  if (digits.length < 10) return clean(raw ?? null);
  return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
}

export function mapBrasilApi(cnpj: string, data: BrasilApiCnpj): CnpjLookupResult {
  return {
    found: true,
    cnpj,
    legalName: clean(data.razao_social),
    tradeName: clean(data.nome_fantasia) ?? clean(data.razao_social),
    email: clean(data.email),
    phone: formatPhone(data.ddd_telefone_1),
    zipcode: clean(onlyDigits(String(data.cep ?? ""))),
    addressStreet: clean(data.logradouro),
    addressNumber: clean(data.numero),
    addressComplement: clean(data.complemento),
    neighborhood: clean(data.bairro),
    city: clean(data.municipio),
    state: clean(data.uf),
    status: clean(data.descricao_situacao_cadastral)
  };
}

function notFound(cnpj: string): CnpjLookupResult {
  return {
    found: false,
    cnpj,
    legalName: null,
    tradeName: null,
    email: null,
    phone: null,
    zipcode: null,
    addressStreet: null,
    addressNumber: null,
    addressComplement: null,
    neighborhood: null,
    city: null,
    state: null,
    status: null
  };
}

/**
 * Consulta o CNPJ. 14 posicoes, numerico ou alfanumerico (IN RFB 2.229/2024): a consulta segue
 * com o documento como foi digitado — quem nao existe na base volta como "nao encontrado", o que
 * e melhor do que recusar aqui um CNPJ novo que o operador tem no papel.
 */
export async function lookupCnpj(
  rawCnpj: string,
  fetchImpl: typeof fetch = fetch
): Promise<CnpjLookupResult> {
  const cnpj = normalizeDocument(rawCnpj);
  if (documentKind(cnpj) !== "cnpj") {
    throw new CnpjLookupError(400, "CNPJ invalido. Informe as 14 posicoes.");
  }
  let response: Response;
  try {
    response = await fetchImpl(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { Accept: "application/json" }
    });
  } catch (error) {
    throw new CnpjLookupError(
      502,
      error instanceof Error ? error.message : "Falha na consulta do CNPJ."
    );
  }
  if (response.status === 404) return notFound(cnpj);
  if (!response.ok) {
    throw new CnpjLookupError(
      502,
      `Consulta CNPJ indisponivel (HTTP ${response.status}). Tente novamente.`
    );
  }
  return mapBrasilApi(cnpj, (await response.json()) as BrasilApiCnpj);
}
