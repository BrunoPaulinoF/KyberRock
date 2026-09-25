import { describe, expect, it } from "vitest";

import {
  DEFAULT_YARD_ATTENTION_MIN,
  DEFAULT_YARD_LATE_MIN,
  MONITOR_FILTERS_STORAGE_KEY,
  NO_PAYMENT_KEY,
  OTHER_KEY,
  MONITOR_PHONE_ITEMS,
  PAYMENT_SLOTS,
  activeFilterChips,
  averageYardMinutes,
  buildYard,
  chartTicks,
  clearDimensionFilters,
  compareCutoff,
  computeKpis,
  countActiveFilters,
  customerKeyOf,
  customerLabelOf,
  defaultMonitorFilters,
  deltaTone,
  detectNewIds,
  fitCapacity,
  fitCount,
  formatAgo,
  formatAxisValue,
  formatClock,
  formatDelta,
  formatDuration,
  formatMoneyShort,
  formatMoneyWhole,
  formatShare,
  formatTonnes,
  liveState,
  matchesFilters,
  normalizeText,
  parseMonitorFilters,
  paymentBreakdown,
  paymentOptions,
  productKeyOf,
  productLabelOf,
  productOptions,
  rankBy,
  rankLimitFor,
  relativeDelta,
  removeFilterChip,
  resolvePeriodWindow,
  resolveUnitId,
  safeTimeZone,
  saleAt,
  salesSeries,
  serializeMonitorFilters,
  sliceSales,
  splitVisible,
  toggleValue,
  yardLevel,
  yardThresholds,
  zonedDayKey,
  zonedMidnight,
  zonedParts,
  type MonitorFilters,
  type MonitorOperation
} from "./monitor";

const TZ = "America/Sao_Paulo";
/** 25/09/2026 14:00 em Brasilia (UTC-3). */
const NOW = Date.parse("2026-09-25T17:00:00Z");

let seq = 0;
function op(overrides: Partial<MonitorOperation> = {}): MonitorOperation {
  seq++;
  return {
    id: `op-${String(seq).padStart(4, "0")}`,
    unit_id: "unit-1",
    status: "synced",
    created_at: "2026-09-25T12:00:00Z",
    closed_at: "2026-09-25T12:40:00Z",
    plate: "ABC1D23",
    driver_name: "Joao",
    customer_id: "cust-1",
    customer_name: "Construtora Silva",
    product_id: "prod-1",
    product_description: "Brita 1",
    net_weight_kg: 10_000,
    unit_price_cents: 9_000,
    product_total_cents: 90_000,
    freight_total_cents: 10_000,
    total_cents: 100_000,
    payment_method_id: "pm-pix",
    ...overrides
  };
}

function filters(overrides: Partial<MonitorFilters> = {}): MonitorFilters {
  return { ...defaultMonitorFilters(), ...overrides };
}

describe("fuso da unidade", () => {
  it("usa o fuso da unidade e cai no de Brasilia quando e vazio ou invalido", () => {
    expect(safeTimeZone("America/Manaus")).toBe("America/Manaus");
    expect(safeTimeZone("  ")).toBe(TZ);
    expect(safeTimeZone(null)).toBe(TZ);
    expect(safeTimeZone("Nao/Existe")).toBe(TZ);
  });

  it("calcula o dia e a meia-noite no fuso da pedreira, nao em UTC", () => {
    // 01h30 UTC do dia 26 ainda e 22h30 do dia 25 em Brasilia.
    expect(zonedDayKey(Date.parse("2026-09-26T01:30:00Z"), TZ)).toBe("2026-09-25");
    expect(zonedParts(Date.parse("2026-09-26T01:30:00Z"), TZ).hour).toBe(22);
    expect(new Date(zonedMidnight("2026-09-25", TZ)).toISOString()).toBe(
      "2026-09-25T03:00:00.000Z"
    );
    expect(new Date(zonedMidnight("2026-09-25", "America/Manaus")).toISOString()).toBe(
      "2026-09-25T04:00:00.000Z"
    );
    expect(zonedParts(Date.parse("2026-09-25T03:00:00Z"), TZ).hour).toBe(0);
  });

  it("mostra a hora no fuso da unidade", () => {
    expect(formatClock("2026-09-25T17:32:00Z", TZ)).toBe("14:32");
    expect(formatClock("2026-09-25T17:32:00Z", "America/Manaus")).toBe("13:32");
    expect(formatClock(null, TZ)).toBe("--:--");
    expect(formatClock("invalido", TZ)).toBe("--:--");
  });
});

