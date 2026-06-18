import { EventEmitter } from "node:events";
import {
  applyMean,
  createInitialSnapshot,
  deriveFlags,
  type ScaleSnapshot
} from "./state/derive.js";
import type { Phase } from "./state/scale-state.js";

/**
 * Comportamento do simulador:
 *  1. arriveEmpty(): caminhao chega vazio -> peso alvo = tara
 *  2. startTareSample(): tira a media de 5s e grava como tara
 *  3. startLoading(): carro e carregado -> peso alvo = bruto
 *  4. startGrossSample(): tira a media de 5s e grava como peso bruto
 *  5. leave(): caminhao sai da plataforma
 *
 * Apos a conclusao de cada sample, snapshot.pendingMean contem o valor
 * que sera persistido; meanApplied emite "sample" para o servidor TCP
 * reenviar a media como frame Toledo.
 */
type SamplingKind = "tare" | "gross";
type Sampling = {
  kind: SamplingKind;
  startedAt: number;
  durationMs: number;
  samples: number[];
};

export class ScaleSimulator extends EventEmitter {
  private state: ScaleSnapshot;
  private targetWeightKg = 0;
  private sampling: Sampling | null = null;
  private nextSampleTickAt = 0;
  private nextMovementTickAt = 0;

  constructor(capacityKg = 80000, sampleWindowMs = 5000) {
    super();
    this.state = createInitialSnapshot(capacityKg, sampleWindowMs);
  }

  snapshot(): ScaleSnapshot {
    return { ...this.state };
  }

  setSampleWindowMs(windowMs: number): void {
    if (windowMs < 500 || !Number.isFinite(windowMs)) return;
    this.state = { ...this.state, sampleWindowMs: windowMs };
    this.emit("change", this.snapshot());
  }

  /** Define o peso bruto que a celula de carga mostra neste momento. */
  setWeight(weightKg: number): void {
    this.state = deriveFlags({ ...this.state, weightKg, sequence: this.state.sequence + 1 });
    this.emit("change", this.snapshot());
  }

  /** Ajusta a tara manualmente (sem amostragem). */
  setTare(tareKg: number): void {
    this.state = deriveFlags({ ...this.state, tareKg, sequence: this.state.sequence + 1 });
    this.emit("change", this.snapshot());
  }

  /** Zera a balanca (peso e tara em zero). */
  zero(): void {
    this.cancelSampling();
    this.targetWeightKg = 0;
    this.state = deriveFlags({
      ...this.state,
      phase: "IDLE",
      weightKg: 0,
      tareKg: 0,
      motion: false,
      sequence: this.state.sequence + 1
    });
    this.emit("change", this.snapshot());
  }

  /** Caminhao chega vazio para pesagem inicial (tara). */
  arriveEmpty(tareHintKg?: number): void {
    this.cancelSampling();
    this.state = deriveFlags({
      ...this.state,
      phase: "TARING",
      tareKg: Math.max(0, Math.round(tareHintKg ?? 0)),
      sequence: this.state.sequence + 1
    });
    this.targetWeightKg = Math.max(0, Math.round(tareHintKg ?? 0));
    this.emit("change", this.snapshot());
  }

  /** Carrega o caminhao (passa a apontar para o peso bruto). */
  startLoading(grossHintKg?: number): void {
    this.cancelSampling();
    this.state = deriveFlags({
      ...this.state,
      phase: "LOADING",
      sequence: this.state.sequence + 1
    });
    this.targetWeightKg = Math.max(0, Math.round(grossHintKg ?? 0));
    this.emit("change", this.snapshot());
  }

  /** Inicia a amostragem da tara (5s) - chamada manual pela UI. */
  startTareSample(): void {
    if (this.state.phase !== "TARING") return;
    this.beginSampling("tare");
  }

  /** Inicia a amostragem do peso bruto (5s) - chamada manual pela UI. */
  startGrossSample(): void {
    if (this.state.phase !== "LOADING") return;
    this.beginSampling("gross");
  }

  /** Sai da plataforma, zera peso, libera tara (ciclo completo). */
  leave(): void {
    this.cancelSampling();
    this.targetWeightKg = 0;
    this.state = deriveFlags({
      ...this.state,
      phase: "RELEASED",
      weightKg: 0,
      tareKg: 0,
      motion: false,
      sequence: this.state.sequence + 1
    });
    this.emit("change", this.snapshot());
  }

  /** Acionado periodicamente pelo servidor para avancar o tempo. */
  tick(): void {
    if (this.sampling) {
      this.advanceSampling();
    } else {
      this.advanceMovement();
    }
    this.state = {
      ...this.state,
      sequence: this.state.sequence + 1,
      updatedAt: new Date().toISOString()
    };
    this.emit("change", this.snapshot());
  }

  private beginSampling(kind: SamplingKind): void {
    this.sampling = {
      kind,
      startedAt: Date.now(),
      durationMs: this.state.sampleWindowMs,
      samples: []
    };
    this.nextSampleTickAt = Date.now() + 200;
  }

  private advanceMovement(): void {
    const now = Date.now();
    if (now < this.nextMovementTickAt) return;
    this.nextMovementTickAt = now + 250;
    const distance = this.targetWeightKg - this.state.weightKg;
    const moving = Math.abs(distance) > 5;
    let nextWeight = this.state.weightKg;
    if (moving) {
      const step = Math.sign(distance) * Math.min(Math.abs(distance) * 0.33, 3000);
      const noise = (Math.random() - 0.5) * 50;
      nextWeight = this.state.weightKg + step + noise;
    } else {
      const noise = (Math.random() - 0.5) * (this.state.phase === "IDLE" ? 4 : 10);
      nextWeight = this.targetWeightKg + noise;
    }
    this.state = deriveFlags({
      ...this.state,
      weightKg: nextWeight,
      motion: moving
    });
  }

  private advanceSampling(): void {
    if (!this.sampling) return;
    const now = Date.now();
    const elapsed = now - this.sampling.startedAt;
    if (now >= this.nextSampleTickAt) {
      this.sampling.samples.push(this.state.weightKg);
      this.nextSampleTickAt = now + 200;
    }
    if (elapsed < this.sampling.durationMs) return;

    const samples =
      this.sampling.samples.length > 0 ? this.sampling.samples : [this.state.weightKg];
    const mean = samples.reduce((sum, s) => sum + s, 0) / samples.length;
    const kind = this.sampling.kind;
    this.sampling = null;

    if (kind === "tare") {
      this.state = applyMean(this.state, mean, false);
      this.state = {
        ...this.state,
        phase: "TARE_DONE",
        motion: false
      };
    } else {
      this.state = applyMean(this.state, mean, true);
      this.state = {
        ...this.state,
        phase: "WEIGHING_LOADED",
        motion: false
      };
    }
    this.emit("sample", { kind, mean, snapshot: this.snapshot() });
  }

  private cancelSampling(): void {
    this.sampling = null;
    if (this.state.phase === "TARING" || this.state.phase === "LOADING") {
      this.state = { ...this.state, motion: false };
    }
  }

  isSampling(): boolean {
    return this.sampling !== null;
  }

  phase(): Phase {
    return this.state.phase;
  }
}
