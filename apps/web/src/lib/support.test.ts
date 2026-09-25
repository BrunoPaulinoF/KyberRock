import { describe, expect, it } from "vitest";

import type { ErrorLogEntry } from "./error-log";
import {
  buildSupportReport,
  checkDevice,
  compareVersions,
  countOmieReasons,
  dispatchIsProblem,
  dispatchStatusView,
  executionTime,
  filterRequests,
  formatAgo,
  formatClock,
  formatDay,
  formatSpan,
  formatStamp,
  groupPasswordFailures,
  isOutdated,
  latestVersion,
  normalizeSupportOverview,
  omieReason,
  parseSupportTab,
  passwordSeverity,
  requestStatusView,
  roleLabel,
  sortBillingRequests,
  sortDevices,
  sortOmieProblems,
  sortWebUsers,
  summarizeSupport,
  tabBadges,
  type SupportBillingRequest,
  type SupportDevice,
  type SupportDiagnostics,
  type SupportOmieProblem,
  type SupportOperationRequest,
  type SupportOverview
} from "./support";

/** 25/09/2026 12:00 em Brasilia. */
const NOW = Date.parse("2026-09-25T15:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function device(overrides: Partial<SupportDevice> = {}): SupportDevice {
  return {
    id: "dev-1",
    name: "PC BALANCA 1",
    unitId: "unit-1",
    isActive: true,
    deviceNumber: 1,
    appVersion: "1.4.10",
    updateChannel: "producao",
    lastSeenAt: minutesAgo(1),
    online: true,
    isPriceMaster: false,
    executesWebOperations: false,
    webExecutorSeenAt: null,
    health: {
      queuePending: 0,
      queueBlocked: 0,
      oldestPendingAt: null,
      lastError: null,
      collectedAt: minutesAgo(2)
    },
    ...overrides
  };
}

function request(overrides: Partial<SupportOperationRequest> = {}): SupportOperationRequest {
  return {
    id: "req-1",
    kind: "entry",
    status: "done",
    operationId: "op-1111-2222",
    unitId: "unit-1",
    requestedAt: minutesAgo(30),
    requestedByName: "Maria",
    claimedByDeviceId: "dev-1",
    claimedAt: minutesAgo(30),
    processedAt: minutesAgo(29),
    resultMessage: null,
    printStatus: null,
    printMessage: null,
    ...overrides
  };
}

function omie(overrides: Partial<SupportOmieProblem> = {}): SupportOmieProblem {
  return {
    id: "op-1",
    unitId: "unit-1",
    plate: "ABC1D23",
    customerName: "Construtora Alfa",
    productDescription: "Brita 1",
    status: "closed_local",
    createdAt: minutesAgo(300),
    closedAt: minutesAgo(240),
    totalCents: 123456,
    omieBillingStatus: null,
    omieBillingMessage: null,
    omieSalesOrderId: null,
    ...overrides
  };
}

function overview(overrides: Partial<SupportOverview> = {}): SupportOverview {
  return {
    generatedAt: minutesAgo(0),
    units: [{ id: "unit-1", name: "Pedreira Centro" }],
    devices: [device()],
    latestAppVersion: "1.4.10",
    operationRequests: [],
    billingRequests: [],
    omieProblems: [],
    reportDispatches: [],
    pricePasswordFailures: [],
    webUsers: [],
    ...overrides
  };
}

const diagnostics: SupportDiagnostics = {
  build: "production · versao 2.3.0",
  userName: "Suporte Kybernan",
  role: "administrador",
  companyId: "company-1",
  unitId: "unit-1",
  userAgent: "Mozilla/5.0 Teste",
  online: true,
  timeZone: "America/Sao_Paulo",
  screen: "1440x900"
};