describe("resolvePeriodWindow", () => {
  it("hoje: por hora, ate o fim do dia, comparando com ontem ate a mesma hora", () => {
    const window = resolvePeriodWindow("today", NOW, TZ);
    expect(window.granularity).toBe("hour");
    expect(window.days).toEqual(["2026-09-25"]);
    expect(window.prevDays).toEqual(["2026-09-24"]);
    expect(new Date(window.start).toISOString()).toBe("2026-09-25T03:00:00.000Z");
    expect(new Date(window.end).toISOString()).toBe("2026-09-26T03:00:00.000Z");
    expect(new Date(window.prevStart).toISOString()).toBe("2026-09-24T03:00:00.000Z");
    expect(window.prevEnd).toBe(window.start);
    expect(window.live).toBe(true);
    expect(new Date(compareCutoff(window, NOW)).toISOString()).toBe("2026-09-24T17:00:00.000Z");
    expect(window.compareLabel).toBe("Ontem");
  });

  it("ontem: periodo fechado compara com o anteontem inteiro", () => {
    const window = resolvePeriodWindow("yesterday", NOW, TZ);
    expect(window.days).toEqual(["2026-09-24"]);
    expect(window.prevDays).toEqual(["2026-09-23"]);
    expect(window.live).toBe(false);
    expect(compareCutoff(window, NOW)).toBe(window.prevEnd);
  });

  it("ultimos 7 e 30 dias: por dia, com o periodo anterior do mesmo tamanho", () => {
    const week = resolvePeriodWindow("7d", NOW, TZ);
    expect(week.granularity).toBe("day");
    expect(week.days).toHaveLength(7);
    expect(week.days[0]).toBe("2026-09-19");
    expect(week.days[6]).toBe("2026-09-25");
    expect(week.prevDays[0]).toBe("2026-09-12");
    expect(week.prevDays[6]).toBe("2026-09-18");
    expect(new Date(compareCutoff(week, NOW)).toISOString()).toBe("2026-09-18T17:00:00.000Z");

    const month30 = resolvePeriodWindow("30d", NOW, TZ);
    expect(month30.days).toHaveLength(30);
    expect(month30.prevDays).toHaveLength(30);
    expect(month30.prevDays[29]).toBe("2026-08-26");
    expect(month30.days[0]).toBe("2026-08-27");
  });

  it("este mes: o mes inteiro no eixo e o anterior cortado no mesmo ponto", () => {
    const window = resolvePeriodWindow("month", NOW, TZ);
    expect(window.days).toHaveLength(30);
    expect(window.days[0]).toBe("2026-09-01");
    expect(window.prevDays).toHaveLength(31);
    expect(window.prevDays[0]).toBe("2026-08-01");
    expect(new Date(compareCutoff(window, NOW)).toISOString()).toBe("2026-08-25T17:00:00.000Z");

    // 31/10 contra setembro, que tem 30 dias: o corte nao passa do fim do mes anterior.
    const late = resolvePeriodWindow("month", Date.parse("2026-10-31T20:00:00Z"), TZ);
    expect(compareCutoff(late, Date.parse("2026-10-31T20:00:00Z"))).toBe(late.prevEnd);
  });
});

describe("saleAt e sliceSales", () => {
  it("data a venda pelo fechamento, com a criacao so para a pesagem antiga", () => {
    expect(saleAt(op({ closed_at: "2026-09-25T10:00:00Z" }))).toBe(
      Date.parse("2026-09-25T10:00:00Z")
    );
    expect(saleAt(op({ closed_at: null, created_at: "2026-09-20T10:00:00Z" }))).toBe(
      Date.parse("2026-09-20T10:00:00Z")
    );
    expect(saleAt(op({ closed_at: null, created_at: "" }))).toBeNull();
  });

  it("separa periodo e anterior, tira cancelada e aberta e ordena a mais nova primeiro", () => {
    const window = resolvePeriodWindow("today", NOW, TZ);
    // Entrou ontem, fechou hoje: e venda de HOJE (a data que sobe ao OMIE).
    const crossedMidnight = op({
      created_at: "2026-09-25T02:00:00Z",
      closed_at: "2026-09-25T11:00:00Z"
    });
    const latest = op({ closed_at: "2026-09-25T16:00:00Z" });
    const cancelled = op({ status: "cancelled", closed_at: "2026-09-25T15:00:00Z" });
    const open = op({ status: "open", closed_at: null });
    const yesterdayMorning = op({ closed_at: "2026-09-24T12:00:00Z" });
    const yesterdayNight = op({ closed_at: "2026-09-24T22:00:00Z" });
    const legacy = op({ closed_at: null, created_at: "2026-09-25T13:00:00Z" });
    const slices = sliceSales(
      [crossedMidnight, latest, cancelled, open, yesterdayMorning, yesterdayNight, legacy, latest],
      window,
      NOW,
      filters()
    );
    expect(slices.current.map((row) => row.id)).toEqual([latest.id, legacy.id, crossedMidnight.id]);
    expect(slices.previous.map((row) => row.id)).toEqual([yesterdayMorning.id, yesterdayNight.id]);
    // Ontem ate as 14h: a venda das 19h de ontem fica fora da comparacao.
    expect(slices.previousToDate.map((row) => row.id)).toEqual([yesterdayMorning.id]);
  });

  it("aplica produto, cliente (sem acento) e forma de pagamento", () => {
    const window = resolvePeriodWindow("today", NOW, TZ);
    const a = op({ customer_name: "Pavimentação São João", payment_method_id: "pm-boleto" });
    const b = op({ product_id: "prod-2", product_description: "Pedrisco" });
    const c = op({ payment_method_id: null });
    const all = [a, b, c];
    const ids = (f: MonitorFilters) =>
      sliceSales(all, window, NOW, f)
        .current.map((row) => row.id)
        .sort();
    expect(ids(filters({ customer: "sao joao" }))).toEqual([a.id]);
    expect(ids(filters({ products: [{ key: "prod-2", label: "Pedrisco" }] }))).toEqual([b.id]);
    expect(ids(filters({ payments: [NO_PAYMENT_KEY] }))).toEqual([c.id]);
    expect(ids(filters({ payments: ["pm-pix", "pm-boleto"] }))).toEqual([a.id, b.id].sort());
    expect(matchesFilters(a, filters({ customer: "  PAVIMENTACAO   sao " }))).toBe(true);
  });
});

