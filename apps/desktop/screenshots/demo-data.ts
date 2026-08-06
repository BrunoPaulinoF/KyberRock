/**
 * Massa de dados FICTICIA usada apenas para gerar as capturas de tela de
 * documentacao/portfolio. Nenhum nome, CNPJ, telefone ou valor aqui existe:
 * clientes, transportadoras, motoristas e placas sao inventados.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Agora" do harness. O relogio do navegador e congelado pelo script de captura
 * (fim de expediente), entao os horarios das telas nascem sempre iguais.
 */
export const NOW = new Date();

export function iso(date: Date): string {
  return date.toISOString();
}

export function dbStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function dayIso(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

export function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

export function daysAhead(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS);
}

export const UNIT = {
  companyId: "cmp_9f3a",
  companyName: "Mineracao Serra do Cedro LTDA",
  unitId: "unit_pedreira_norte",
  unitName: "Pedreira Norte - Km 42",
  deviceId: "dev_balanca_01",
  deviceName: "Balanca 01"
};

export interface DemoCustomer {
  id: string;
  omieCustomerId: number;
  legalName: string;
  tradeName: string;
  document: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  creditLimitCents: number;
  openReceivablesCents: number;
  creditMode: "normal" | "prepaid";
}

export const CUSTOMERS: DemoCustomer[] = [
  {
    id: "cus_001",
    omieCustomerId: 480011,
    legalName: "Construtora Vale Verde Engenharia LTDA",
    tradeName: "Vale Verde Engenharia",
    document: "18.204.336/0001-52",
    phone: "(31) 3255-4180",
    email: "compras@valeverde.demo",
    city: "Betim",
    state: "MG",
    creditLimitCents: 12_000_000,
    openReceivablesCents: 4_318_500,
    creditMode: "normal"
  },
  {
    id: "cus_002",
    omieCustomerId: 480027,
    legalName: "Concreteira Rio Claro Industria e Comercio S/A",
    tradeName: "Concreteira Rio Claro",
    document: "27.918.440/0001-06",
    phone: "(31) 3644-2290",
    email: "suprimentos@rioclaro.demo",
    city: "Contagem",
    state: "MG",
    creditLimitCents: 25_000_000,
    openReceivablesCents: 11_742_000,
    creditMode: "normal"
  },
  {
    id: "cus_003",
    omieCustomerId: 480035,
    legalName: "Terraplenagem Horizonte Azul ME",
    tradeName: "Horizonte Azul",
    document: "33.610.827/0001-71",
    phone: "(31) 98812-4477",
    email: "financeiro@horizonteazul.demo",
    city: "Sabara",
    state: "MG",
    creditLimitCents: 4_500_000,
    openReceivablesCents: 986_400,
    creditMode: "prepaid"
  },
  {
    id: "cus_004",
    omieCustomerId: 480048,
    legalName: "Asfaltos Vale do Sol Pavimentacao LTDA",
    tradeName: "Vale do Sol Pavimentacao",
    document: "41.775.219/0001-38",
    phone: "(31) 3712-9080",
    email: "obras@valedosol.demo",
    city: "Nova Lima",
    state: "MG",
    creditLimitCents: 18_000_000,
    openReceivablesCents: 7_204_900,
    creditMode: "normal"
  },
  {
    id: "cus_005",
    omieCustomerId: 480052,
    legalName: "Construtora Monte Alto Empreendimentos EIRELI",
    tradeName: "Monte Alto Empreendimentos",
    document: "22.480.913/0001-64",
    phone: "(31) 3399-1122",
    email: "compras@montealto.demo",
    city: "Belo Horizonte",
    state: "MG",
    creditLimitCents: 9_000_000,
    openReceivablesCents: 2_140_000,
    creditMode: "normal"
  },
  {
    id: "cus_006",
    omieCustomerId: 480061,
    legalName: "Pre-Moldados Pedra Branca LTDA",
    tradeName: "Pedra Branca Pre-Moldados",
    document: "36.145.702/0001-19",
    phone: "(31) 3521-7744",
    email: "logistica@pedrabranca.demo",
    city: "Ribeirao das Neves",
    state: "MG",
    creditLimitCents: 6_500_000,
    openReceivablesCents: 1_530_200,
    creditMode: "normal"
  },
  {
    id: "cus_007",
    omieCustomerId: 480074,
    legalName: "Obras Bandeirantes Infraestrutura LTDA",
    tradeName: "Bandeirantes Infraestrutura",
    document: "19.883.560/0001-27",
    phone: "(31) 3488-6501",
    email: "suprimentos@bandeirantes.demo",
    city: "Santa Luzia",
    state: "MG",
    creditLimitCents: 15_000_000,
    openReceivablesCents: 5_980_300,
    creditMode: "normal"
  },
  {
    id: "cus_008",
    omieCustomerId: 480083,
    legalName: "Usina Nova Aurora Concreto e Argamassa S/A",
    tradeName: "Usina Nova Aurora",
    document: "44.207.611/0001-85",
    phone: "(31) 3266-3030",
    email: "compras@novaaurora.demo",
    city: "Vespasiano",
    state: "MG",
    creditLimitCents: 21_000_000,
    openReceivablesCents: 8_612_700,
    creditMode: "normal"
  }
];

