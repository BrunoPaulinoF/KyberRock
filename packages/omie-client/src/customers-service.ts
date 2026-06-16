import type { OmieClient } from "./omie-client.js";

export interface Customer {
  id: number;
  integrationCode?: string;
  name: string;
  tradeName?: string;
  document?: string;
  stateRegistration?: string;
  municipalRegistration?: string;
  isIndividual?: boolean;
  email?: string;
  homepage?: string;
  contactName?: string;
  phone?: string;
  phoneSecondary?: string;
  address?: string;
  zipcode?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  ibgeCityCode?: string;
  ibgeStateCode?: string;
  customerType?: string;
  isForeign?: boolean;
  billingBlocked?: boolean;
  isActive: boolean;
  observations?: string;
  tags?: Record<string, unknown> | unknown[];
  salespersonId?: number;
}

export interface CreateCustomerInput {
  razaoSocial: string;
  nomeFantasia?: string;
  cnpjCpf: string;
  email?: string;
  telefone1Ddd?: string;
  telefone1Numero?: string;
}

export interface UpdateCustomerInput {
  codigoClienteOmie: number;
  razaoSocial?: string;
  nomeFantasia?: string;
  cnpjCpf?: string;
  email?: string;
  telefone1Ddd?: string;
  telefone1Numero?: string;
}

export interface ListCustomersParam {
  pagina: number;
  registrosPorPagina?: number;
  apenasImportadoApi?: "S" | "N";
}

interface OmieCustomerRaw {
  codigo_cliente_omie?: number | string;
  codigoClienteOmie?: number | string;
  codigo_cliente_integracao?: string;
  codigoClienteIntegracao?: string;
  razao_social?: string;
  razaoSocial?: string;
  nome_fantasia?: string;
  nomeFantasia?: string;
  cnpj_cpf?: string;
  cnpjCpf?: string;
  inscricao_estadual?: string;
  inscricaoEstadual?: string;
  inscricao_municipal?: string;
  inscricaoMunicipal?: string;
  pessoa_fisica?: string;
  pessoaFisica?: string;
  email?: string;
  homepage?: string;
  contato?: string;
  endereco?: string;
  endereco_numero?: string;
  enderecoNumero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  cidade_ibge?: string;
  cidadeIbge?: string;
  estado_ibge?: string;
  estadoIbge?: string;
  pais?: string;
  codigo_pais?: string;
  codigoPais?: string;
  telefone1_ddd?: string;
  telefone1Ddd?: string;
  telefone1_numero?: string;
  telefone1Numero?: string;
  telefone2_ddd?: string;
  telefone2Ddd?: string;
  telefone2_numero?: string;
  telefone2Numero?: string;
  cliente_fornecedor?: string;
  clienteFornecedor?: string;
  inativo?: string;
  bloquear_faturamento?: string;
  bloquearFaturamento?: string;
  exterior?: string;
  observacao?: string;
  tags?: Record<string, unknown> | unknown[];
  codigo_vendedor?: number | string;
  codigoVendedor?: number | string;
}

export async function listCustomers(
  client: OmieClient,
  param: ListCustomersParam
): Promise<Customer[]> {
  const response = (await client.call(
    "/api/v1/geral/clientes/",
    "ListarClientes",
    param
  )) as {
    clientes_cadastro?: OmieCustomerRaw[];
    clientesCadastro?: OmieCustomerRaw[];
  };

  const raw = response.clientes_cadastro ?? response.clientesCadastro ?? [];
  const customers: Customer[] = [];
  for (const item of raw) {
    const mapped = mapOmieCustomerRaw(item);
    if (mapped) customers.push(mapped);
  }
  return customers;
}

export async function getCustomer(
  client: OmieClient,
  codigoClienteOmie: number
): Promise<Customer | null> {
  const response = (await client.call(
    "/api/v1/geral/clientes/",
    "ConsultarCliente",
    { codigoClienteOmie }
  )) as OmieCustomerRaw;

  return mapOmieCustomerRaw(response);
}

export async function createCustomer(
  client: OmieClient,
  input: CreateCustomerInput
): Promise<number> {
  const response = (await client.call(
    "/api/v1/geral/clientes/",
    "IncluirCliente",
    input
  )) as {
    codigoClienteOmie?: number;
    codigo_cliente_omie?: number;
  };

  const id = response.codigoClienteOmie ?? response.codigo_cliente_omie;
  if (!id) throw new Error("OMIE nao retornou codigoClienteOmie ao criar cliente.");
  return id;
}

export async function updateCustomer(
  client: OmieClient,
  input: UpdateCustomerInput
): Promise<void> {
  await client.call(
    "/api/v1/geral/clientes/",
    "AlterarCliente",
    input
  );
}

export class OmieCustomersService {
  constructor(private readonly client: OmieClient) {}

