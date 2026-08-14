import { describe, expect, it, vi } from "vitest";

import { OMIE_QUEUE_DRAIN_INTERVAL_MS, startOmieQueueDrainScheduler } from "./omie-queue-scheduler";

/** setInterval falso que devolve o tick para o teste chamar quando quiser. */
function captureTick(): { setIntervalFn: typeof setInterval; run: () => void } {
  let tick: () => void = () => undefined;
  return {
    setIntervalFn: ((handler: () => void) => {
      tick = handler;
      return 0 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval,
    run: () => tick()
  };
}

describe("startOmieQueueDrainScheduler", () => {
  it("nao toca na rede quando a fila nao tem job vencido", () => {
    const drain = vi.fn().mockResolvedValue(undefined);
    const { setIntervalFn, run } = captureTick();

    startOmieQueueDrainScheduler({
      hasRunnableJobs: () => false,
      drain,
      setIntervalFn
    });
    run();

    expect(drain).not.toHaveBeenCalled();
  });

  it("drena a fila assim que existe job vencido", async () => {
    const drain = vi.fn().mockResolvedValue(undefined);
    const { setIntervalFn, run } = captureTick();

    startOmieQueueDrainScheduler({
      hasRunnableJobs: () => true,
      drain,
      setIntervalFn
    });
    run();

    expect(drain).toHaveBeenCalledTimes(1);
  });

  it("nao dispara nada no start — so a partir do primeiro tick", () => {
    const drain = vi.fn().mockResolvedValue(undefined);
    const { setIntervalFn } = captureTick();

    startOmieQueueDrainScheduler({
      hasRunnableJobs: () => true,
      drain,
      setIntervalFn
    });

    expect(drain).not.toHaveBeenCalled();
  });

  it("evita reentrancia enquanto a drenagem anterior nao terminou", () => {
    let resolveDrain: () => void = () => undefined;
    const drain = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDrain = resolve;
        })
    );
    const { setIntervalFn, run } = captureTick();

    startOmieQueueDrainScheduler({
      hasRunnableJobs: () => true,
      drain,
      setIntervalFn
    });
    run();
    run();

    expect(drain).toHaveBeenCalledTimes(1);
    resolveDrain();
  });

  it("libera o proximo tick depois que a drenagem termina", async () => {
    const drain = vi.fn().mockResolvedValue(undefined);
    const { setIntervalFn, run } = captureTick();

    startOmieQueueDrainScheduler({
      hasRunnableJobs: () => true,
      drain,
      setIntervalFn
    });
    run();
    expect(drain).toHaveBeenCalledTimes(1);
    // A trava so cai no finally da promessa; espera ela ser liberada.
    await new Promise((resolve) => setImmediate(resolve));
    run();

    expect(drain).toHaveBeenCalledTimes(2);
  });

  it("reporta falha da drenagem sem derrubar o agendador", async () => {
    const error = new Error("OMIE fora do ar");
    const onError = vi.fn();
    const drain = vi.fn().mockRejectedValue(error);
    const { setIntervalFn, run } = captureTick();

    startOmieQueueDrainScheduler({
      hasRunnableJobs: () => true,
      drain,
      onError,
      setIntervalFn
    });
    run();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    await new Promise((resolve) => setImmediate(resolve));

    // O tick seguinte continua funcionando (a trava foi liberada no finally).
    run();
    expect(drain).toHaveBeenCalledTimes(2);
  });

  it("reporta falha da consulta local sem chamar a drenagem", () => {
    const error = new Error("banco ocupado");
    const onError = vi.fn();
    const drain = vi.fn().mockResolvedValue(undefined);
    const { setIntervalFn, run } = captureTick();

    startOmieQueueDrainScheduler({
      hasRunnableJobs: () => {
        throw error;
      },
      drain,
      onError,
      setIntervalFn
    });
    run();

    expect(drain).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error);
  });

  // A conferencia de faturamento anda no mesmo tique, mas com vida propria: ela nao
  // depende da fila ter job, e uma drenagem longa nao pode segurar a proxima conferencia.
  it("confere o faturamento mesmo com a fila vazia", () => {
    const drain = vi.fn().mockResolvedValue(undefined);
    const reconcileBilling = vi.fn().mockResolvedValue(undefined);
    const { setIntervalFn, run } = captureTick();

    startOmieQueueDrainScheduler({
      hasRunnableJobs: () => false,
      drain,
      reconcileBilling,
      setIntervalFn
    });
    run();

    expect(drain).not.toHaveBeenCalled();
    expect(reconcileBilling).toHaveBeenCalledTimes(1);
  });

  it("nao segura a conferencia atras de uma drenagem em andamento", async () => {
    // Drenagem que nunca termina: e o caso real de um OMIE lento com a fila cheia.
    const drain = vi.fn().mockReturnValue(new Promise<void>(() => undefined));
    const reconcileBilling = vi.fn().mockResolvedValue(undefined);
    const { setIntervalFn, run } = captureTick();

    startOmieQueueDrainScheduler({
      hasRunnableJobs: () => true,
      drain,
      reconcileBilling,
      setIntervalFn
    });
    run();
    await Promise.resolve();
    await Promise.resolve();
    run();

    // A drenagem segue travada na reentrancia; a conferencia anda no proprio ritmo.
    expect(drain).toHaveBeenCalledTimes(1);
    expect(reconcileBilling).toHaveBeenCalledTimes(2);
  });

  it("reporta falha da conferencia sem derrubar o agendador nem a drenagem", async () => {
    const drain = vi.fn().mockResolvedValue(undefined);
    const reconcileBilling = vi.fn().mockRejectedValue(new Error("OMIE fora do ar"));
    const onError = vi.fn();
    const { setIntervalFn, run } = captureTick();

    startOmieQueueDrainScheduler({
      hasRunnableJobs: () => true,
      drain,
      reconcileBilling,
      onError,
      setIntervalFn
    });
    run();
    await Promise.resolve();
    await Promise.resolve();

    expect(drain).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    // E o tique seguinte continua conferindo.
    run();
    expect(reconcileBilling).toHaveBeenCalledTimes(2);
  });

  it("para de agendar quando stop() e chamado", () => {
    const clearIntervalFn = vi.fn();
    const handle = startOmieQueueDrainScheduler({
      hasRunnableJobs: () => false,
      drain: vi.fn().mockResolvedValue(undefined),
      clearIntervalFn
    });

    handle.stop();
    expect(clearIntervalFn).toHaveBeenCalled();
  });

  it("tica mais rapido que o menor backoff da fila (60 s)", () => {
    expect(OMIE_QUEUE_DRAIN_INTERVAL_MS).toBeLessThan(60_000);
  });
});