describe("relogio", () => {
  it("formata no fuso da pedreira, nao no do navegador", () => {
    expect(formatStamp("2026-09-25T17:32:00.000Z")).toBe("25/09 14:32");
    expect(formatStamp("2026-09-26T02:10:00.000Z", true)).toBe("25/09/2026 23:10");
    expect(formatClock("2026-09-25T17:32:00.000Z")).toBe("14:32");
    expect(formatStamp(null)).toBe("—");
    expect(formatStamp("lixo")).toBe("—");
    expect(formatDay("2026-09-24")).toBe("24/09/2026");
  });

  it("escreve duracoes curtas", () => {
    expect(formatSpan(400)).toBe("menos de 1 s");
    expect(formatSpan(8_000)).toBe("8 s");
    expect(formatSpan(72_000)).toBe("1 min 12 s");
    expect(formatSpan(12 * 60_000)).toBe("12 min");
    expect(formatSpan(125 * 60_000)).toBe("2 h 05 min");
    expect(formatSpan(3 * 60 * 60_000)).toBe("3 h");
    expect(formatSpan((3 * 24 + 4) * 60 * 60_000)).toBe("3 d 4 h");
  });

  it("diz ha quanto tempo, e denuncia relogio adiantado", () => {
    expect(formatAgo(minutesAgo(0.5), NOW)).toBe("agora");
    expect(formatAgo(minutesAgo(3), NOW)).toBe("ha 3 min");
    expect(formatAgo(minutesAgo(3.5), NOW)).toBe("ha 3 min");
    expect(formatAgo(minutesAgo(125), NOW)).toBe("ha 2 h 05 min");
    expect(formatAgo(minutesAgo(26 * 60), NOW)).toBe("ha 1 d 2 h");
    expect(formatAgo(minutesAgo(-10), NOW)).toBe("daqui a 10 min");
    expect(formatAgo(null, NOW)).toBe("—");
  });
});

describe("versoes", () => {
  it("compara numero a numero", () => {
    expect(compareVersions("1.4.9", "1.4.10")).toBe(-1);
    expect(compareVersions("v1.5.0", "1.4.99")).toBe(1);
    expect(compareVersions("1.4", "1.4.0")).toBe(0);
    expect(latestVersion(["1.4.9", null, "1.4.10", "1.3.20"])).toBe("1.4.10");
    expect(latestVersion([null, ""])).toBeNull();
  });

  it("so e desatualizada com as duas versoes conhecidas", () => {
    expect(isOutdated("1.4.9", "1.4.10")).toBe(true);
    expect(isOutdated("1.4.10", "1.4.10")).toBe(false);
    expect(isOutdated(null, "1.4.10")).toBe(false);
    expect(isOutdated("1.4.9", null)).toBe(false);
  });
});

describe("normalizeSupportOverview", () => {
  it("garante as listas e a saude mesmo com resposta incompleta", () => {
    const result = normalizeSupportOverview(
      {
        ok: true,
        warnings: [],
        devices: [
          { ...device({ appVersion: "1.4.2" }), health: undefined },
          { ...device({ id: "dev-2", appVersion: "1.5.0", isActive: false }) },
          "linha estranha"
        ]
      },
      NOW
    );
    expect(result.generatedAt).toBe(new Date(NOW).toISOString());
    expect(result.devices).toHaveLength(2);
    expect(result.devices[0].health).toEqual({
      queuePending: null,
      queueBlocked: null,
      oldestPendingAt: null,
      lastError: null,
      collectedAt: null
    });
    // Sem `latestAppVersion` da nuvem: a mais nova entre as ATIVAS.
    expect(result.latestAppVersion).toBe("1.4.2");
    expect(result.operationRequests).toEqual([]);
    expect(result.webUsers).toEqual([]);
    expect(normalizeSupportOverview(null, NOW).devices).toEqual([]);
  });
});

describe("abas", () => {
  it("le o ?aba= e cai em Balancas quando nao reconhece", () => {
    expect(parseSupportTab("omie")).toBe("omie");
    expect(parseSupportTab("navegador")).toBe("navegador");
    expect(parseSupportTab("qualquer")).toBe("balancas");
    expect(parseSupportTab(null)).toBe("balancas");
  });
});