describe("chaves e nomes", () => {
  it("agrupa pelo cadastro e cai no nome quando a pesagem nao tem cadastro", () => {
    expect(productKeyOf(op())).toBe("prod-1");
    expect(productKeyOf(op({ product_id: null, product_description: " Pó de Pedra " }))).toBe(
      "nome:po de pedra"
    );
    expect(productLabelOf(op({ product_description: "  " }))).toBe("Sem produto");
    expect(customerKeyOf(op({ customer_id: null, customer_name: "ACME" }))).toBe("nome:acme");
    expect(customerLabelOf(op({ customer_name: null }))).toBe("Sem cliente");
    expect(normalizeText("  Ação   É  ")).toBe("acao e");
  });
});

describe("indicadores", () => {
  it("soma toneladas, faturamento, frete e o preco do material por tonelada", () => {
    const window = resolvePeriodWindow("today", NOW, TZ);
    const slices = sliceSales(
      [
        op({
          net_weight_kg: 20_000,
          product_total_cents: 200_000,
          freight_total_cents: 50_000,
          total_cents: 250_000,
          created_at: "2026-09-25T12:00:00Z",
          closed_at: "2026-09-25T12:30:00Z"
        }),
        op({
          net_weight_kg: 10_000,
          product_total_cents: 100_000,
          freight_total_cents: 0,
          total_cents: 100_000,
          created_at: "2026-09-25T13:00:00Z",
          closed_at: "2026-09-25T14:30:00Z"
        }),
        op({
          net_weight_kg: 15_000,
          product_total_cents: 120_000,
          freight_total_cents: 0,
          total_cents: 120_000,
          closed_at: "2026-09-24T12:00:00Z"
        })
      ],
      window,
      NOW,
      filters()
    );
    const kpis = computeKpis(slices, []);
    expect(kpis.current.loads).toBe(2);
    expect(kpis.current.kg).toBe(30_000);
    expect(kpis.current.totalCents).toBe(350_000);
    expect(kpis.current.freightCents).toBe(50_000);
    expect(kpis.freightShare).toBeCloseTo(50_000 / 350_000);
    // Preco medio e so o MATERIAL: R$ 3.000 / 30 t = R$ 100/t.
    expect(kpis.current.pricePerTonCents).toBe(10_000);
    expect(kpis.current.avgYardMinutes).toBe(60);
    expect(kpis.previous.kg).toBe(15_000);
    expect(kpis.deltas.kg).toBeCloseTo(1);
    expect(kpis.deltas.loads).toBeCloseTo(1);
    expect(kpis.deltas.pricePerTon).toBeCloseTo(10_000 / 8_000 - 1);
    expect(kpis.yardNow).toBe(0);
  });

  it("sem venda nao inventa preco nem variacao", () => {
    const kpis = computeKpis({ current: [], previous: [], previousToDate: [] }, []);
    expect(kpis.current.pricePerTonCents).toBeNull();
    expect(kpis.current.avgYardMinutes).toBeNull();
    expect(kpis.freightShare).toBeNull();
    expect(kpis.deltas.kg).toBeNull();
  });

  it("tempo no patio ignora saida antes da entrada e horario invalido", () => {
    expect(
      averageYardMinutes([
        { created_at: "2026-09-25T12:00:00Z", closed_at: "2026-09-25T12:30:00Z" },
        { created_at: "2026-09-25T12:00:00Z", closed_at: "2026-09-25T11:00:00Z" },
        { created_at: "2026-09-25T12:00:00Z", closed_at: null },
        { created_at: "x", closed_at: "2026-09-25T12:30:00Z" }
      ])
    ).toBe(30);
  });

  it("variacao relativa e a cor dela", () => {
    expect(relativeDelta(120, 100)).toBeCloseTo(0.2);
    expect(relativeDelta(10, 0)).toBeNull();
    expect(relativeDelta(null, 10)).toBeNull();
    expect(relativeDelta(10, Number.NaN)).toBeNull();
    expect(deltaTone(0.2)).toBe("good");
    expect(deltaTone(-0.2)).toBe("bad");
    expect(deltaTone(0.2, false)).toBe("bad");
    expect(deltaTone(-0.2, false)).toBe("good");
    expect(deltaTone(0.001)).toBe("flat");
    expect(deltaTone(null)).toBe("none");
  });
});

