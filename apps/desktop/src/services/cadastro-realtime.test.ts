import { describe, expect, it, vi } from "vitest";

import {
  startCadastroPingScheduler,
  startCadastroRealtime,
  type RealtimeCapableClient,
  type RealtimeChannelLike
} from "./cadastro-realtime.js";

/**
 * Relogio e timers de mentira, para o teste nao esperar de verdade.
 *
 * `vi.useFakeTimers()` nao serve aqui: o agendador encadeia um `setTimeout` DENTRO do
 * `finally` de uma promessa, e avancar timer falso sem soltar a microtask deixa o segundo
 * agendamento invisivel. Com o controle na mao, cada teste diz exatamente quando o tempo anda.
 */
function createClock() {
  let current = 0;
  const pending = new Map<number, { runAt: number; callback: () => void }>();
  let nextId = 1;

  return {
    now: () => current,
    setTimeoutFn: ((callback: () => void, delay?: number) => {
      const id = nextId++;
      pending.set(id, { runAt: current + (delay ?? 0), callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout,
    clearTimeoutFn: ((id: ReturnType<typeof setTimeout>) => {
      pending.delete(id as unknown as number);
    }) as unknown as typeof clearTimeout,
    /** Anda o relogio e executa o que venceu, na ordem. */
    async advance(ms: number): Promise<void> {
      current += ms;
      const due = [...pending.entries()]
        .filter(([, entry]) => entry.runAt <= current)
        .sort((a, b) => a[1].runAt - b[1].runAt);
      for (const [id, entry] of due) {
        pending.delete(id);
        entry.callback();
        // Solta as microtasks para o `pull` (assincrono) terminar antes do proximo passo.
        await Promise.resolve();
        await Promise.resolve();
      }
    },
    pendingCount: () => pending.size
  };
}

describe("startCadastroPingScheduler", () => {
  it("junta a rajada de avisos do mesmo salvamento em um unico pull", async () => {
    const clock = createClock();
    const pull = vi.fn().mockResolvedValue(undefined);
    const scheduler = startCadastroPingScheduler({
      pull,
      now: clock.now,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    // Um salvamento na tela escreve em varias tabelas: cliente, placas, transportadoras.
    scheduler.ping();
    scheduler.ping();
    scheduler.ping();

    await clock.advance(400);

    expect(pull).toHaveBeenCalledTimes(1);
  });

  it("nao dispara antes da folga de juntar", async () => {
    const clock = createClock();
    const pull = vi.fn().mockResolvedValue(undefined);
    const scheduler = startCadastroPingScheduler({
      pull,
      now: clock.now,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    scheduler.ping();
    await clock.advance(399);
    expect(pull).not.toHaveBeenCalled();

    await clock.advance(1);
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it("respeita o piso entre dois pulls, contado do fim do anterior", async () => {
    const clock = createClock();
    const pull = vi.fn().mockResolvedValue(undefined);
    const scheduler = startCadastroPingScheduler({
      pull,
      now: clock.now,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    scheduler.ping();
    await clock.advance(400);
    expect(pull).toHaveBeenCalledTimes(1);

    // Aviso logo em seguida (a rajada do `omie-sync` gravando o cadastro em lotes).
    scheduler.ping();
    await clock.advance(400);
    expect(pull).toHaveBeenCalledTimes(1);

    // 1,5 s depois do fim do primeiro: agora pode.
    await clock.advance(1_100);
    expect(pull).toHaveBeenCalledTimes(2);
  });

  it("nao perde o aviso que chegou com um pull em andamento", async () => {
    const clock = createClock();
    let releasePull: (() => void) | null = null;
    const pull = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releasePull = resolve;
        })
    );
    const scheduler = startCadastroPingScheduler({
      pull,
      now: clock.now,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    scheduler.ping();
    await clock.advance(400);
    expect(pull).toHaveBeenCalledTimes(1);

    // A linha gravada DEPOIS que este pull montou a janela dele: descartar o aviso a
    // esconderia ate o tique de 15 s.
    scheduler.ping();
    releasePull?.();
    await Promise.resolve();
    await Promise.resolve();

    await clock.advance(2_000);
    expect(pull).toHaveBeenCalledTimes(2);
  });

  it("segue vivo depois de um pull que falhou", async () => {
    const clock = createClock();
    const onError = vi.fn();
    const pull = vi
      .fn()
      .mockRejectedValueOnce(new Error("sem internet"))
      .mockResolvedValue(undefined);
    const scheduler = startCadastroPingScheduler({
      pull,
      onError,
      now: clock.now,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    scheduler.ping();
    await clock.advance(400);
    expect(onError).toHaveBeenCalledTimes(1);

    await clock.advance(1_600);
    scheduler.ping();
    await clock.advance(400);
    expect(pull).toHaveBeenCalledTimes(2);
  });

  it("para de agendar depois do stop", async () => {
    const clock = createClock();
    const pull = vi.fn().mockResolvedValue(undefined);
    const scheduler = startCadastroPingScheduler({
      pull,
      now: clock.now,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    scheduler.ping();
    scheduler.stop();
    await clock.advance(5_000);

    expect(pull).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });
});

/** Canal de mentira: guarda o filtro pedido e deixa o teste disparar evento e status. */
function createFakeClient() {
  const channels: Array<{
    name: string;
    filter: { event: string; schema: string; table: string; filter?: string };
    emit: (payload: unknown) => void;
    setStatus: (status: string) => void;
  }> = [];
  const removed: RealtimeChannelLike[] = [];

  const client: RealtimeCapableClient = {
    channel: (name: string) => {
      let handler: ((payload: unknown) => void) | null = null;
      let statusCallback: ((status: string) => void) | null = null;
      const entry = {
        name,
        filter: { event: "", schema: "", table: "" } as {
          event: string;
          schema: string;
          table: string;
          filter?: string;
        },
        emit: (payload: unknown) => handler?.(payload),
        setStatus: (status: string) => statusCallback?.(status)
      };
      const channel: RealtimeChannelLike = {
        on: (_type, filter, callback) => {
          entry.filter = filter;
          handler = callback;
          return channel;
        },
        subscribe: (callback) => {
          statusCallback = callback ? (status: string) => callback(status) : null;
          return channel;
        }
      };
      channels.push(entry);
      return channel;
    },
    removeChannel: (channel: RealtimeChannelLike) => {
      removed.push(channel);
      return undefined;
    }
  };

  return { client, channels, removed };
}

/** Intervalo de mentira, para o teste chamar o supervisor na hora que quiser. */
function createSupervisorTimer() {
  let tick: (() => void) | null = null;
  return {
    setIntervalFn: ((callback: () => void) => {
      tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval,
    clearIntervalFn: (() => {
      tick = null;
    }) as unknown as typeof clearInterval,
    run: () => tick?.()
  };
}

describe("startCadastroRealtime", () => {
  it("assina so o aviso da propria pedreira", () => {
    const { client, channels } = createFakeClient();
    const timer = createSupervisorTimer();

    startCadastroRealtime({
      getClient: () => client,
      getCompanyId: () => "empresa-1",
      onPing: vi.fn(),
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn
    });

    expect(channels).toHaveLength(1);
    expect(channels[0].filter.table).toBe("cadastro_change_pings");
    expect(channels[0].filter.filter).toBe("company_id=eq.empresa-1");
  });

  it("nao assina nada enquanto a balanca nao foi ativada", () => {
    const { client, channels } = createFakeClient();
    const timer = createSupervisorTimer();

    const handle = startCadastroRealtime({
      getClient: () => client,
      getCompanyId: () => null,
      onPing: vi.fn(),
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn
    });

    expect(channels).toHaveLength(0);
    expect(handle.getState()).toBe("off");
  });

  it("assina assim que a ativacao acontece com o programa ja aberto", () => {
    const { client, channels } = createFakeClient();
    const timer = createSupervisorTimer();
    let companyId: string | null = null;

    const handle = startCadastroRealtime({
      getClient: () => client,
      getCompanyId: () => companyId,
      onPing: vi.fn(),
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn
    });
    expect(channels).toHaveLength(0);

    companyId = "empresa-1";
    timer.run();

    expect(channels).toHaveLength(1);
    expect(handle.getState()).toBe("connecting");
  });

  it("avisa o evento como ping", () => {
    const { client, channels } = createFakeClient();
    const timer = createSupervisorTimer();
    const onPing = vi.fn();

    startCadastroRealtime({
      getClient: () => client,
      getCompanyId: () => "empresa-1",
      onPing,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn
    });

    channels[0].emit({});
    expect(onPing).toHaveBeenCalledTimes(1);
  });

  it("puxa ao subir a inscricao — o que passou enquanto ela esteve fora nao volta sozinho", () => {
    const { client, channels } = createFakeClient();
    const timer = createSupervisorTimer();
    const onPing = vi.fn();

    const handle = startCadastroRealtime({
      getClient: () => client,
      getCompanyId: () => "empresa-1",
      onPing,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn
    });

    channels[0].setStatus("SUBSCRIBED");
    expect(handle.getState()).toBe("live");
    expect(onPing).toHaveBeenCalledTimes(1);

    // Confirmacao repetida do mesmo canal nao e reconexao: nao pode virar pull.
    channels[0].setStatus("SUBSCRIBED");
    expect(onPing).toHaveBeenCalledTimes(1);
  });

  it("refaz a inscricao no proximo tique depois de uma queda", () => {
    const { client, channels, removed } = createFakeClient();
    const timer = createSupervisorTimer();

    const handle = startCadastroRealtime({
      getClient: () => client,
      getCompanyId: () => "empresa-1",
      onPing: vi.fn(),
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn
    });

    channels[0].setStatus("SUBSCRIBED");
    channels[0].setStatus("CHANNEL_ERROR");
    expect(handle.getState()).toBe("error");

    // A reconexao e do supervisor, nao do callback: no proprio callback ela concorreria com a
    // re-tentativa interna do supabase-js.
    expect(channels).toHaveLength(1);

    timer.run();
    expect(channels).toHaveLength(2);
    expect(removed).toHaveLength(1);
  });

  it("nao refaz a inscricao que esta de pe", () => {
    const { client, channels } = createFakeClient();
    const timer = createSupervisorTimer();

    startCadastroRealtime({
      getClient: () => client,
      getCompanyId: () => "empresa-1",
      onPing: vi.fn(),
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn
    });

    channels[0].setStatus("SUBSCRIBED");
    timer.run();
    timer.run();

    expect(channels).toHaveLength(1);
  });

  it("troca de canal quando a balanca muda de empresa", () => {
    const { client, channels, removed } = createFakeClient();
    const timer = createSupervisorTimer();
    let companyId = "empresa-1";

    startCadastroRealtime({
      getClient: () => client,
      getCompanyId: () => companyId,
      onPing: vi.fn(),
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn
    });
    channels[0].setStatus("SUBSCRIBED");

    companyId = "empresa-2";
    timer.run();

    expect(removed).toHaveLength(1);
    expect(channels).toHaveLength(2);
    expect(channels[1].filter.filter).toBe("company_id=eq.empresa-2");
  });

  it("solta o canal no stop e para de avisar", () => {
    const { client, channels, removed } = createFakeClient();
    const timer = createSupervisorTimer();
    const onPing = vi.fn();

    const handle = startCadastroRealtime({
      getClient: () => client,
      getCompanyId: () => "empresa-1",
      onPing,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn
    });

    handle.stop();
    expect(removed).toHaveLength(1);
    expect(handle.getState()).toBe("off");

    channels[0].emit({});
    expect(onPing).not.toHaveBeenCalled();
  });

  it("nao derruba a balanca quando a inscricao estoura", () => {
    const timer = createSupervisorTimer();
    const onError = vi.fn();
    const client: RealtimeCapableClient = {
      channel: () => {
        throw new Error("websocket bloqueado pela rede da pedreira");
      },
      removeChannel: () => undefined
    };

    const handle = startCadastroRealtime({
      getClient: () => client,
      getCompanyId: () => "empresa-1",
      onPing: vi.fn(),
      onError,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(handle.getState()).toBe("error");
  });
});
