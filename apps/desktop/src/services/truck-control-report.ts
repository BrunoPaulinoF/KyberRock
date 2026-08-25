import { scoreTermAgainstText, searchTerms } from "@kyberrock/shared";

import type { TruckControlReport, TruckControlRow, TruckControlTrip } from "./reports.js";
import {
  SPREADSHEET_STYLE,
  documentStyle,
  escapeHtml,
  formatDayLabel,
  formatMinutes,
  formatTons,
  formatTonsNumber,
  kpiCards,
  num,
  section,
  sheetTable,
  slug,
  table
} from "./report-document.js";
import { renderTotalBar } from "./report-total-bar.js";

/**
 * Filtro e documentos do controle de caminhoes, nos dois formatos dos demais relatorios:
 * A4 retrato (vira PDF pelo `renderHtmlToPdf` do main) e HTML de tabelas gravado como
 * `.xls`.
 *
 * O filtro mora aqui, e nao dentro da tela, porque a busca por placa/motorista precisa
 * valer igual nos tres lugares: a lista que o operador ve, o PDF e a planilha. Quem
 * digita a placa de um cliente e manda baixar espera o arquivo com aquelas linhas — e nao
 * o periodo inteiro —, entao o arquivo e gerado a partir do MESMO relatorio filtrado que
 * esta na tela, com os totais recalculados para o recorte.
 *
 * A mesma placa costuma carregar para varios clientes no mes. Por isso os documentos tem
 * DUAS leituras do cliente: o resumo "Clientes atendidos" (quanto cada cliente levou
 * naquela placa) e a lista "Cargas do periodo", carga a carga, com data, cliente, produto
 * e peso — e essa que se confere contra a relacao de orcamentos por placa do OMIE.
 */

const TRUCK_HEADERS = [
  "Placa",
  "Motorista",
  "Operacoes",
  "Tempo medio",
  "Tempo total",
  "Peso (kg)",
  "Tonelagem (t)"
];

const PRODUCT_HEADERS = ["Placa", "Motorista", "Produto", "Operacoes", "Peso (kg)"];

const CUSTOMER_HEADERS = ["Placa", "Motorista", "Cliente", "Operacoes", "Peso (kg)"];

const TRIP_HEADERS = [
  "Data",
  "Placa",
  "Motorista",
  "Cliente",
  "Produto",
  "Peso (kg)",
  "Entrada",
  "Saida",
  "Tempo"
];

/** Busca normalizada (maiuscula, sem espaco nas pontas). Vazio = sem filtro. */
export function normalizeTruckSearch(search: string | null | undefined): string {
  return (search ?? "").trim().toUpperCase();
}

/**
 * A linha entra no recorte quando a placa OU o motorista casa com o que foi digitado.
 *
 * Casa por termo (a ordem em que a pessoa lembra de placa e motorista nao importa), sem
 * acento e sem pontuacao: "ABC-1D23" acha a placa gravada como "ABC1D23" e "joao" acha
 * "João" — antes nenhum dos dois achava, e a busca so servia se o operador digitasse
 * exatamente como estava no cadastro.
 *
 * A ORDEM do relatorio nao muda: ele lista caminhoes com totais por linha e um total geral
 * no rodape, e reordenar por proximidade tiraria o sentido da lista impressa.
 */
export function truckMatchesSearch(truck: TruckControlRow, term: string): boolean {
  if (!term) return true;
  const haystack = [truck.plate, truck.driverName ?? ""].filter(Boolean).join(" ");
  return searchTerms(term).every((token) => scoreTermAgainstText(token, haystack) > 0);
}

/**
 * Recorte do relatorio pela busca de placa/motorista, com os totais refeitos para os
 * caminhoes que sobraram — a tela e os arquivos mostram os numeros do que esta na lista,
 * nao os do periodo inteiro. O `averageMinutes` do recorte e ponderado por operacao (e
 * nao a media das medias), do mesmo jeito que o do periodo.
 */
export function filterTruckControlReport(
  report: TruckControlReport,
  search: string | null | undefined
): TruckControlReport {
  const term = normalizeTruckSearch(search);
  if (!term) return report.search === null ? report : { ...report, search: null };

  const trucks = report.trucks.filter((truck) => truckMatchesSearch(truck, term));
  const totalOperations = trucks.reduce((sum, truck) => sum + truck.operations, 0);
  const totalMinutes = trucks.reduce((sum, truck) => sum + truck.totalMinutes, 0);

  return {
    ...report,
    search: term,
    trucks,
    totalOperations,
    totalNetWeightKg: trucks.reduce((sum, truck) => sum + truck.totalNetWeightKg, 0),
    averageMinutes: totalOperations > 0 ? Math.round(totalMinutes / totalOperations) : 0
  };
}