describe("salesSeries", () => {
  it("por hora: 06h-18h no minimo, hora futura vazia e ontem inteiro na comparacao", () => {
    const window = resolvePeriodWindow("today", NOW, TZ);
    const slices = sliceSales(
      [
        op({ closed_at: "2026-09-25T08:10:00Z", net_weight_kg: 5_000 }), // 05h10
        op({ closed_at: "2026-09-25T12:10:00Z", net_weight_kg: 7_000 }), // 09h10
        op({ closed_at: "2026-09-25T12:50:00Z", net_weight_kg: 3_000 }), // 09h50
        op({ closed_at: "2026-09-24T22:00:00Z", net_weight_kg: 9_000 }) // ontem 19h
      ],
      window,
      NOW,
      filters()
    );
    const series = salesSeries(slices, window, NOW, TZ);
    expect(series.granularity).toBe("hour");
    const labels = series.buckets.map((bucket) => bucket.label);
    expect(labels[0]).toBe("05h");
    expect(labels[labels.length - 1]).toBe("19h");
    const at = (label: string) => series.buckets.find((bucket) => bucket.label === label);
    expect(at("09h")?.current).toEqual({ loads: 2, kg: 10_000, cents: 200_000 });
    expect(at("05h")?.current?.kg).toBe(5_000);
    expect(at("12h")?.current).toEqual({ loads: 0, kg: 0, cents: 0 });
    expect(at("14h")?.isNow).toBe(true);
    expect(at("15h")?.current).toBeNull();
    expect(at("19h")?.previous?.kg).toBe(9_000);
  });

  it("por dia: alinha o periodo anterior pela posicao e deixa o dia futuro vazio", () => {
    const window = resolvePeriodWindow("month", NOW, TZ);
    const slices = sliceSales(
      [
        op({ closed_at: "2026-09-01T12:00:00Z", net_weight_kg: 1_000 }),
        op({ closed_at: "2026-09-26T01:00:00Z", net_weight_kg: 2_000 }), // 25/09 22h local
        op({ closed_at: "2026-08-01T12:00:00Z", net_weight_kg: 4_000 })
      ],
      window,
      NOW,
      filters()
    );
    const series = salesSeries(slices, window, NOW, TZ);
    expect(series.granularity).toBe("day");
    expect(series.buckets).toHaveLength(30);
    expect(series.buckets[0].label).toBe("01/09");
    expect(series.buckets[0].current?.kg).toBe(1_000);
    expect(series.buckets[0].previous?.kg).toBe(4_000);
    expect(series.buckets[0].previousTitle).toBe("01/08/2026");
    expect(series.buckets[24].isNow).toBe(true);
    expect(series.buckets[24].current?.kg).toBe(2_000);
    expect(series.buckets[25].current).toBeNull();
  });

  it("periodo fechado nao tem hora futura", () => {
    const window = resolvePeriodWindow("yesterday", NOW, TZ);
    const series = salesSeries({ current: [], previous: [] }, window, NOW, TZ);
    expect(series.buckets.every((bucket) => bucket.current !== null)).toBe(true);
    expect(series.buckets.some((bucket) => bucket.isNow)).toBe(false);
  });
});