describe("balancas", () => {
  it("classifica offline, parada, antiga e desatualizada", () => {
    expect(checkDevice(device(), "1.4.10", NOW).severity).toBe("ok");
    expect(checkDevice(device({ online: false }), "1.4.10", NOW)).toMatchObject({
      offline: true,
      severity: "danger"
    });
    expect(
      checkDevice(device({ health: { ...device().health, queueBlocked: 2 } }), "1.4.10", NOW)
    ).toMatchObject({ blocked: true, severity: "danger" });
    expect(
      checkDevice(
        device({ health: { ...device().health, oldestPendingAt: minutesAgo(45) } }),
        "1.4.10",
        NOW
      )
    ).toMatchObject({ oldQueue: true, severity: "warning" });
    expect(checkDevice(device({ appVersion: "1.4.2" }), "1.4.10", NOW)).toMatchObject({
      outdated: true,
      severity: "warning"
    });
    expect(
      checkDevice(
        device({ health: { ...device().health, collectedAt: minutesAgo(90) } }),
        null,
        NOW
      ).staleHealth
    ).toBe(true);
  });

  it("balanca inativa nao conta como problema", () => {
    expect(checkDevice(device({ isActive: false, online: false }), "2.0.0", NOW)).toMatchObject({
      offline: false,
      outdated: false,
      severity: "ok"
    });
  });

  it("ordena problema primeiro e inativa por ultimo", () => {
    const sorted = sortDevices(
      [
        device({ id: "a", name: "A inativa", isActive: false, online: false }),
        device({ id: "b", name: "B ok" }),
        device({ id: "c", name: "C velha", appVersion: "1.0.0" }),
        device({ id: "d", name: "D offline", online: false })
      ],
      "1.4.10",
      NOW
    );
    expect(sorted.map((item) => item.id)).toEqual(["d", "c", "b", "a"]);
  });
});

describe("pedidos do site", () => {
  const devices = new Map([["dev-1", "PC BALANCA 1"]]);
  const list = [
    request({ id: "ok" }),
    request({ id: "falhou", status: "failed", resultMessage: "Cliente sem documento" }),
    request({ id: "parado", status: "pending", requestedAt: minutesAgo(8), processedAt: null }),
    request({ id: "novo", status: "pending", requestedAt: minutesAgo(1), processedAt: null }),
    request({ id: "cupom", printStatus: "failed", printMessage: "Impressora sem papel" })
  ];

  it("por padrao mostra falhas e parados (pendente ha mais de 5 min)", () => {
    expect(filterRequests(list, "problemas", "", devices, NOW).map((r) => r.id)).toEqual([
      "falhou",
      "parado"
    ]);
    expect(filterRequests(list, "aguardando", "", devices, NOW).map((r) => r.id)).toEqual([
      "parado",
      "novo"
    ]);
    expect(filterRequests(list, "cupom", "", devices, NOW).map((r) => r.id)).toEqual(["cupom"]);
    expect(filterRequests(list, "todos", "", devices, NOW)).toHaveLength(5);
  });

  it("busca sem acento na mensagem, no nome e na balanca", () => {
    expect(filterRequests(list, "todos", "documento", devices, NOW).map((r) => r.id)).toEqual([
      "falhou"
    ]);
    expect(filterRequests(list, "todos", "balanca 1", devices, NOW)).toHaveLength(5);
    expect(filterRequests(list, "todos", "maria", devices, NOW)).toHaveLength(5);
  });

  it("status e tempo ate executar", () => {
    expect(requestStatusView(list[1], NOW)).toEqual({ label: "Falhou", tone: "danger" });
    expect(requestStatusView(list[2], NOW)).toEqual({ label: "Parado na fila", tone: "warning" });
    expect(requestStatusView(list[3], NOW)).toEqual({ label: "Na fila", tone: "neutral" });
    expect(
      requestStatusView(
        request({ status: "processing", requestedAt: minutesAgo(1), processedAt: null }),
        NOW
      ).label
    ).toBe("Executando");
    expect(executionTime(list[0], NOW)).toEqual({ label: "1 min", tone: "neutral" });
    expect(executionTime(list[2], NOW)).toEqual({ label: "esperando ha 8 min", tone: "warning" });
  });
});

