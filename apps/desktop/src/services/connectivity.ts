import { supabaseConfig } from "../config/supabase-config.js";

const DEFAULT_PROBE_TIMEOUT_MS = 4_000;
const DEFAULT_INTL_TARGETS = ["https://1.1.1.1", "https://www.cloudflare.com"];

export interface ConnectivityProbeOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  fetchInit?: RequestInit;
}

export interface ConnectivityProbeResult {
  online: boolean;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

export async function probeInternet(
  options: ConnectivityProbeOptions = {}
): Promise<ConnectivityProbeResult> {
  return probeWithFallback(options, DEFAULT_INTL_TARGETS);
}

export async function probeSupabase(
  options: ConnectivityProbeOptions = {}
): Promise<ConnectivityProbeResult> {
  const url = supabaseConfig.url?.trim();
  if (!url) {
    return {
      online: false,
      latencyMs: null,
      error: "SUPABASE_URL nao configurada.",
      checkedAt: new Date().toISOString()
    };
  }
  return probeSingleUrl(`${url.replace(/\/+$/, "")}/auth/v1/health`, options);
}

export async function probeOmie(
  options: ConnectivityProbeOptions = {}
): Promise<ConnectivityProbeResult> {
  return probeSingleUrl("https://app.omie.com.br", options);
}

async function probeWithFallback(
  options: ConnectivityProbeOptions,
  urls: string[]
): Promise<ConnectivityProbeResult> {
  const errors: string[] = [];
  for (const url of urls) {
    const result = await probeSingleUrl(url, options);
    if (result.online) {
      return result;
    }
    if (result.error) {
      errors.push(result.error);
    }
  }
  return {
    online: false,
    latencyMs: null,
    error: errors.length > 0 ? errors.join(" | ") : "Sem conectividade",
    checkedAt: new Date().toISOString()
  };
}

async function probeSingleUrl(
  url: string,
  options: ConnectivityProbeOptions
): Promise<ConnectivityProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = now();
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      ...(options.fetchInit ?? {})
    });
    if (!response.ok && response.status >= 500) {
      return {
        online: false,
        latencyMs: now() - startedAt,
        error: `HTTP ${response.status}`,
        checkedAt: new Date().toISOString()
      };
    }
    return {
      online: true,
      latencyMs: now() - startedAt,
      error: null,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      online: false,
      latencyMs: now() - startedAt,
      error: message,
      checkedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