describe("rankBy", () => {
  it("ordena pela medida, desempata pelo nome e soma a cauda em Outros", () => {
    const rows = [
      op({ product_id: "a", product_description: "Areia", net_weight_kg: 5_000, total_cents: 1 }),
      op({ product_id: "b", product_description: "Brita 0", net_weight_kg: 5_000, total_cents: 9 }),
      op({ product_id: "c", product_description: "Brita 1", net_weight_kg: 9_000, total_cents: 5 }),
      op({
        product_id: "d",
        product_description: "Pedrisco",
        net_weight_kg: 1_000,
        total_cents: 2
      }),
      op({ product_id: "e", product_description: "Po", net_weight_kg: 500, total_cents: 3 })
    ];
    const byTons = rankBy(rows, productKeyOf, productLabelOf, "tons", 3);
    expect(byTons.map((row) => row.label)).toEqual(["Brita 1", "Areia", "Brita 0", "Outros (2)"]);
    expect(byTons[3]).toMatchObject({ key: OTHER_KEY, kg: 1_500, loads: 2, other: true });
    expect(byTons[0].share).toBeCloseTo(9_000 / 20_500);

    const byRevenue = rankBy(rows, productKeyOf, productLabelOf, "revenue", 3);
    expect(byRevenue[0].label).toBe("Brita 0");
  });

  it("sobrando uma so, ela aparece com o proprio nome", () => {
    const rows = [
      op({ product_id: "a", product_description: "Areia", net_weight_kg: 5_000 }),
      op({ product_id: "b", product_description: "Brita", net_weight_kg: 4_000 }),
      op({ product_id: "c", product_description: "Po", net_weight_kg: 1_000 })
    ];
    expect(rankBy(rows, productKeyOf, productLabelOf, "tons", 2).map((row) => row.label)).toEqual([
      "Areia",
      "Brita",
      "Po"
    ]);
    expect(rankBy([], productKeyOf, productLabelOf, "tons", 8)).toEqual([]);
  });
});

describe("paymentBreakdown", () => {
  const methods = [
    { id: "pm-dinheiro", name: "Dinheiro" },
    { id: "pm-pix", name: "PIX" },
    { id: "pm-boleto", name: "Boleto" }
  ];

  it("a cor segue a forma (ordem do cadastro), nao o ranking", () => {
    const segments = paymentBreakdown(
      [
        op({ payment_method_id: "pm-boleto", net_weight_kg: 30_000 }),
        op({ payment_method_id: "pm-pix", net_weight_kg: 10_000 }),
        op({ payment_method_id: null, net_weight_kg: 5_000 }),
        op({ payment_method_id: "pm-desconhecida", net_weight_kg: 5_000 })
      ],
      methods,
      "tons"
    );
    expect(segments.map((segment) => [segment.label, segment.slot])).toEqual([
      ["PIX", 1],
      ["Boleto", 2],
      ["Outras", null]
    ]);
    expect(segments[1].share).toBeCloseTo(0.6);
    expect(segments[2]).toMatchObject({ key: OTHER_KEY, kg: 10_000, loads: 2 });

    // Sem o boleto no recorte, o PIX continua com a MESMA cor.
    const onlyPix = paymentBreakdown([op({ payment_method_id: "pm-pix" })], methods, "tons");
    expect(onlyPix[0].slot).toBe(1);
  });

  it("forma alem dos slots de cor soma em Outras", () => {
    const many = Array.from({ length: PAYMENT_SLOTS + 2 }, (_, index) => ({
      id: `pm-${index}`,
      name: `Forma ${index}`
    }));
    const segments = paymentBreakdown(
      [op({ payment_method_id: `pm-${PAYMENT_SLOTS + 1}` }), op({ payment_method_id: "pm-0" })],
      many,
      "revenue"
    );
    expect(segments.map((segment) => segment.slot)).toEqual([0, null]);
  });
});

describe("patio", () => {
  it("usa a media da unidade, depois a do periodo, depois 45/90 min", () => {
    expect(yardThresholds(40, 70)).toEqual({ attention: 40, late: 80, basis: "unit" });
    expect(yardThresholds(null, 52.4)).toEqual({ attention: 52, late: 104, basis: "period" });
    expect(yardThresholds(0, null)).toEqual({
      attention: DEFAULT_YARD_ATTENTION_MIN,
      late: DEFAULT_YARD_LATE_MIN,
      basis: "default"
    });
    expect(yardThresholds(3, null).attention).toBe(10);
    expect(yardThresholds(900, null).attention).toBe(240);
  });

  it("classifica pelo tempo desde a entrada, o mais antigo primeiro", () => {
    const thresholds = yardThresholds(null, null);
    expect(yardLevel(44, thresholds)).toBe("normal");
    expect(yardLevel(45, thresholds)).toBe("attention");
    expect(yardLevel(90, thresholds)).toBe("late");

    const fresh = op({ status: "open", closed_at: null, created_at: "2026-09-25T16:50:00Z" });
    const waiting = op({ status: "open", closed_at: null, created_at: "2026-09-25T16:00:00Z" });
    const late = op({ status: "open", closed_at: null, created_at: "2026-09-25T15:00:00Z" });
    const closed = op({ status: "synced" });
    const yard = buildYard([fresh, waiting, late, closed, fresh], filters(), NOW, thresholds);
    expect(yard.map((ticket) => [ticket.operation.id, ticket.level])).toEqual([
      [late.id, "late"],
      [waiting.id, "attention"],
      [fresh.id, "normal"]
    ]);
    expect(yard[0].minutes).toBe(120);
    expect(yard[0].progress).toBe(1);
    expect(yard[2].progress).toBeCloseTo(10 / 90);

    const kpis = computeKpis({ current: [], previous: [], previousToDate: [] }, yard);
    expect([kpis.yardNow, kpis.yardAttention, kpis.yardLate]).toEqual([3, 1, 1]);

    expect(
      buildYard([fresh, waiting], filters({ customer: "ninguem" }), NOW, thresholds)
    ).toHaveLength(0);
  });
});