export interface DemoProduct {
  id: string;
  omieProductId: number;
  code: string;
  description: string;
  unitPriceCents: number;
}

export const PRODUCTS: DemoProduct[] = [
  {
    id: "prd_001",
    omieProductId: 90011,
    code: "BR-00",
    description: "Brita 0",
    unitPriceCents: 8_900
  },
  {
    id: "prd_002",
    omieProductId: 90012,
    code: "BR-01",
    description: "Brita 1",
    unitPriceCents: 9_250
  },
  {
    id: "prd_003",
    omieProductId: 90013,
    code: "BR-02",
    description: "Brita 2",
    unitPriceCents: 9_100
  },
  {
    id: "prd_004",
    omieProductId: 90014,
    code: "PO-PD",
    description: "Po de pedra",
    unitPriceCents: 6_400
  },
  {
    id: "prd_005",
    omieProductId: 90015,
    code: "RCH-1",
    description: "Rachao",
    unitPriceCents: 5_800
  },
  {
    id: "prd_006",
    omieProductId: 90016,
    code: "BC-CR",
    description: "Bica corrida",
    unitPriceCents: 6_950
  },
  {
    id: "prd_007",
    omieProductId: 90017,
    code: "AR-IN",
    description: "Areia industrial",
    unitPriceCents: 10_400
  }
];

export const CARRIERS = [
  {
    id: "car_001",
    omieCustomerId: 512001,
    name: "Transportes Rota Norte LTDA",
    document: "29.514.880/0001-44",
    phone: "(31) 3444-7788",
    email: "logistica@rotanorte.demo",
    city: "Contagem",
    state: "MG"
  },
  {
    id: "car_002",
    omieCustomerId: 512004,
    name: "Logistica Terra Firme EIRELI",
    document: "38.902.117/0001-90",
    phone: "(31) 3777-1240",
    email: "frota@terrafirme.demo",
    city: "Betim",
    state: "MG"
  },
  {
    id: "car_003",
    omieCustomerId: 512009,
    name: "TransSerra Cargas Pesadas LTDA",
    document: "45.330.286/0001-13",
    phone: "(31) 98155-9021",
    email: "operacao@transserra.demo",
    city: "Sabara",
    state: "MG"
  }
];

export const DRIVERS = [
  {
    id: "drv_001",
    name: "Anderson Rocha Lima",
    document: "204.558.310-92",
    phone: "(31) 98411-2277",
    carrierId: "car_001"
  },
  {
    id: "drv_002",
    name: "Gilmar Teixeira Alves",
    document: "318.740.226-05",
    phone: "(31) 99120-4433",
    carrierId: "car_001"
  },
  {
    id: "drv_003",
    name: "Wesley Antunes Prado",
    document: "155.902.487-16",
    phone: "(31) 98230-7781",
    carrierId: "car_002"
  },
  {
    id: "drv_004",
    name: "Ronaldo Bastos Vieira",
    document: "402.117.559-30",
    phone: "(31) 99744-2210",
    carrierId: "car_002"
  },
  {
    id: "drv_005",
    name: "Marcio Duarte Nogueira",
    document: "271.336.804-58",
    phone: "(31) 98066-3391",
    carrierId: "car_003"
  },
  {
    id: "drv_006",
    name: "Elton Ferraz Camargo",
    document: "509.228.176-44",
    phone: "(31) 99388-1102",
    carrierId: "car_003"
  },
  {
    id: "drv_007",
    name: "Sebastiao Correia Pinto",
    document: "633.041.298-77",
    phone: "(31) 98577-6620",
    carrierId: null
  }
];

