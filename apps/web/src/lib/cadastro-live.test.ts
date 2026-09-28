import { describe, expect, it } from "vitest";

import {
  CADASTRO_LIVE_COALESCE_MS,
  CADASTRO_LIVE_MIN_INTERVAL_MS,
  createCadastroChangeGate,
  touches,
  type ChangedTables
} from "./cadastro-live";

/** Relogio e timers de mentira: o teste anda o tempo na mao. */
function harness(options: { visible?: boolean } = {}) {
  let clock = 0;
  let visible = options.visible ?? true;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const flushed: ChangedTables[] = [];
  const gate = createCadastroChangeGate({
    onFlush: (changed) => flushed.push(changed),
    isVisible: () => visible,
    now: () => clock,
    setTimeoutFn: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { at: clock + ms, callback });
      return id;
    },
    clearTimeoutFn: (handle) => {
      timers.delete(handle as number);
    }
  });
  function advance(ms: number) {
    const until = clock + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].callback();
    }
    clock = until;
  }
  return {
    gate,
    flushed,
    advance,
    pendingTimers: () => timers.size,
    setVisible: (value: boolean) => {
      visible = value;
    }
  };
}

const tablesOf = (changed: ChangedTables | undefined) =>
  changed === "all" ? "all" : [...(changed ?? [])].sort();

describe("createCadastroChangeGate", () => {
  it("entrega o aviso depois da folga curta, com a tabela que mudou", () => {
    const h = harness();
    h.gate.ping("customers");
    h.advance(CADASTRO_LIVE_COALESCE_MS - 1);
    expect(h.flushed).toHaveLength(0);
    h.advance(1);
    expect(h.flushed).toHaveLength(1);
    expect(tablesOf(h.flushed[0])).toEqual(["customers"]);
  });

  it("junta numa entrega so as tabelas de um mesmo salvamento", () => {
    const h = harness();
    h.gate.ping("customers");
    h.advance(200);
    h.gate.ping("customer_carriers");
    h.gate.ping("customers");
    h.advance(CADASTRO_LIVE_COALESCE_MS);
    expect(h.flushed).toHaveLength(1);
    expect(tablesOf(h.flushed[0])).toEqual(["customer_carriers", "customers"]);
  });

  it("aviso sem tabela vale como tudo mudou", () => {
    const h = harness();
    h.gate.ping("vehicles");
    h.gate.ping(null);
    h.gate.ping("drivers");
    h.advance(CADASTRO_LIVE_COALESCE_MS);
    expect(h.flushed).toEqual(["all"]);
  });

  it("espaca as entregas pelo piso, sem perder o aviso que chegou no meio", () => {
    const h = harness();
    h.gate.ping("customers");
    h.advance(CADASTRO_LIVE_COALESCE_MS);
    expect(h.flushed).toHaveLength(1);

    h.gate.ping("products");
    h.advance(CADASTRO_LIVE_MIN_INTERVAL_MS - 1);
    expect(h.flushed).toHaveLength(1);
    h.advance(1);
    expect(h.flushed).toHaveLength(2);
    expect(tablesOf(h.flushed[1])).toEqual(["products"]);
  });

  it("depois de um tempo parado, volta a entregar so com a folga curta", () => {
    const h = harness();
    h.gate.ping("customers");
    h.advance(CADASTRO_LIVE_COALESCE_MS);
    h.advance(60_000);
    h.gate.ping("carriers");
    h.advance(CADASTRO_LIVE_COALESCE_MS);
    expect(h.flushed).toHaveLength(2);
  });

  it("com a aba escondida guarda o aviso e entrega tudo quando ela volta", () => {
    const h = harness({ visible: false });
    h.gate.ping("customers");
    h.gate.ping("vehicles");
    h.advance(60_000);
    expect(h.flushed).toHaveLength(0);
    expect(h.pendingTimers()).toBe(0);

    h.setVisible(true);
    h.gate.wake();
    h.advance(CADASTRO_LIVE_COALESCE_MS);
    expect(h.flushed).toHaveLength(1);
    expect(tablesOf(h.flushed[0])).toEqual(["customers", "vehicles"]);
  });

  it("aba escondida durante a espera segura a entrega para o wake", () => {
    const h = harness();
    h.gate.ping("customers");
    h.setVisible(false);
    h.advance(CADASTRO_LIVE_COALESCE_MS);
    expect(h.flushed).toHaveLength(0);

    h.setVisible(true);
    h.gate.wake();
    h.advance(CADASTRO_LIVE_MIN_INTERVAL_MS);
    expect(h.flushed).toHaveLength(1);
    expect(tablesOf(h.flushed[0])).toEqual(["customers"]);
  });

  it("wake sem aviso guardado nao rele nada", () => {
    const h = harness();
    h.gate.wake();
    h.advance(60_000);
    expect(h.flushed).toHaveLength(0);
  });

  it("stop cancela a entrega agendada e ignora avisos seguintes", () => {
    const h = harness();
    h.gate.ping("customers");
    h.gate.stop();
    h.gate.ping("products");
    h.advance(60_000);
    expect(h.flushed).toHaveLength(0);
    expect(h.pendingTimers()).toBe(0);
  });
});

describe("touches", () => {
  it("rele a tela que mostra a tabela citada", () => {
    expect(touches(new Set(["customers"]), ["customers", "carriers"])).toBe(true);
  });

  it("nao rele a tela que nao mostra nenhuma das tabelas", () => {
    expect(touches(new Set(["customer_credit_movements"]), ["customers"])).toBe(false);
  });

  it("tudo mudou rele qualquer tela, e tela sem lista rele sempre", () => {
    expect(touches("all", ["customers"])).toBe(true);
    expect(touches(new Set(["products"]), undefined)).toBe(true);
  });
});