describe("tempo real", () => {
  it("nada e novo na primeira leitura; depois, so o id que nao estava", () => {
    expect(detectNewIds(null, ["a", "b"]).size).toBe(0);
    expect([...detectNewIds(new Set(["a"]), ["a", "b", "c"])]).toEqual(["b", "c"]);
    expect(detectNewIds(new Set(["a", "b"]), ["b"]).size).toBe(0);
  });

  it("Ao vivo vira aviso sem internet ou com a ultima leitura boa passando de 2 min", () => {
    expect(liveState({ lastSuccessAt: null, now: NOW, online: true })).toBe("connecting");
    expect(liveState({ lastSuccessAt: NOW - 30_000, now: NOW, online: true })).toBe("live");
    expect(liveState({ lastSuccessAt: NOW - 121_000, now: NOW, online: true })).toBe("stale");
    expect(liveState({ lastSuccessAt: NOW, now: NOW, online: false })).toBe("offline");
  });

  it("escreve ha quanto tempo foi a ultima leitura", () => {
    expect(formatAgo(2_000)).toBe("agora");
    expect(formatAgo(12_400)).toBe("ha 12 s");
    expect(formatAgo(185_000)).toBe("ha 3 min");
    expect(formatAgo(2 * 3_600_000 + 5)).toBe("ha 2 h");
    expect(formatAgo(-5_000)).toBe("agora");
  });
});

describe("filtros guardados", () => {
  it("usa a chave versionada", () => {
    expect(MONITOR_FILTERS_STORAGE_KEY).toBe("kr-monitor-filters-v1");
  });

  it("ida e volta sem perder nada", () => {
    const original = filters({
      period: "7d",
      unitId: "unit-2",
      products: [{ key: "prod-1", label: "Brita 1" }],
      customer: "silva",
      payments: ["pm-pix", NO_PAYMENT_KEY],
      metric: "revenue",
      widgets: { ...defaultMonitorFilters().widgets, yard: false }
    });
    expect(parseMonitorFilters(serializeMonitorFilters(original))).toEqual(original);
  });

  it("dado ruim ou ausente volta ao padrao, campo a campo", () => {
    const defaults = defaultMonitorFilters();
    expect(parseMonitorFilters(null)).toEqual(defaults);
    expect(parseMonitorFilters("")).toEqual(defaults);
    expect(parseMonitorFilters("{nao e json")).toEqual(defaults);
    expect(parseMonitorFilters("[1,2]")).toEqual(defaults);
    expect(parseMonitorFilters('"hoje"')).toEqual(defaults);

    const parsed = parseMonitorFilters(
      JSON.stringify({
        period: "ano",
        unitId: 42,
        products: [
          { key: "p1", label: "Brita" },
          { key: "p1", label: "Repetido" },
          { key: "", label: "Sem chave" },
          "lixo",
          { key: "p2" }
        ],
        customer: 7,
        payments: ["pm-pix", "pm-pix", 3, "  "],
        metric: "kg",
        widgets: { feed: false, yard: "nao", inventado: false }
      })
    );
    expect(parsed.period).toBe("today");
    expect(parsed.unitId).toBeNull();
    expect(parsed.products).toEqual([{ key: "p1", label: "Brita" }]);
    expect(parsed.customer).toBe("");
    expect(parsed.payments).toEqual(["pm-pix"]);
    expect(parsed.metric).toBe("tons");
    expect(parsed.widgets).toEqual({ ...defaults.widgets, feed: false });
  });

  it("limita o tamanho das listas guardadas", () => {
    const parsed = parseMonitorFilters(
      JSON.stringify({ payments: Array.from({ length: 80 }, (_, index) => `pm-${index}`) })
    );
    expect(parsed.payments).toHaveLength(50);
  });
});

