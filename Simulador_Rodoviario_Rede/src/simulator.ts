import { EventEmitter } from "node:events";
import { buildScaleFrame } from "./protocol.js";
import type {
  EventEntry,
  QuarryTruck,
  SimulatorConfig,
  SimulatorSnapshot,
  ScaleStatus
} from "./types.js";

type AutoPhase = "IDLE" | "ENTER_EMPTY" | "CAPTURE_TARE" | "LOADING" | "CAPTURE_GROSS" | "LEAVE";
type ManualOverrides = {
  stable?: boolean;
  motion?: boolean;
  overload?: boolean;
};
type SamplingKind = "tare" | "gross";
type SamplingState = {
  kind: SamplingKind;
  startedAt: number;
  durationMs: number;
  samples: number[];
  targetValue: number;
  callback: (mean: number) => void;
};

const MATERIALS = ["Brita 1", "Brita 2", "Po de pedra", "Areia media", "Rachao", "Bica corrida"];
const DRIVERS = [
  "Rafael Costa",
  "Marcos Silva",
  "Daniel Rocha",
  "Joao Batista",
  "Carlos Souza",
  "Renato Lima"
];
const COMPANIES = [
  "Pedreira Santa Rita",
  "Mineracao Toledo",
  "Concretos Vale",
  "TransBrita",
  "Obras Serra Azul"
];
const DESTINATIONS = [
  "Usina de concreto",
  "Obra rodoviaria",
  "Patio industrial",
  "Cliente externo",
  "Estoque interno"
];

export const DEFAULT_SAMPLE_DURATION_MS = 5000;
export const DEFAULT_SAMPLE_INTERVAL_MS = 200;

export class QuarryScaleSimulator extends EventEmitter {
  private snapshotState: SimulatorSnapshot;
  private autoPhase: AutoPhase = "IDLE";
  private manualOverrides: ManualOverrides = {};
  private phaseStartedAt = Date.now();
  private eventId = 0;
  private sampling: SamplingState | null = null;
  private nextSampleTickAt = 0;

  constructor(config: SimulatorConfig) {
    super();
    const now = new Date().toISOString();
    this.snapshotState = {
      sequence: 0,
      tcpHost: config.tcpHost,
      tcpPort: config.tcpPort,
      frameIntervalMs: config.frameIntervalMs,
      connectedClients: 0,
      autoMode: false,
      status: "IDLE",
      trafficLight: "GREEN",
      weightKg: 0,
      targetWeightKg: 0,
      grossKg: 0,
      tareKg: 0,
      netKg: 0,
      stable: true,
      motion: false,
      overload: false,
      negative: false,
      zeroed: true,
      tareActive: false,
      grossMode: true,
      netMode: false,
      capacityKg: config.capacityKg ?? 80000,
      currentTruck: null,
      lastFrame: "",
      updatedAt: now,
      events: [],
      samplingKind: null,
      samplingRemainingMs: 0,
      samplingSampleCount: 0
    };
    this.addEvent("info", "Simulador iniciado e aguardando conexoes TCP.");
    this.refreshFrame();
  }

  snapshot(): SimulatorSnapshot {
    return {
      ...this.snapshotState,
      currentTruck: this.snapshotState.currentTruck ? { ...this.snapshotState.currentTruck } : null,
      events: [...this.snapshotState.events]
    };
  }

  setClientCount(count: number): void {
    this.snapshotState.connectedClients = count;
    this.touch(false);
  }

  tick(): void {
    if (this.snapshotState.autoMode) {
      this.advanceAutoScenario();
    }

    this.moveWeightTowardsTarget();
    this.deriveWeightFields();
    this.advanceSampling();
    this.touch();
  }