describe("fechamentos", () => {
  it("falha primeiro, depois o que espera, depois o concluido", () => {
    const base: SupportBillingRequest = {
      id: "x",
      operationId: "op",
      unitId: "unit-1",
      status: "done",
      requestedAt: minutesAgo(60),
      processedAt: minutesAgo(59),
      resultMessage: null
    };
    const sorted = sortBillingRequests(
      [
        { ...base, id: "done-new", requestedAt: minutesAgo(5) },
        {
          ...base,
          id: "pending",
          status: "pending",
          processedAt: null,
          requestedAt: minutesAgo(2)
        },
        { ...base, id: "failed", status: "failed" },
        {
          ...base,
          id: "stuck",
          status: "processing",
          processedAt: null,
          requestedAt: minutesAgo(40)
        }
      ],
      NOW
    );
    expect(sorted.map((item) => item.id)).toEqual(["failed", "stuck", "pending", "done-new"]);
  });
});

describe("envios OMIE", () => {
  it("da o motivo em portugues", () => {
    expect(omieReason(omie({ omieBillingStatus: "cadastro_incompleto" }), NOW).label).toBe(
      "Cadastro incompleto no OMIE"
    );
    expect(omieReason(omie({ omieBillingStatus: "missing_in_omie" }), NOW)).toMatchObject({
      label: "Nao encontrado no OMIE",
      severity: "danger"
    });
    expect(omieReason(omie({ omieBillingStatus: "failed" }), NOW).label).toBe("Erro no envio");
    expect(omieReason(omie({ status: "sync_error" }), NOW).key).toBe("sync_error");
    expect(omieReason(omie({ status: "pending_omie" }), NOW)).toMatchObject({
      key: "stuck_omie",
      label: "Parado ha 4 h sem subir"
    });
    expect(omieReason(omie({ closedAt: minutesAgo(3 * 24 * 60) }), NOW).label).toBe(
      "Parado ha 3 d sem subir"
    );
  });

  it("ordena o mais grave primeiro e resume por motivo", () => {
    const list = [
      omie({ id: "parado" }),
      omie({ id: "cadastro", omieBillingStatus: "cadastro_incompleto" }),
      omie({ id: "erro", omieBillingStatus: "failed" }),
      omie({ id: "cadastro2", omieBillingStatus: "cadastro_incompleto" })
    ];
    expect(sortOmieProblems(list, NOW)[0].id).toBe("erro");
    expect(countOmieReasons(list, NOW).map((item) => [item.label, item.count])).toEqual([
      ["erro no envio", 1],
      ["cadastro incompleto", 2],
      ["parado sem subir a nuvem", 1]
    ]);
  });
});

describe("relatorios automaticos", () => {
  it("falha e parcial sao problema; pulado nao", () => {
    expect(dispatchIsProblem({ status: "failed", lastError: "SMTP 550" })).toBe(true);
    expect(dispatchIsProblem({ status: "partial", lastError: null })).toBe(true);
    expect(dispatchIsProblem({ status: "skipped", lastError: "sem destinatario" })).toBe(false);
    expect(dispatchIsProblem({ status: "sent", lastError: null })).toBe(false);
    expect(dispatchStatusView({ status: "sent" })).toEqual({ label: "Enviado", tone: "success" });
  });
});