describe("etiquetas de filtro", () => {
  const context = {
    defaultUnitId: "unit-1",
    unitName: (id: string) => (id === "unit-2" ? "Filial" : null),
    paymentName: (key: string) => (key === "pm-pix" ? "PIX" : null)
  };

  it("lista os recortes ligados e remove um por um", () => {
    const current = filters({
      unitId: "unit-2",
      products: [{ key: "prod-1", label: "Brita 1" }],
      customer: " silva ",
      payments: ["pm-pix", NO_PAYMENT_KEY]
    });
    const chips = activeFilterChips(current, context);
    expect(chips.map((chip) => chip.label)).toEqual([
      "Filial",
      "Brita 1",
      "Cliente: silva",
      "PIX",
      "Sem forma de pagamento"
    ]);
    expect(countActiveFilters(current, "unit-1")).toBe(5);
    expect(removeFilterChip(current, chips[0]).unitId).toBeNull();
    expect(removeFilterChip(current, chips[1]).products).toEqual([]);
    expect(removeFilterChip(current, chips[2]).customer).toBe("");
    expect(removeFilterChip(current, chips[3]).payments).toEqual([NO_PAYMENT_KEY]);

    const cleared = clearDimensionFilters({ ...current, period: "30d", metric: "revenue" });
    expect(cleared).toMatchObject({ period: "30d", metric: "revenue", unitId: null });
    expect(activeFilterChips(cleared, context)).toEqual([]);
  });

  it("a unidade do proprio usuario nao vira etiqueta", () => {
    expect(activeFilterChips(filters({ unitId: "unit-1" }), context)).toEqual([]);
    expect(countActiveFilters(filters({ unitId: "unit-1", customer: "  " }), "unit-1")).toBe(0);
  });

  it("liga e desliga item de lista", () => {
    const same = (a: string, b: string) => a === b;
    expect(toggleValue(["a"], "b", same)).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a", same)).toEqual(["b"]);
  });
});

describe("unidade e opcoes", () => {
  it("volta para a unidade do usuario quando a escolhida nao existe mais", () => {
    const units = [{ id: "unit-1" }, { id: "unit-2" }];
    expect(resolveUnitId(null, units, "unit-1")).toBe("unit-1");
    expect(resolveUnitId("unit-2", units, "unit-1")).toBe("unit-2");
    expect(resolveUnitId("sumiu", units, "unit-1")).toBe("unit-1");
    // Antes de a lista de unidades chegar, confia na escolha guardada.
    expect(resolveUnitId("unit-2", [], "unit-1")).toBe("unit-2");
  });

  it("opcoes de produto e de forma de pagamento vem dos dados e mantem as escolhidas", () => {
    const rows = [
      op({ product_id: "p2", product_description: "Pedrisco", payment_method_id: null }),
      op({ product_id: "p1", product_description: "Areia", payment_method_id: "pm-pix" }),
      op({ product_id: "p1", product_description: "Areia" })
    ];
    expect(productOptions(rows, [{ key: "p9", label: "Brita 3" }])).toEqual([
      { key: "p1", label: "Areia" },
      { key: "p9", label: "Brita 3" },
      { key: "p2", label: "Pedrisco" }
    ]);
    expect(
      paymentOptions(
        rows,
        [
          { id: "pm-boleto", name: "Boleto" },
          { id: "pm-pix", name: "PIX" }
        ],
        ["pm-velha"]
      )
    ).toEqual([
      { key: "pm-pix", label: "PIX" },
      { key: NO_PAYMENT_KEY, label: "Sem forma de pagamento" },
      { key: "pm-velha", label: "Forma removida" }
    ]);
  });
});

describe("formatacao", () => {
  const plain = (text: string) => text.replace(/\s/g, " ");

  it("duracao, variacao, participacao e toneladas", () => {
    expect(formatDuration(12.7)).toBe("12 min");
    expect(formatDuration(65)).toBe("1h05");
    expect(formatDuration(null)).toBe("--");
    expect(formatDelta(0.123)).toBe("+12%");
    expect(formatDelta(-0.034)).toBe("-3,4%");
    expect(formatDelta(0.0001)).toBe("0%");
    expect(formatShare(0.456)).toBe("46%");
    expect(formatShare(0.004)).toBe("<1%");
    expect(formatShare(0)).toBe("0%");
    expect(formatTonnes(1_234_567)).toBe("1.234,6 t");
  });

  it("dinheiro inteiro e curto", () => {
    expect(plain(formatMoneyWhole(6_097_118))).toBe("R$ 60.971");
    expect(plain(formatMoneyShort(95_000))).toBe("R$ 950");
    expect(plain(formatMoneyShort(1_234_500))).toBe("R$ 12,3 mil");
    expect(plain(formatMoneyShort(125_000_000))).toBe("R$ 1,25 mi");
  });
});

