export type ScaleStatus =
  | "IDLE"
  | "APPROACHING"
  | "WEIGHING_EMPTY"
  | "LOADING"
  | "WEIGHING_LOADED"
  | "LEAVING"
  | "ERROR";

export type TrafficLight = "RED" | "GREEN";
export type EventLevel = "info" | "warn" | "error";

export interface QuarryTruck {
  plate: string;
  driver: string;
  company: string;
  material: string;
  origin: string;
  destination: string;
  axleCount: number;
  tareKg: number;
  plannedGrossKg: number;
  plannedNetKg: number;
}

export interface EventEntry {
  id: number;
  at: string;
  level: EventLevel;
  text: string;
}

export interface SimulatorSnapshot {
  sequence: number;
  tcpHost: string;
  tcpPort: number;
  frameIntervalMs: number;
  connectedClients: number;
  autoMode: boolean;
  status: ScaleStatus;
  trafficLight: TrafficLight;
  weightKg: number;
  targetWeightKg: number;
  grossKg: number;
  tareKg: number;
  netKg: number;
  stable: boolean;
  motion: boolean;
  overload: boolean;
  negative: boolean;
  zeroed: boolean;
  tareActive: boolean;
  grossMode: boolean;
  netMode: boolean;
  capacityKg: number;
  currentTruck: QuarryTruck | null;
  lastFrame: string;
  updatedAt: string;
  events: EventEntry[];
}

export interface SimulatorConfig {
  tcpHost: string;
  tcpPort: number;
  frameIntervalMs: number;
  capacityKg?: number;
}
