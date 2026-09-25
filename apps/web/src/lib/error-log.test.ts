import { afterEach, describe, expect, it } from "vitest";

import {
  ERROR_DETAIL_MAX,
  ERROR_LOG_KEY,
  ERROR_LOG_LIMIT,
  ERROR_MESSAGE_MAX,
  clearErrorLog,
  createErrorLog,
  describeThrown,
  entryFromErrorEvent,
  entryFromRejection,
  installErrorLog,
  parseErrorLog,
  readErrorLog,
  recordError,
  redactSecrets,
  subscribeErrorLog,
  type ErrorLogEntry,
  type ErrorLogStorage,
  type ErrorLogTarget
} from "./error-log";

/** `localStorage` de mentira: um Map, com as falhas que o de verdade tem. */
function fakeStorage(options: { failWrites?: boolean; failReads?: boolean } = {}) {
  const data = new Map<string, string>();
  const storage: ErrorLogStorage = {
    getItem(key) {
      if (options.failReads) throw new Error("SecurityError");
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (options.failWrites) throw new Error("QuotaExceededError");
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    }
  };
  return { storage, data };
}

function clock(start = Date.parse("2026-09-25T12:00:00.000Z")) {
  let at = start;
  return () => new Date((at += 1000));
}

/** `window` de mentira: guarda os ouvintes e deixa o teste disparar eventos. */
function fakeTarget(pathname = "/operacoes") {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const target: ErrorLogTarget & { emit: (type: string, event: unknown) => void; count: number } = {
    location: { pathname },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    get count() {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    }
  };
  return target;
}