/** "Filtro ..." no cabecalho dos documentos: deixa claro que o arquivo e um recorte. */
export function truckControlScopeLabel(report: TruckControlReport): string {
  return report.search ? `Filtro "${report.search}"` : "Todos os caminhoes";
}

export function truckControlFileBaseName(report: TruckControlReport): string {
  const scope = report.search ? slug(report.search, "filtro") : "geral";
  return `controle-caminhoes-${scope}-${report.startDate}-a-${report.endDate}`;
}

/** Documento A4 retrato do controle de caminhoes (o PDF do botao e o do e-mail). */
export function renderTruckControlHtml(
  report: TruckControlReport,
  generatedAt: Date = new Date()
): string {
  const kpis: Array<[string, string]> = [
    ["Caminhoes", num(report.trucks.length)],
    ["Operacoes", num(report.totalOperations)],
    ["Tempo medio na pedreira", formatMinutes(report.averageMinutes)],
    ["Tonelagem", formatTons(report.totalNetWeightKg)]
  ];

  const productRows = truckProductRows(report);
  const customerRows = truckCustomerRows(report);
  const tripRows = truckTripRows(report);

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>${escapeHtml(
    "Controle de caminhoes"
  )}</title><style>${documentStyle("portrait")}
</style></head><body>
<div class="header"><div><h1>Controle de caminhoes</h1><p class="customer">${escapeHtml(
    truckControlScopeLabel(report)
  )}</p><p class="period">Periodo: ${escapeHtml(
    periodText(report)
  )}</p></div><div class="generated">Gerado em<br />${escapeHtml(
    generatedAt.toLocaleString("pt-BR")
  )}</div></div>
${kpiCards(kpis)}
${section(
  "Caminhoes no periodo",
  table(
    TRUCK_HEADERS,
    report.trucks.map(truckCells),
    truckFooterCells(report),
    emptyMessage(report)
  )
)}
${section(
  "Clientes atendidos",
  table(CUSTOMER_HEADERS, customerRows, customerFooterCells(report), emptyMessage(report))
)}
${section(
  "Peso por produto",
  table(PRODUCT_HEADERS, productRows, productFooterCells(report), emptyMessage(report))
)}
${section(
  "Cargas do periodo",
  table(TRIP_HEADERS, tripRows, tripFooterCells(report), emptyMessage(report), "detail")
)}
${renderTotalBar([
  { label: "Caminhoes", value: num(report.trucks.length) },
  { label: "Clientes", value: num(countCustomers(report)) },
  { label: "Operacoes", value: num(report.totalOperations) },
  { label: "Tempo medio", value: formatMinutes(report.averageMinutes) },
  { label: "Tonelagem", value: formatTons(report.totalNetWeightKg), emphasis: true }
])}
</body></html>`;
}

/**
 * Mesmo recorte em planilha. O peso por produto e o peso por cliente saem em tabelas
 * proprias, uma linha por placa e produto/cliente: no Excel isso e o que permite filtrar e
 * somar por material ou por cliente, coisa que a coluna com varios itens empilhados do PDF
 * nao permitiria. A ultima tabela e a lista carga a carga, para conferir viagem por viagem.
 */
export function renderTruckControlSpreadsheet(
  report: TruckControlReport,
  generatedAt: Date = new Date()
): string {
  const blocks = [
    sheetTable(
      "Periodo",
      ["Campo", "Valor"],
      [
        ["Periodo", periodText(report)],
        ["Filtro (placa ou motorista)", report.search ?? "-"],
        ["Caminhoes", num(report.trucks.length)],
        ["Clientes atendidos", num(countCustomers(report))],
        ["Operacoes", num(report.totalOperations)],
        ["Tempo medio na pedreira", formatMinutes(report.averageMinutes)],
        ["Peso liquido (kg)", num(report.totalNetWeightKg)],
        ["Tonelagem (t)", formatTonsNumber(report.totalNetWeightKg)],
        ["Gerado em", generatedAt.toLocaleString("pt-BR")]
      ]
    ),
    sheetTable(
      "Caminhoes no periodo",
      TRUCK_HEADERS,
      report.trucks.map(truckCells),
      truckFooterCells(report)
    ),
    sheetTable(
      "Clientes atendidos",
      CUSTOMER_HEADERS,
      truckCustomerRows(report),
      customerFooterCells(report)
    ),
    sheetTable(
      "Peso por produto",
      PRODUCT_HEADERS,
      truckProductRows(report),
      productFooterCells(report)
    ),
    sheetTable("Cargas do periodo", TRIP_HEADERS, truckTripRows(report), tripFooterCells(report))
  ];

  const subtitle = [
    truckControlScopeLabel(report),
    periodText(report),
    `${num(report.trucks.length)} caminhao(oes)`,
    `Gerado em ${generatedAt.toLocaleString("pt-BR")}`
  ].join(" - ");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><style>${SPREADSHEET_STYLE}</style></head><body>
<h1>Controle de caminhoes</h1>
<p class="sub">${escapeHtml(subtitle)}</p>
${blocks.join("\n")}
</body></html>`;
}