  action(type: string, data: Record<string, unknown> = {}): SimulatorSnapshot {
    const keepsSampling = type === "tare" || type === "gross" || type === "exitTruck";
    if (!keepsSampling) {
      this.cancelSampling();
    }
    switch (type) {
      case "startAuto":
        this.clearManualOverrides();
        this.cancelSampling();
        this.snapshotState.autoMode = true;
        this.autoPhase = "IDLE";
        this.phaseStartedAt = Date.now();
        this.addEvent("info", "Modo automatico ativado.");
        break;
      case "stopAuto":
        this.snapshotState.autoMode = false;
        this.addEvent("info", "Modo automatico pausado.");
        break;
      case "newTruck":
        this.clearManualOverrides();
        this.cancelSampling();
        this.startTruckEntry(this.createTruck(data));
        break;
      case "loadTruck":
        this.clearManualOverrides();
        this.cancelSampling();
        this.startLoading();
        break;
      case "leaveScale":
        this.clearManualOverrides();
        this.cancelSampling();
        this.leaveScale();
        break;
      case "zero":
        this.clearManualOverrides();
        this.cancelSampling();
        this.zeroScale();
        break;
      case "tare":
        this.startTareSampling(data);
        break;
      case "gross":
        this.startGrossSampling(data);
        break;
      case "arriveTruck":
        this.clearManualOverrides();
        this.cancelSampling();
        this.startTruckEntry(this.createTruck(data));
        break;
      case "exitTruck":
        this.startExitSampling(data);
        break;
      case "manualSet":
        this.cancelSampling();
        this.applyManualSet(data);
        break;
      case "emergencyStop":
        this.clearManualOverrides();
        this.cancelSampling();
        this.snapshotState.autoMode = false;
        this.snapshotState.status = "ERROR";
        this.snapshotState.trafficLight = "RED";
        this.snapshotState.targetWeightKg = this.snapshotState.weightKg;
        this.addEvent("error", "Parada de emergencia acionada.");
        break;
      default:
        this.addEvent("warn", `Acao desconhecida ignorada: ${type}`);
        break;
    }

    this.deriveWeightFields();
    this.advanceSampling();
    this.touch();
    return this.snapshot();
  }

  isSampling(): boolean {
    return this.sampling !== null;
  }

  private advanceAutoScenario(): void {
    const elapsed = Date.now() - this.phaseStartedAt;

    if (this.autoPhase === "IDLE" && elapsed > 2500) {
      this.startTruckEntry(this.createTruck());
      this.autoPhase = "ENTER_EMPTY";
      this.phaseStartedAt = Date.now();
      return;
    }

    if (this.autoPhase === "ENTER_EMPTY" && elapsed > 4500 && this.snapshotState.stable) {
      this.autoPhase = "CAPTURE_TARE";
      this.snapshotState.status = "WEIGHING_EMPTY";
      this.startTareSampling({ durationMs: DEFAULT_SAMPLE_DURATION_MS });
      this.phaseStartedAt = Date.now();
      return;
    }

    if (this.autoPhase === "CAPTURE_TARE" && elapsed > 6800) {
      this.startLoading();
      this.autoPhase = "LOADING";
      this.phaseStartedAt = Date.now();
      return;
    }

    if (this.autoPhase === "LOADING" && elapsed > 7000 && this.snapshotState.stable) {
      this.autoPhase = "CAPTURE_GROSS";
      this.snapshotState.status = "WEIGHING_LOADED";
      this.snapshotState.trafficLight = "GREEN";
      this.addEvent(
        "info",
        `Peso bruto estabilizado: ${Math.round(this.snapshotState.weightKg)} kg.`
      );
      this.phaseStartedAt = Date.now();
      return;
    }

    if (this.autoPhase === "CAPTURE_GROSS" && elapsed > 3800) {
      this.leaveScale();
      this.autoPhase = "LEAVE";
      this.phaseStartedAt = Date.now();
      return;
    }

    if (this.autoPhase === "LEAVE" && elapsed > 4500 && this.snapshotState.stable) {
      this.snapshotState.currentTruck = null;
      this.snapshotState.tareKg = 0;
      this.snapshotState.status = "IDLE";
      this.snapshotState.trafficLight = "GREEN";
      this.autoPhase = "IDLE";
      this.phaseStartedAt = Date.now();
      this.addEvent("info", "Balanca livre para o proximo caminhao.");
    }
  }

  private startTruckEntry(truck: QuarryTruck): void {
    this.snapshotState.currentTruck = truck;
    this.snapshotState.status = "APPROACHING";
    this.snapshotState.trafficLight = "RED";
    this.snapshotState.targetWeightKg = truck.tareKg;
    this.snapshotState.weightKg = truck.tareKg;
    this.snapshotState.zeroed = false;
    this.addEvent("info", `Caminhao ${truck.plate} entrou na balanca para pesagem inicial.`);
  }

  private startLoading(): void {
    const truck = this.snapshotState.currentTruck ?? this.createTruck();
    this.snapshotState.currentTruck = truck;
    this.snapshotState.status = "LOADING";
    this.snapshotState.trafficLight = "RED";
    this.snapshotState.targetWeightKg = truck.plannedGrossKg;
    this.addEvent(
      "info",
      `Carregamento iniciado: ${truck.material}, liquido previsto ${truck.plannedNetKg} kg.`
    );
  }