describe("createErrorLog", () => {
  it("grava no storage e le do mais novo ao mais antigo", () => {
    const { storage, data } = fakeStorage();
    const log = createErrorLog({ storage: () => storage, now: clock() });
    log.record({ source: "api", message: "primeiro", path: "/painel" });
    log.record({ source: "window", message: "segundo" });

    const entries = log.read();
    expect(entries.map((entry) => entry.message)).toEqual(["segundo", "primeiro"]);
    expect(entries[1]).toEqual({
      at: "2026-09-25T12:00:01.000Z",
      source: "api",
      message: "primeiro",
      path: "/painel"
    });
    const stored = JSON.parse(data.get(ERROR_LOG_KEY) ?? "[]") as ErrorLogEntry[];
    expect(stored.map((entry) => entry.message)).toEqual(["primeiro", "segundo"]);
  });

  it("guarda so os ultimos 100 (anel)", () => {
    const { storage } = fakeStorage();
    const log = createErrorLog({ storage: () => storage, now: clock() });
    for (let index = 0; index < ERROR_LOG_LIMIT + 15; index++) {
      log.record({ source: "app", message: `erro ${index}` });
    }
    const entries = log.read();
    expect(entries).toHaveLength(ERROR_LOG_LIMIT);
    expect(entries[0].message).toBe(`erro ${ERROR_LOG_LIMIT + 14}`);
    expect(entries.at(-1)?.message).toBe("erro 15");
  });

  it("corta mensagem e detalhe compridos", () => {
    const log = createErrorLog({ storage: () => null, now: clock() });
    const entry = log.record({
      source: "api",
      message: "m".repeat(ERROR_MESSAGE_MAX + 50),
      detail: "d".repeat(ERROR_DETAIL_MAX + 50)
    });
    expect(entry.message).toHaveLength(ERROR_MESSAGE_MAX);
    expect(entry.message.endsWith("…")).toBe(true);
    expect(entry.detail).toHaveLength(ERROR_DETAIL_MAX);
  });

  it("nunca grava senha: mascara o valor de chaves com cara de senha", () => {
    const { storage, data } = fakeStorage();
    const log = createErrorLog({ storage: () => storage, now: clock() });
    log.record({
      source: "api",
      message: "Senha de preco incorreta.",
      detail:
        '{"action":"set_product_default_price","payload":{"pricePassword":"1234","senha":"abc"}}'
    });
    const raw = data.get(ERROR_LOG_KEY) ?? "";
    expect(raw).not.toContain("1234");
    expect(raw).not.toContain('"abc"');
    expect(log.read()[0].detail).toBe(
      '{"action":"set_product_default_price","payload":{"pricePassword":"[oculto]","senha":"[oculto]"}}'
    );
    // A mensagem sem valor de senha continua legivel.
    expect(log.read()[0].message).toBe("Senha de preco incorreta.");
  });

  it("funciona sem storage (aba anonima, cookies bloqueados)", () => {
    const log = createErrorLog({
      storage: () => {
        throw new Error("SecurityError");
      },
      now: clock()
    });
    log.record({ source: "app", message: "so em memoria" });
    expect(log.read().map((entry) => entry.message)).toEqual(["so em memoria"]);
    log.clear();
    expect(log.read()).toEqual([]);
  });

  it("segue em memoria quando o storage recusa leitura ou escrita", () => {
    const reads = fakeStorage({ failReads: true });
    const readLog = createErrorLog({ storage: () => reads.storage, now: clock() });
    readLog.record({ source: "app", message: "a" });
    expect(readLog.read()).toHaveLength(1);

    const writes = fakeStorage({ failWrites: true });
    const writeLog = createErrorLog({ storage: () => writes.storage, now: clock() });
    expect(() => writeLog.record({ source: "app", message: "b" })).not.toThrow();
    expect(writeLog.read().map((entry) => entry.message)).toEqual(["b"]);
  });

  it("descarta o que estiver corrompido no storage", () => {
    const { storage, data } = fakeStorage();
    data.set(ERROR_LOG_KEY, "{nao e json");
    const log = createErrorLog({ storage: () => storage, now: clock() });
    expect(log.read()).toEqual([]);
    log.record({ source: "app", message: "novo" });
    expect(log.read().map((entry) => entry.message)).toEqual(["novo"]);
  });

  it("limpar apaga o storage e avisa os inscritos", () => {
    const { storage, data } = fakeStorage();
    const log = createErrorLog({ storage: () => storage, now: clock() });
    const seen: number[] = [];
    const unsubscribe = log.subscribe((entries) => seen.push(entries.length));
    log.record({ source: "app", message: "x" });
    log.record({ source: "app", message: "y" });
    log.clear();
    expect(seen).toEqual([1, 2, 0]);
    expect(data.has(ERROR_LOG_KEY)).toBe(false);

    unsubscribe();
    log.record({ source: "app", message: "z" });
    expect(seen).toEqual([1, 2, 0]);
  });

  it("um inscrito com defeito nao impede os outros", () => {
    const log = createErrorLog({ storage: () => null, now: clock() });
    const seen: string[] = [];
    log.subscribe(() => {
      throw new Error("defeito");
    });
    log.subscribe((entries) => seen.push(entries[0].message));
    expect(() => log.record({ source: "app", message: "ok" })).not.toThrow();
    expect(seen).toEqual(["ok"]);
  });

  it("le o que outra aba gravou no mesmo storage", () => {
    const { storage } = fakeStorage();
    const tabA = createErrorLog({ storage: () => storage, now: clock() });
    const tabB = createErrorLog({ storage: () => storage, now: clock() });
    tabA.record({ source: "app", message: "da aba A" });
    tabB.record({ source: "app", message: "da aba B" });
    expect(tabA.read().map((entry) => entry.message)).toEqual(["da aba B", "da aba A"]);
    // Limpar numa aba limpa a outra: o storage e a verdade enquanto ele aceita gravar.
    tabB.clear();
    expect(tabA.read()).toEqual([]);
  });
});

describe("parseErrorLog", () => {
  it("aceita so entradas validas", () => {
    const raw = JSON.stringify([
      { at: "2026-09-25T12:00:00.000Z", source: "api", message: "ok", detail: "d", path: "/x" },
      { at: "nao e data", source: "api", message: "sem data" },
      { at: "2026-09-25T12:00:00.000Z", source: "outra", message: "fonte invalida" },
      { at: "2026-09-25T12:00:00.000Z", source: "app" },
      "texto solto",
      null
    ]);
    expect(parseErrorLog(raw)).toEqual([
      { at: "2026-09-25T12:00:00.000Z", source: "api", message: "ok", detail: "d", path: "/x" }
    ]);
    expect(parseErrorLog(null)).toBeNull();
    expect(parseErrorLog('{"a":1}')).toBeNull();
  });
});