describe("eixo dos graficos", () => {
  it("marca numeros redondos de 0 ate cobrir o maximo", () => {
    expect(chartTicks(199_000)).toEqual([0, 50_000, 100_000, 150_000, 200_000]);
    expect(chartTicks(260_000)).toEqual([0, 100_000, 200_000, 300_000]);
    expect(chartTicks(9_000)).toEqual([0, 2_500, 5_000, 7_500, 10_000]);
    expect(chartTicks(100)).toEqual([0, 25, 50, 75, 100]);
    expect(chartTicks(0)).toEqual([0]);
    expect(chartTicks(Number.NaN)).toEqual([0]);
  });

  it("usa a mesma unidade em todas as marcas de dinheiro", () => {
    const plain = (text: string) => text.replace(/\s/g, " ");
    expect(plain(formatAxisValue(500_000, 2_000_000, "revenue"))).toBe("R$ 5 mil");
    expect(plain(formatAxisValue(2_000_000, 2_000_000, "revenue"))).toBe("R$ 20 mil");
    expect(plain(formatAxisValue(250_000, 500_000, "revenue"))).toBe("R$ 2.500");
    expect(formatAxisValue(2_500, 10_000, "tons")).toBe("2,5 t");
    expect(formatAxisValue(150_000, 200_000, "tons")).toBe("150 t");
  });
});

describe("painel sem rolagem", () => {
  it("conta quantos itens cabem, com o espaco entre eles e folga de meio pixel", () => {
    expect(fitCapacity(300, 60, 0)).toBe(5);
    // 4 itens de 70 + 3 espacos de 8 = 304: cabem 4 em 304, e 303,6 (medida quebrada) tambem.
    expect(fitCapacity(304, 70, 8)).toBe(4);
    expect(fitCapacity(303.6, 70, 8)).toBe(4);
    expect(fitCapacity(303, 70, 8)).toBe(3);
    expect(fitCapacity(50, 60, 8)).toBe(0);
    expect(fitCapacity(0, 60)).toBe(0);
    expect(fitCapacity(300, 0)).toBe(0);
    expect(fitCapacity(Number.NaN, 60)).toBe(0);
  });

  it("mostra todos quando cabem e reserva o rodape +N quando nao cabem", () => {
    // Cabem 5 de 60 em 300: com 5 no total, nao precisa de rodape.
    expect(fitCount({ available: 300, itemSize: 60, total: 5, footer: 30, fallback: 3 })).toBe(5);
    expect(fitCount({ available: 300, itemSize: 60, total: 2, footer: 30, fallback: 3 })).toBe(2);
    // Com 40, o rodape come 30 px e sobram 4.
    expect(fitCount({ available: 300, itemSize: 60, total: 40, footer: 30, fallback: 3 })).toBe(4);
    expect(
      fitCount({ available: 304, itemSize: 70, gap: 8, total: 12, footer: 28, fallback: 3 })
    ).toBe(3);
  });

  it("sem medida usa o padrao; lista vazia e zero; nunca menos que o minimo", () => {
    expect(fitCount({ available: 0, itemSize: 0, total: 40, fallback: 6 })).toBe(6);
    expect(fitCount({ available: 500, itemSize: 0, total: 3, fallback: 6 })).toBe(3);
    expect(fitCount({ available: 500, itemSize: 60, total: 0, fallback: 6 })).toBe(0);
    expect(fitCount({ available: 40, itemSize: 60, total: 9, footer: 20, fallback: 6 })).toBe(1);
    expect(
      fitCount({ available: 40, itemSize: 60, total: 9, footer: 20, fallback: 6, min: 0 })
    ).toBe(0);
  });

  it("separa os visiveis e conta quantos ficaram de fora", () => {
    expect(splitVisible([1, 2, 3, 4, 5, 6, 7], MONITOR_PHONE_ITEMS)).toEqual({
      visible: [1, 2, 3, 4, 5],
      hidden: 2
    });
    expect(splitVisible([1, 2], 5)).toEqual({ visible: [1, 2], hidden: 0 });
    expect(splitVisible([1, 2], -1)).toEqual({ visible: [], hidden: 2 });
  });

  it("o ranking cabe no painel com a linha Outros contando como uma", () => {
    expect(rankLimitFor(5)).toBe(4);
    expect(rankLimitFor(1)).toBe(1);
    expect(rankLimitFor(0)).toBe(1);
    const sales = ["A", "B", "C", "D", "E", "F", "G"].map((name, index) =>
      op({ customer_id: `c-${name}`, customer_name: name, net_weight_kg: (10 - index) * 1000 })
    );
    const rows = rankBy(sales, customerKeyOf, customerLabelOf, "tons", rankLimitFor(5));
    expect(rows).toHaveLength(5);
    expect(rows[4]).toMatchObject({ other: true, label: "Outros (3)" });
    // Cabendo todos, nenhum vira "Outros".
    expect(rankBy(sales, customerKeyOf, customerLabelOf, "tons", rankLimitFor(7))).toHaveLength(7);
    expect(
      rankBy(sales, customerKeyOf, customerLabelOf, "tons", rankLimitFor(7)).some((r) => r.other)
    ).toBe(false);
  });
});