  private leaveScale(): void {
    this.snapshotState.status = "LEAVING";
    this.snapshotState.trafficLight = "RED";
    this.snapshotState.targetWeightKg = 0;
    this.addEvent("info", "Caminhao liberado e saindo da plataforma.");
  }

  private zeroScale(): void {
    this.snapshotState.targetWeightKg = 0;
    this.snapshotState.weightKg = 0;
    this.snapshotState.tareKg = 0;
    this.snapshotState.currentTruck = null;
    this.snapshotState.status = "IDLE";
    this.snapshotState.trafficLight = "GREEN";
    this.snapshotState.zeroed = true;
    this.addEvent("info", "Balanca zerada manualmente.");
  }

  private startTareSampling(data: Record<string, unknown> = {}): void {
    const truck = this.snapshotState.currentTruck ?? this.createTruck(data);
    this.snapshotState.currentTruck = truck;
    this.snapshotState.status = "WEIGHING_EMPTY";
    this.snapshotState.trafficLight = "RED";
    this.snapshotState.targetWeightKg = truck.tareKg;
    this.beginSampling("tare", truck.tareKg, data, (mean) => this.applyTare(mean));
  }

  private startGrossSampling(data: Record<string, unknown> = {}): void {
    const truck = this.snapshotState.currentTruck ?? this.createTruck(data);
    this.snapshotState.currentTruck = truck;
    this.snapshotState.status = "WEIGHING_LOADED";
    this.snapshotState.trafficLight = "GREEN";
    this.snapshotState.targetWeightKg = truck.plannedGrossKg;
    this.beginSampling("gross", truck.plannedGrossKg, data, (mean) => this.applyGross(mean));
  }

  private startExitSampling(data: Record<string, unknown> = {}): void {
    const truck = this.snapshotState.currentTruck ?? this.createTruck(data);
    this.snapshotState.currentTruck = truck;
    this.snapshotState.status = "WEIGHING_LOADED";
    this.snapshotState.trafficLight = "GREEN";
    this.snapshotState.targetWeightKg = truck.plannedGrossKg;
    this.beginSampling("gross", truck.plannedGrossKg, data, (mean) => {
      this.applyGross(mean);
      this.snapshotState.status = "LEAVING";
      this.snapshotState.trafficLight = "RED";
      this.snapshotState.targetWeightKg = 0;
      this.addEvent("info", "Caminhao liberado e saindo da plataforma.");
    });
  }

  private beginSampling(
    kind: SamplingKind,
    targetValue: number,
    data: Record<string, unknown>,
    callback: (mean: number) => void
  ): void {
    const durationMs =
      numberFromAny(data.durationMs ?? data.duration) ?? DEFAULT_SAMPLE_DURATION_MS;
    const intervalMs = numberFromAny(data.intervalMs) ?? DEFAULT_SAMPLE_INTERVAL_MS;
    this.sampling = {
      kind,
      startedAt: Date.now(),
      durationMs: Math.max(500, durationMs),
      samples: [],
      targetValue,
      callback
    };
    this.nextSampleTickAt = Date.now();
    this.snapshotState.samplingKind = kind;
    this.snapshotState.samplingRemainingMs = this.sampling.durationMs;
    this.snapshotState.samplingSampleCount = 0;
    this.addEvent(
      "info",
      `Amostragem de ${kind === "tare" ? "tara" : "peso bruto"} iniciada (${this.sampling.durationMs} ms).`
    );
    if (intervalMs > 0) {
      // placeholder; advanceSampling decide o intervalo real
    }
  }

  private advanceSampling(): void {
    if (!this.sampling) {
      this.snapshotState.samplingKind = null;
      this.snapshotState.samplingRemainingMs = 0;
      this.snapshotState.samplingSampleCount = 0;
      return;
    }
    const now = Date.now();
    const elapsed = now - this.sampling.startedAt;
    this.snapshotState.samplingRemainingMs = Math.max(0, this.sampling.durationMs - elapsed);
    this.snapshotState.samplingSampleCount = this.sampling.samples.length;

    if (now >= this.nextSampleTickAt) {
      this.sampling.samples.push(this.snapshotState.weightKg);
      this.nextSampleTickAt = now + DEFAULT_SAMPLE_INTERVAL_MS;
      this.snapshotState.samplingSampleCount = this.sampling.samples.length;
    }

    if (elapsed >= this.sampling.durationMs) {
      const mean = meanOf(
        this.sampling.samples.length ? this.sampling.samples : [this.sampling.targetValue]
      );
      const kind = this.sampling.kind;
      const callback = this.sampling.callback;
      this.sampling = null;
      this.snapshotState.samplingKind = null;
      this.snapshotState.samplingRemainingMs = 0;
      this.snapshotState.samplingSampleCount = 0;
      callback(mean);
      this.addEvent(
        "info",
        `Amostragem de ${kind === "tare" ? "tara" : "peso bruto"} concluida: media ${Math.round(mean)} kg em ${this.snapshotState.samplingSampleCount} amostras.`
      );
    }
  }