describe("redactSecrets", () => {
  it("mascara JSON, JSON escapado, chave=valor, Bearer e JWT", () => {
    expect(redactSecrets('{"password": "s3nh@", "name": "Joao"}')).toBe(
      '{"password": "[oculto]", "name": "Joao"}'
    );
    expect(redactSecrets('{"body":"{\\"senha\\":\\"9999\\",\\"x\\":1}"}')).toBe(
      '{"body":"{\\"senha\\":\\"[oculto]\\",\\"x\\":1}"}'
    );
    expect(redactSecrets("login?user=ana&password=abc123&x=1")).toBe(
      "login?user=ana&password=[oculto]&x=1"
    );
    expect(redactSecrets("senha: minhasenha")).toBe("senha: [oculto]");
    expect(redactSecrets("Authorization: Bearer abc.def.ghi")).not.toContain("abc.def");
    expect(
      redactSecrets("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl vencido")
    ).toBe("token [oculto] vencido");
  });

  it("nao mexe em texto sem segredo", () => {
    const text = "Balanca PC PATIO nao respondeu (HTTP 503). Tente de novo.";
    expect(redactSecrets(text)).toBe(text);
    expect(redactSecrets("Senha de preco incorreta")).toBe("Senha de preco incorreta");
  });
});

describe("describeThrown", () => {
  it("le Error, texto e objeto", () => {
    const error = new Error("falhou");
    expect(describeThrown(error).message).toBe("falhou");
    expect(describeThrown(error).detail).toContain("falhou");
    expect(describeThrown("texto")).toEqual({ message: "texto" });
    expect(describeThrown({ code: 42 })).toEqual({ message: '{"code":42}' });
    expect(describeThrown(undefined)).toEqual({ message: "Erro sem mensagem" });
  });
});

describe("eventos do navegador", () => {
  it("traduz o ErrorEvent com arquivo e linha quando nao ha stack", () => {
    expect(
      entryFromErrorEvent(
        { message: "x is not defined", filename: "https://site/app.js", lineno: 10, colno: 5 },
        "/painel"
      )
    ).toEqual({
      source: "window",
      message: "x is not defined",
      detail: "https://site/app.js:10:5",
      path: "/painel"
    });
  });

  it("ignora o ruido do ResizeObserver e de script de outra origem", () => {
    expect(entryFromErrorEvent({ message: "ResizeObserver loop limit exceeded" })).toBeNull();
    expect(entryFromErrorEvent({ message: "Script error." })).toBeNull();
  });

  it("traduz a promessa rejeitada", () => {
    expect(entryFromRejection({ reason: "sem rede" }, "/x")).toEqual({
      source: "promise",
      message: "sem rede",
      detail: undefined,
      path: "/x"
    });
  });
});

describe("installErrorLog", () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it("liga uma vez so e registra erro e rejeicao com a tela atual", () => {
    const log = createErrorLog({ storage: () => null, now: clock() });
    const target = fakeTarget("/cadastros/clientes");
    uninstall = installErrorLog(target, log);
    const again = installErrorLog(target, log);
    expect(again).toBe(uninstall);
    expect(target.count).toBe(3);

    target.emit("error", { message: "quebrou", error: new Error("quebrou") });
    target.emit("unhandledrejection", { reason: new Error("rejeitada") });
    target.emit("error", {
      message: "ResizeObserver loop completed with undelivered notifications."
    });

    const entries = log.read();
    expect(entries.map((entry) => [entry.source, entry.message, entry.path])).toEqual([
      ["promise", "rejeitada", "/cadastros/clientes"],
      ["window", "quebrou", "/cadastros/clientes"]
    ]);

    uninstall();
    uninstall = null;
    expect(target.count).toBe(0);
  });

  it("repassa aviso de outra aba (evento storage) aos inscritos", () => {
    const log = createErrorLog({ storage: () => null, now: clock() });
    const target = fakeTarget();
    uninstall = installErrorLog(target, log);
    let calls = 0;
    log.subscribe(() => calls++);
    target.emit("storage", { key: "outra-chave" });
    target.emit("storage", { key: ERROR_LOG_KEY });
    expect(calls).toBe(1);
  });

  it("sem window nao faz nada", () => {
    expect(() => installErrorLog(undefined)()).not.toThrow();
  });
});

describe("API do site (instancia padrao, sem window no teste)", () => {
  it("registra, le, avisa e limpa sem storage disponivel", () => {
    clearErrorLog();
    const seen: number[] = [];
    const unsubscribe = subscribeErrorLog((entries) => seen.push(entries.length));
    recordError({ source: "api", message: "HTTP 500", path: "/painel" });
    expect(readErrorLog()[0]).toMatchObject({
      source: "api",
      message: "HTTP 500",
      path: "/painel"
    });
    clearErrorLog();
    expect(readErrorLog()).toEqual([]);
    expect(seen).toEqual([1, 0]);
    unsubscribe();
  });
});