describe("acessos", () => {
  it("agrupa tentativas de senha por usuario", () => {
    const groups = groupPasswordFailures([
      { userId: "u1", userName: "Joao", attemptedAt: minutesAgo(50) },
      { userId: "u2", userName: "Ana", attemptedAt: minutesAgo(10) },
      { userId: "u1", userName: "Joao", attemptedAt: minutesAgo(5) },
      { userId: "u1", userName: null, attemptedAt: minutesAgo(90) }
    ]);
    expect(groups).toEqual([
      { userId: "u1", userName: "Joao", count: 3, firstAt: minutesAgo(90), lastAt: minutesAgo(5) },
      { userId: "u2", userName: "Ana", count: 1, firstAt: minutesAgo(10), lastAt: minutesAgo(10) }
    ]);
    expect(passwordSeverity(groups)).toBe("warning");
    expect(passwordSeverity([{ ...groups[0], count: 6 }])).toBe("danger");
    expect(passwordSeverity([])).toBe("ok");
  });

  it("rotulo do perfil e ordem da lista", () => {
    expect(roleLabel("administrador")).toBe("Administrador");
    expect(roleLabel("loader")).toBe("Carregador");
    expect(roleLabel("desconhecido")).toBe("desconhecido");
    const user = {
      email: "x@x",
      requiresPricePassword: false,
      deviceId: null,
      unitId: null
    };
    const sorted = sortWebUsers([
      { ...user, id: "1", name: "Zeca", role: "operacao", isActive: true },
      { ...user, id: "2", name: "Ana", role: "gestor", isActive: false },
      { ...user, id: "3", name: "Bia", role: "gestor", isActive: true }
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["3", "1", "2"]);
  });
});

describe("resumo", () => {
  const browserErrors: ErrorLogEntry[] = [
    { at: minutesAgo(3), source: "api", message: "HTTP 500", path: "/painel" }
  ];

  it("sem resposta da nuvem, so o navegador tem numero", () => {
    const cards = summarizeSupport(null, browserErrors, NOW);
    expect(cards).toHaveLength(8);
    expect(cards.filter((card) => card.severity === "unknown")).toHaveLength(7);
    expect(cards.at(-1)).toMatchObject({ value: "1", severity: "warning", tab: "navegador" });
  });

  it("acende os cartoes pelo que esta errado", () => {
    const data = overview({
      devices: [
        device(),
        device({ id: "dev-2", name: "PC PATIO", online: false, lastSeenAt: minutesAgo(125) }),
        device({
          id: "dev-3",
          name: "PC VELHO",
          appVersion: "1.3.0",
          health: {
            queuePending: 4,
            queueBlocked: 2,
            oldestPendingAt: minutesAgo(90),
            lastError: "HTTP 503",
            collectedAt: minutesAgo(1)
          }
        }),
        device({ id: "dev-4", name: "PC ANTIGO", isActive: false, online: false })
      ],
      operationRequests: [
        request({ status: "failed" }),
        request({ id: "r2", status: "pending", requestedAt: minutesAgo(20), processedAt: null })
      ],
      omieProblems: [omie({ omieBillingStatus: "cadastro_incompleto" })],
      reportDispatches: [
        {
          id: "d1",
          kind: "diario",
          reportDate: "2026-09-24",
          status: "failed",
          lastError: "SMTP",
          recipientsCount: 2,
          dispatchedAt: minutesAgo(600)
        }
      ],
      pricePasswordFailures: [{ userId: "u1", userName: "Joao", attemptedAt: minutesAgo(5) }]
    });
    const cards = Object.fromEntries(
      summarizeSupport(data, [], NOW).map((card) => [card.id, card])
    );
    expect(cards.offline).toMatchObject({
      value: "1 de 3",
      detail: "PC PATIO · ha 2 h 05 min",
      severity: "danger"
    });
    expect(cards.desatualizadas).toMatchObject({ value: "1", severity: "warning" });
    expect(cards.fila).toMatchObject({
      value: "1",
      detail: "2 envios parados · mais antiga ha 1 h 30 min",
      severity: "danger"
    });
    expect(cards.pedidos).toMatchObject({
      value: "2",
      detail: "1 falhou · 1 parado",
      severity: "danger"
    });
    expect(cards.omie).toMatchObject({ value: "1", detail: "1 cadastro incompleto" });
    expect(cards.relatorios).toMatchObject({ value: "1", severity: "danger" });
    expect(cards.senha).toMatchObject({ value: "1", detail: "Joao: 1 tentativa" });
    expect(cards.navegador).toMatchObject({ value: "0", severity: "ok" });

    const badges = tabBadges(data, browserErrors, NOW);
    expect(badges.balancas).toEqual({ count: 2, severity: "danger" });
    expect(badges.pedidos).toEqual({ count: 2, severity: "danger" });
    expect(badges.fechamentos).toBeNull();
    expect(badges.navegador).toEqual({ count: 1, severity: "warning" });
  });

  it("tudo em ordem fica verde", () => {
    const cards = summarizeSupport(overview(), [], NOW);
    expect(cards.every((card) => card.severity === "ok")).toBe(true);
  });
});

describe("buildSupportReport", () => {
  const data = overview({
    devices: [
      device({ executesWebOperations: true }),
      device({
        id: "dev-2",
        name: "PC PATIO",
        online: false,
        lastSeenAt: minutesAgo(125),
        health: { ...device().health, lastError: 'Falha {"password":"segredo123"}\nlinha 2' }
      })
    ],
    operationRequests: Array.from({ length: 14 }, (_, index) =>
      request({ id: `r${index}`, status: "failed", resultMessage: `falha ${index}` })
    ),
    omieProblems: [omie({ omieBillingStatus: "missing_in_omie", omieBillingMessage: "Pedido 99" })],
    webUsers: [
      {
        id: "u1",
        name: "Joao",
        email: "joao@pedreira.com.br",
        role: "gestor",
        isActive: true,
        requiresPricePassword: true,
        deviceId: null,
        unitId: "unit-1"
      }
    ],
    pricePasswordFailures: [{ userId: "u1", userName: "Joao", attemptedAt: minutesAgo(5) }]
  });
  const report = buildSupportReport({
    overview: data,
    diagnostics,
    browserErrors: [
      {
        at: minutesAgo(2),
        source: "api",
        message: 'Recusado {"senha":"1234"}',
        path: "/cadastros/produtos"
      }
    ],
    connection: {
      at: minutesAgo(1),
      api: { ok: true, ms: 182.4 },
      db: { ok: false, ms: 5003, error: "timeout" }
    },
    now: NOW
  });

  it("traz diagnostico, resumo e as secoes", () => {
    expect(report).toContain("KyberRock Web — relatorio para o suporte");
    expect(report).toContain("Gerado em 25/09/2026 12:00");
    expect(report).toContain("Usuario: Suporte Kybernan (Administrador)");
    expect(report).toContain("web-api 182 ms · banco falhou em 5003 ms: timeout");
    expect(report).toContain("Balancas offline: 1 de 2 — PC PATIO · ha 2 h 05 min [!!]");
    expect(report).toContain("PC BALANCA 1 (No 1) · Pedreira Centro · v1.4.10");
    expect(report).toContain("executa o site");
    expect(report).toContain("Nao encontrado no OMIE");
    expect(report).toContain("Joao · 1 tentativa");
    expect(report).toContain("[api] Recusado");
  });

  it("corta listas compridas", () => {
    expect(report).toContain("... e mais 4");
    expect(report).toContain("falha 9");
    expect(report).not.toContain("falha 10");
  });

  it("nao leva senha nem e-mail, e mantem cada item numa linha", () => {
    expect(report).not.toContain("segredo123");
    expect(report).not.toContain("1234");
    expect(report).not.toContain("joao@pedreira.com.br");
    expect(report).toContain('Falha {"password":"[oculto]"} linha 2');
  });

  it("sem nuvem ainda gera diagnostico e erros do navegador", () => {
    const offline = buildSupportReport({
      overview: null,
      diagnostics,
      browserErrors: [],
      loadError: "So o perfil Administrador ve os logs.",
      now: NOW
    });
    expect(offline).toContain("Nuvem: nao respondeu (So o perfil Administrador ve os logs.)");
    expect(offline).toContain("Balancas offline: — — aguardando a nuvem");
    expect(offline).toContain("== Erros deste navegador ==\nNenhum.");
    expect(offline).not.toContain("== Balancas");
  });
});