  async listAll(pageSize = 50): Promise<Customer[]> {
    const all: Customer[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const customers = await listCustomers(this.client, {
        pagina: page,
        registrosPorPagina: pageSize,
        apenasImportadoApi: "N"
      });

      if (customers.length === 0) break;
      all.push(...customers);

      hasMore = customers.length === pageSize;
      page++;
    }

    return all;
  }

  async getById(id: number): Promise<Customer | null> {
    return getCustomer(this.client, id);
  }

  async create(input: CreateCustomerInput): Promise<number> {
    return createCustomer(this.client, input);
  }

  async update(input: UpdateCustomerInput): Promise<void> {
    return updateCustomer(this.client, input);
  }
}

function mapOmieCustomerRaw(item: OmieCustomerRaw | null | undefined): Customer | null {
  if (!item) return null;
  const idValue = pickFirst(item.codigo_cliente_omie, item.codigoClienteOmie);
  if (!idValue) return null;
  const id = toNumber(idValue);
  if (id === null) return null;
  const name = pickFirst(item.razao_social, item.razaoSocial);
  if (!name) return null;

  const phoneDdd = pickFirst(item.telefone1_ddd, item.telefone1Ddd);
  const phoneNumber = pickFirst(item.telefone1_numero, item.telefone1Numero);
  const phone = phoneDdd && phoneNumber ? `(${phoneDdd}) ${phoneNumber}` : undefined;

  const phone2Ddd = pickFirst(item.telefone2_ddd, item.telefone2Ddd);
  const phone2Number = pickFirst(item.telefone2_numero, item.telefone2Numero);
  const phoneSecondary = phone2Ddd && phone2Number ? `(${phone2Ddd}) ${phone2Number}` : undefined;

  const addressStreet = pickFirst(item.endereco);
  const addressNumber = pickFirst(item.endereco_numero, item.enderecoNumero);
  const addressComplement = pickFirst(item.complemento);
  const neighborhood = pickFirst(item.bairro);
  const city = pickFirst(item.cidade);
  const state = pickFirst(item.estado);
  const zipcode = pickFirst(item.cep);
  const address = [addressStreet, addressNumber, neighborhood, city, state]
    .filter((value): value is string => Boolean(value))
    .join(", ");

  const customer: Customer = {
    id,
    name,
    isActive: !isYesFlag(item.inativo)
  };

  assign(customer, "integrationCode", pickFirst(item.codigo_cliente_integracao, item.codigoClienteIntegracao));
  assign(customer, "tradeName", pickFirst(item.nome_fantasia, item.nomeFantasia));
  assign(customer, "document", pickFirst(item.cnpj_cpf, item.cnpjCpf));
  assign(customer, "stateRegistration", pickFirst(item.inscricao_estadual, item.inscricaoEstadual));
  assign(customer, "municipalRegistration", pickFirst(item.inscricao_municipal, item.inscricaoMunicipal));
  assign(customer, "email", pickFirst(item.email));
  assign(customer, "homepage", pickFirst(item.homepage));
  assign(customer, "contactName", pickFirst(item.contato));
  assign(customer, "zipcode", zipcode);
  assign(customer, "addressStreet", addressStreet);
  assign(customer, "addressNumber", addressNumber);
  assign(customer, "addressComplement", addressComplement);
  assign(customer, "neighborhood", neighborhood);
  assign(customer, "city", city);
  assign(customer, "state", state);
  assign(customer, "country", pickFirst(item.pais));
  assign(customer, "countryCode", pickFirst(item.codigo_pais, item.codigoPais));
  assign(customer, "ibgeCityCode", pickFirst(item.cidade_ibge, item.cidadeIbge));
  assign(customer, "ibgeStateCode", pickFirst(item.estado_ibge, item.estadoIbge));
  assign(customer, "customerType", pickFirst(item.cliente_fornecedor, item.clienteFornecedor));
  assign(customer, "observations", pickFirst(item.observacao));

  if (phone) customer.phone = phone;
  if (phoneSecondary) customer.phoneSecondary = phoneSecondary;
  if (address) customer.address = address;
  customer.isIndividual = isYesFlag(pickFirst(item.pessoa_fisica, item.pessoaFisica));
  customer.isForeign = isYesFlag(item.exterior);
  customer.billingBlocked = isYesFlag(pickFirst(item.bloquear_faturamento, item.bloquearFaturamento));
  if (item.tags) customer.tags = item.tags;
  const salespersonId = toNumber(pickFirst(item.codigo_vendedor, item.codigoVendedor));
  if (salespersonId !== null) customer.salespersonId = salespersonId;

  return customer;
}

function assign(customer: Customer, key: keyof Customer, value: string | undefined): void {
  if (value) (customer as unknown as Record<string, unknown>)[key as string] = value;
}

function pickFirst(...values: Array<string | number | null | undefined>): string | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function isYesFlag(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === "S";
}