export const VEHICLES = [
  { id: "veh_001", plate: "RKB4C21", description: "Caminhao truck cacamba", carrierId: "car_001" },
  { id: "veh_002", plate: "QNZ7D45", description: "Carreta basculante", carrierId: "car_001" },
  { id: "veh_003", plate: "PLF2J88", description: "Bitrem 9 eixos", carrierId: "car_002" },
  { id: "veh_004", plate: "SVA6H30", description: "Caminhao toco", carrierId: "car_002" },
  { id: "veh_005", plate: "MTQ5B17", description: "Carreta LS", carrierId: "car_003" },
  { id: "veh_006", plate: "RDX8K62", description: "Caminhao truck", carrierId: "car_003" },
  { id: "veh_007", plate: "NHP3G09", description: "Bitrem basculante", carrierId: null }
];

export const PAYMENT_METHODS = [
  {
    id: "pay_001",
    code: "01",
    name: "Dinheiro",
    omieCode: "01",
    accountId: "acc_001",
    accountName: "Caixa da balanca",
    isWallet: false,
    isCustomerCredit: false,
    sortOrder: 1
  },
  {
    id: "pay_002",
    code: "03",
    name: "PIX",
    omieCode: "99",
    accountId: "acc_002",
    accountName: "Banco Cedro - C/C 4471-2",
    isWallet: false,
    isCustomerCredit: false,
    sortOrder: 2
  },
  {
    id: "pay_003",
    code: "15",
    name: "Boleto bancario",
    omieCode: "15",
    accountId: "acc_002",
    accountName: "Banco Cedro - C/C 4471-2",
    isWallet: false,
    isCustomerCredit: false,
    sortOrder: 3
  },
  {
    id: "pay_004",
    code: "04",
    name: "Cartao de credito",
    omieCode: "04",
    accountId: "acc_003",
    accountName: "Adquirente - recebiveis",
    isWallet: false,
    isCustomerCredit: false,
    sortOrder: 4
  },
  {
    id: "pay_005",
    code: "90",
    name: "Credito do cliente (adiantamento)",
    omieCode: "90",
    accountId: null,
    accountName: null,
    isWallet: false,
    isCustomerCredit: true,
    sortOrder: 5
  },
  {
    id: "pay_006",
    code: "98",
    name: "Em carteira",
    omieCode: null,
    accountId: null,
    accountName: null,
    isWallet: true,
    isCustomerCredit: false,
    sortOrder: 6
  }
];

export const ACCOUNTS = [
  {
    id: "acc_001",
    code: "1.01",
    name: "Caixa da balanca",
    omieCode: "3110022",
    isSystem: false,
    sortOrder: 1
  },
  {
    id: "acc_002",
    code: "1.02",
    name: "Banco Cedro - C/C 4471-2",
    omieCode: "3110024",
    isSystem: false,
    sortOrder: 2
  },
  {
    id: "acc_003",
    code: "1.03",
    name: "Adquirente - recebiveis",
    omieCode: "3110031",
    isSystem: false,
    sortOrder: 3
  }
];

export const PAYMENT_TERMS = [
  { id: "ter_001", omieCode: "000", name: "A vista", installmentCount: 1 },
  { id: "ter_002", omieCode: "007", name: "7 dias", installmentCount: 1 },
  { id: "ter_003", omieCode: "014", name: "14 dias", installmentCount: 1 },
  { id: "ter_004", omieCode: "028", name: "28 dias", installmentCount: 1 },
  { id: "ter_005", omieCode: "30/60", name: "30/60 dias", installmentCount: 2 },
  { id: "ter_006", omieCode: "30/60/90", name: "30/60/90 dias", installmentCount: 3 }
];

/**
 * Gerador pseudoaleatorio deterministico: as capturas precisam de numeros que
 * variem entre linhas, mas que sejam sempre os mesmos a cada execucao.
 */
export function seeded(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

export const PRICE_TABLES = [
  { id: "ptb_001", name: "Tabela padrao 2026", omieTableId: 71001 },
  { id: "ptb_002", name: "Grandes volumes (acima de 500 t/mes)", omieTableId: 71004 },
  { id: "ptb_003", name: "Obra publica - contrato 118/2026", omieTableId: 71009 }
];