function truckCells(truck: TruckControlRow): string[] {
  return [
    truck.plate,
    truck.driverName ?? "-",
    num(truck.operations),
    formatMinutes(truck.avgMinutes),
    formatMinutes(truck.totalMinutes),
    num(truck.totalNetWeightKg),
    formatTonsNumber(truck.totalNetWeightKg)
  ];
}

function truckFooterCells(report: TruckControlReport): string[] | null {
  if (report.trucks.length === 0) return null;
  return [
    "TOTAL",
    "",
    num(report.totalOperations),
    formatMinutes(report.averageMinutes),
    formatMinutes(report.trucks.reduce((sum, truck) => sum + truck.totalMinutes, 0)),
    num(report.totalNetWeightKg),
    formatTonsNumber(report.totalNetWeightKg)
  ];
}

function truckProductRows(report: TruckControlReport): string[][] {
  return report.trucks.flatMap((truck) =>
    truck.products.map((product) => [
      truck.plate,
      truck.driverName ?? "-",
      product.productDescription,
      num(product.operations),
      num(product.totalNetWeightKg)
    ])
  );
}

function productFooterCells(report: TruckControlReport): string[] | null {
  if (report.trucks.length === 0) return null;
  return ["TOTAL", "", "", num(report.totalOperations), num(report.totalNetWeightKg)];
}

/**
 * Uma linha por placa e cliente: e a resposta direta para "essa placa carregou para
 * quem?", com quantas viagens e quanto peso cada cliente levou naquele caminhao.
 */
function truckCustomerRows(report: TruckControlReport): string[][] {
  return report.trucks.flatMap((truck) =>
    truck.customers.map((customer) => [
      truck.plate,
      truck.driverName ?? "-",
      customer.customerName,
      num(customer.operations),
      num(customer.totalNetWeightKg)
    ])
  );
}

function customerFooterCells(report: TruckControlReport): string[] | null {
  if (report.trucks.length === 0) return null;
  return ["TOTAL", "", "", num(report.totalOperations), num(report.totalNetWeightKg)];
}

/** Carga a carga, em ordem de entrada na balanca, das placas que estao no recorte. */
function truckTripRows(report: TruckControlReport): string[][] {
  return report.trucks
    .flatMap((truck) => truck.trips.map((trip) => ({ truck, trip })))
    .sort((a, b) => tripOrder(a.trip).localeCompare(tripOrder(b.trip)))
    .map(({ truck, trip }) => [
      formatTripDay(trip.entryAt),
      truck.plate,
      truck.driverName ?? "-",
      trip.customerName,
      trip.productDescription,
      num(trip.netWeightKg),
      formatClock(trip.entryAt),
      formatClock(trip.exitAt),
      formatMinutes(trip.minutes)
    ]);
}

function tripFooterCells(report: TruckControlReport): string[] | null {
  if (report.trucks.length === 0) return null;
  const totalMinutes = report.trucks.reduce((sum, truck) => sum + truck.totalMinutes, 0);
  return [
    "TOTAL",
    "",
    "",
    "",
    `${num(report.totalOperations)} carga(s)`,
    num(report.totalNetWeightKg),
    "",
    "",
    formatMinutes(totalMinutes)
  ];
}

/** Clientes distintos do recorte (a mesma empresa em duas placas conta uma vez so). */
function countCustomers(report: TruckControlReport): number {
  const names = new Set<string>();
  for (const truck of report.trucks) {
    for (const customer of truck.customers) names.add(customer.customerName);
  }
  return names.size;
}

function tripOrder(trip: TruckControlTrip): string {
  return trip.entryAt ?? trip.exitAt ?? "";
}

/**
 * Data e hora vem em UTC do banco; quem le o relatorio quer o horario da balanca, entao
 * a conversao e a do computador que gera o documento. Timestamp que o `Date` nao entende
 * sai cru, que ainda diz mais que um traco.
 */
function tripDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTripDay(value: string | null): string {
  const date = tripDate(value);
  if (!date) return value ?? "-";
  return date.toLocaleDateString("pt-BR");
}

function formatClock(value: string | null): string {
  const date = tripDate(value);
  if (!date) return value ?? "-";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Sem linha nenhuma, a mensagem diz se o periodo esta vazio ou se foi o filtro. */
function emptyMessage(report: TruckControlReport): string {
  return report.search
    ? `Nenhum caminhao encontrado para "${report.search}" no periodo.`
    : "Sem operacoes no periodo.";
}

function periodText(report: TruckControlReport): string {
  return `${formatDayLabel(report.startDate)} a ${formatDayLabel(report.endDate)}`;
}