  private cancelSampling(): void {
    if (!this.sampling) return;
    this.sampling = null;
    this.snapshotState.samplingKind = null;
    this.snapshotState.samplingRemainingMs = 0;
    this.snapshotState.samplingSampleCount = 0;
  }

  private applyTare(mean: number): void {
    const tare = Math.max(0, Math.round(mean));
    this.snapshotState.tareKg = tare;
    if (this.snapshotState.currentTruck) {
      this.snapshotState.currentTruck.tareKg = tare;
      this.snapshotState.currentTruck.plannedNetKg = Math.max(
        0,
        this.snapshotState.currentTruck.plannedGrossKg - tare
      );
    }
    this.snapshotState.status = "IDLE";
    this.snapshotState.trafficLight = "GREEN";
    this.addEvent("info", `Tara capturada (media 5s): ${tare} kg.`);
  }

  private applyGross(mean: number): void {
    const gross = Math.max(0, Math.round(mean));
    if (this.snapshotState.currentTruck) {
      this.snapshotState.currentTruck.plannedGrossKg = gross;
      this.snapshotState.currentTruck.plannedNetKg = Math.max(
        0,
        gross - this.snapshotState.currentTruck.tareKg
      );
    }
    this.addEvent("info", `Peso bruto capturado (media 5s): ${gross} kg.`);
  }

  private applyManualSet(data: Record<string, unknown>): void {
    const weight = numberFromAny(data.weight ?? data.wt ?? data.peso);
    const target = numberFromAny(data.target ?? data.targetWeightKg ?? data.alvo);
    const tare = numberFromAny(data.tare ?? data.tr ?? data.tara);
    const stableRaw = data.stable ?? data.estavel;
    const motionRaw = data.motion ?? data.movimento;
    const overloadRaw = data.overload ?? data.ol ?? data.sobrecarga;
    const stable = booleanFromAny(stableRaw);
    const motion = booleanFromAny(motionRaw);
    const overload = booleanFromAny(overloadRaw);
    const plate = stringFromAny(data.plate ?? data.pl ?? data.placa);
    const material = stringFromAny(data.material ?? data.mat);

    if (typeof weight === "number") {
      this.snapshotState.weightKg = clamp(weight, -9999, this.snapshotState.capacityKg + 5000);
      this.snapshotState.targetWeightKg = this.snapshotState.weightKg;
    }

    if (typeof target === "number") {
      this.snapshotState.targetWeightKg = clamp(
        target,
        -9999,
        this.snapshotState.capacityKg + 5000
      );
    }

    if (typeof tare === "number") {
      this.snapshotState.tareKg = Math.max(0, Math.round(tare));
    }

    if (isAutoValue(stableRaw) || isAutoValue(motionRaw)) {
      delete this.manualOverrides.stable;
      delete this.manualOverrides.motion;
    }

    if (typeof stable === "boolean") {
      this.manualOverrides.stable = stable;
      if (typeof motion !== "boolean") this.manualOverrides.motion = !stable;
    }

    if (typeof motion === "boolean") {
      this.manualOverrides.motion = motion;
      if (typeof stable !== "boolean") this.manualOverrides.stable = !motion;
    }

    if (isAutoValue(overloadRaw)) {
      delete this.manualOverrides.overload;
    } else if (typeof overload === "boolean") {
      this.manualOverrides.overload = overload;
    }

    if (plate || material) {
      const truck = this.snapshotState.currentTruck ?? this.createTruck();
      if (plate) truck.plate = plate.toUpperCase().slice(0, 12);
      if (material) truck.material = material.slice(0, 32);
      this.snapshotState.currentTruck = truck;
    }

    this.applyManualMotionOverrides();

    this.snapshotState.autoMode = false;
    this.snapshotState.status = this.snapshotState.weightKg > 100 ? "WEIGHING_LOADED" : "IDLE";
    this.snapshotState.trafficLight = this.snapshotState.status === "IDLE" ? "GREEN" : "RED";
    this.addEvent("info", "Valores manuais aplicados pela interface/API.");
  }

