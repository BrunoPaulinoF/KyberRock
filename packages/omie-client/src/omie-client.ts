import { OMIE_BASE_URL } from "./constants.js";
import { createOmieRequestBody, type OmieRequestBody } from "./omie-request.js";

export interface OmieClientConfig {
  appKey: string;
  appSecret: string;
  baseUrl?: string;
}

const OMIE_REDUNDANT_MAX_RETRIES = 2;
const OMIE_REDUNDANT_DEFAULT_WAIT_MS = 60_000;
const OMIE_REDUNDANT_MAX_WAIT_MS = 65_000;

export interface OmieAuthBody<TParam> extends OmieRequestBody<TParam> {
  app_key: string;
  app_secret: string;
}

export class OmieClient {
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;

  constructor(config: OmieClientConfig) {
    if (!config.appKey?.trim() || !config.appSecret?.trim()) {
      throw new Error("OMIE appKey and appSecret are required");
    }
    this.appKey = config.appKey;
    this.appSecret = config.appSecret;
    this.baseUrl = config.baseUrl?.trim() || OMIE_BASE_URL;
  }

  createAuthBody<TParam>(call: string, param: TParam): OmieAuthBody<TParam> {
    const body = createOmieRequestBody(call, param);
    return {
      ...body,
      app_key: this.appKey,
      app_secret: this.appSecret
    };
  }

  async call<TParam, TResponse>(endpoint: string, call: string, param: TParam): Promise<TResponse> {
    const body = this.createAuthBody(call, param);

    for (let attempt = 0; attempt <= OMIE_REDUNDANT_MAX_RETRIES; attempt++) {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const data = await readOmieResponseBody(response);

      if (!response.ok) {
        const detail = getOmieFaultString(data);
        if (detail && isRedundantOmieError(detail) && attempt < OMIE_REDUNDANT_MAX_RETRIES) {
          await sleep(parseRedundantWaitMs(detail));
          continue;
        }
        const suffix = detail ? ` - ${detail}` : "";
        throw new Error(`OMIE HTTP ${response.status}: ${response.statusText}${suffix}`);
      }

      const detail = getOmieFaultString(data);
      if (detail) {
        if (isRedundantOmieError(detail) && attempt < OMIE_REDUNDANT_MAX_RETRIES) {
          await sleep(parseRedundantWaitMs(detail));
          continue;
        }
        throw new Error(`OMIE faultstring em ${call} (${endpoint}): ${detail}`);
      }

      return data as TResponse;
    }

    throw new Error(`OMIE redundant retry exhausted em ${call} (${endpoint})`);
  }
}

async function readOmieResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getOmieFaultString(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("faultstring" in data)) return null;
  return String((data as { faultstring?: unknown }).faultstring ?? "Falha OMIE");
}

function isRedundantOmieError(message: string): boolean {
  return /REDUNDANT|Consumo redundante/i.test(message);
}

function parseRedundantWaitMs(message: string): number {
  const match = /Aguarde\s+(\d+)\s+segundos?/i.exec(message);
  const seconds = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return OMIE_REDUNDANT_DEFAULT_WAIT_MS;
  return Math.min(seconds * 1000 + 1000, OMIE_REDUNDANT_MAX_WAIT_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