  private moveWeightTowardsTarget(): void {
    const distance = this.snapshotState.targetWeightKg - this.snapshotState.weightKg;
    const moving = Math.abs(distance) > 25;

    if (moving) {
      // Convergencia em aprox. 3s a 30 ticks/segundo -> passo ~33% da distancia por tick.
      const step = clamp(distance * 0.33, -3000, 3000);
      const vibration = randomBetween(-25, 25);
      this.snapshotState.weightKg += step + vibration;
      this.snapshotState.motion = true;
      this.snapshotState.stable = false;
    } else {
      const noise =
        this.snapshotState.status === "IDLE" ? randomBetween(-2, 2) : randomBetween(-6, 6);
      this.snapshotState.weightKg = this.snapshotState.targetWeightKg + noise;
      this.snapshotState.motion = false;
      this.snapshotState.stable = true;
    }

    this.applyManualMotionOverrides();

    if (Math.abs(this.snapshotState.weightKg) < 5 && this.snapshotState.targetWeightKg === 0) {
      this.snapshotState.weightKg = 0;
      this.snapshotState.zeroed = true;
    } else {
      this.snapshotState.zeroed = false;
    }
  }

  private deriveWeightFields(): void {
    const roundedWeight = Math.round(this.snapshotState.weightKg);
    const gross = Math.max(0, roundedWeight);
    this.snapshotState.grossKg = gross;
    this.snapshotState.netKg = Math.max(0, gross - this.snapshotState.tareKg);
    this.snapshotState.negative = roundedWeight < 0;
    this.snapshotState.zeroed =
      Math.abs(roundedWeight) < 5 && this.snapshotState.targetWeightKg === 0;
    this.snapshotState.tareActive = this.snapshotState.tareKg > 0;
    this.snapshotState.grossMode = !this.snapshotState.tareActive;
    this.snapshotState.netMode = this.snapshotState.tareActive;
    this.snapshotState.overload =
      this.manualOverrides.overload ?? gross > this.snapshotState.capacityKg;
  }

  private clearManualOverrides(): void {
    this.manualOverrides = {};
  }

  private applyManualMotionOverrides(): void {
    if (typeof this.manualOverrides.stable === "boolean") {
      this.snapshotState.stable = this.manualOverrides.stable;
    }

    if (typeof this.manualOverrides.motion === "boolean") {
      this.snapshotState.motion = this.manualOverrides.motion;
    }
  }

  private createTruck(data: Record<string, unknown> = {}): QuarryTruck {
    const tareKg = Math.round(
      numberFromAny(data.tareKg ?? data.tare) ?? randomBetween(12800, 19200)
    );
    const plannedNetKg = Math.round(
      numberFromAny(data.netKg ?? data.net) ?? randomBetween(18500, 36500)
    );
    const plannedGrossKg = tareKg + plannedNetKg;
    return {
      plate: stringFromAny(data.plate ?? data.placa) ?? randomPlate(),
      driver: stringFromAny(data.driver) ?? pick(DRIVERS),
      company: stringFromAny(data.company) ?? pick(COMPANIES),
      material: stringFromAny(data.material ?? data.mat) ?? pick(MATERIALS),
      origin: "Pedreira Principal",
      destination: stringFromAny(data.destination) ?? pick(DESTINATIONS),
      axleCount: Math.round(numberFromAny(data.axleCount) ?? pick([3, 4, 5, 6])),
      tareKg,
      plannedGrossKg,
      plannedNetKg
    };
  }

  private addEvent(level: EventEntry["level"], text: string): void {
    this.snapshotState.events = [
      {
        id: ++this.eventId,
        at: new Date().toISOString(),
        level,
        text
      },
      ...this.snapshotState.events
    ].slice(0, 60);
  }

  private touch(emitChange = true): void {
    this.snapshotState.updatedAt = new Date().toISOString();
    this.refreshFrame();
    if (emitChange) this.emit("change", this.snapshot());
  }

  private refreshFrame(): void {
    this.snapshotState.sequence += 1;
    this.snapshotState.lastFrame = buildScaleFrame(this.snapshotState);
  }
}

function meanOf(values: number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function randomPlate(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  return `${pickChars(letters, 3)}${pickChars(digits, 1)}${pickChars(letters, 1)}${pickChars(digits, 2)}`;
}

function pickChars(chars: string, count: number): string {
  let out = "";
  for (let i = 0; i < count; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numberFromAny(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function booleanFromAny(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "sim", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "nao", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

function isAutoValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "auto";
}

function stringFromAny(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
