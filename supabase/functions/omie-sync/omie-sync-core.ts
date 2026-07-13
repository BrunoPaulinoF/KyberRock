export const OMIE_BASE_URL = "https://app.omie.com.br/api/v1";
export const OMIE_REQUEST_DELAY_MS = 3_000;
export const OMIE_MAX_RETRIES = 4;
export const OMIE_BASE_BACKOFF_MS = 5_000;
export const OMIE_DEFAULT_LIMIT_WAIT_MS = 60_000;
export const OMIE_MAX_BACKOFF_MS = 120_000;

export type OmieCredentials = {
  appKey: string;
  appSecret: string;
};

export type OmieQueueManagerOptions = {
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
  minDelayMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
};

export type OmieRequestInput<TParam> = {
  credentials: OmieCredentials;
  endpoint: string;
  call: string;
  param: TParam;
};

export type OmieRequester = Pick<OmieQueueManager, "request">;

export type PushCustomerPayload = {
  localCustomerId: string;
  omieCustomerId?: number;
  razaoSocial: string;
  nomeFantasia?: string;
  cnpjCpf?: string;
  email?: string;
  telefone1Ddd?: string;
  telefone1Numero?: string;
  zipcode?: string;
  addressStreet?: string;
  addressNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  defaultPaymentTermId?: string;
  tags?: string[];
};

export type PushCarrierPayload = Omit<PushCustomerPayload, "razaoSocial" | "nomeFantasia"> & {
  name: string;
  razaoSocial?: string;
  nomeFantasia?: string;
};

export class OmieHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly detail: string | null,
    readonly retryAfterMs: number | null
  ) {
    super(message);
    this.name = "OmieHttpError";
  }
}

export class OmieQueueManager {
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly nowFn: () => number;
  private readonly minDelayMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private gate: Promise<void> = Promise.resolve();
  private lastFinishedAt = 0;

  constructor(options: OmieQueueManagerOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepFn = options.sleepFn ?? sleep;
    this.nowFn = options.nowFn ?? Date.now;
    this.minDelayMs = options.minDelayMs ?? OMIE_REQUEST_DELAY_MS;
    this.maxRetries = options.maxRetries ?? OMIE_MAX_RETRIES;
    this.baseBackoffMs = options.baseBackoffMs ?? OMIE_BASE_BACKOFF_MS;
  }

  async request<TParam, TResponse>(input: OmieRequestInput<TParam>): Promise<TResponse> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.requestOnce<TParam, TResponse>(input);
      } catch (error) {
        if (!isOmieLimitError(error) || !(error instanceof OmieHttpError) || attempt >= this.maxRetries) {
          throw error;
        }
        const retryDelayMs = getRetryDelayMs(error, attempt, this.baseBackoffMs);
        await this.sleepFn(retryDelayMs);
      }
    }

    throw new Error(`OMIE retry esgotado em ${input.call} (${input.endpoint})`);
  }

  private async requestOnce<TParam, TResponse>(
    input: OmieRequestInput<TParam>
  ): Promise<TResponse> {
    const release = await this.acquireRequestSlot();
    let response: Response | null = null;
    let data: unknown = null;

    try {
      response = await this.fetchFn(`${OMIE_BASE_URL}${input.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call: input.call,
          param: [input.param],
          app_key: input.credentials.appKey,
          app_secret: input.credentials.appSecret
        })
      });
      data = await readOmieResponseBody(response);
    } finally {
      release();
    }

    if (!response) throw new Error(`Falha de transporte OMIE em ${input.call}`);

    const detail = getOmieFaultString(data);
    if (!response.ok || detail) {
      const retryAfterMs = parseOmieRetryDelayMs(detail, response.headers.get("retry-after"));
      const status = response.ok ? null : response.status;
      const statusText = response.ok ? "faultstring" : `HTTP ${response.status}`;
      // Diagnostico: registra a chamada, o erro e o corpo enviado (sem credenciais) para
      // depurar rejeicoes de campo obrigatorio do OMIE (ex: "tag [valor] obrigatorio").
      try {
        console.error(
          `[omie] falha em ${input.call} (${input.endpoint}) ${statusText}: ${detail ?? "sem detalhe"} | param=${JSON.stringify(input.param)}`
        );
      } catch {
        /* logging best-effort */
      }
      throw new OmieHttpError(
        `OMIE ${statusText} em ${input.call} (${input.endpoint})${detail ? ` - ${detail}` : ""}`,
        status,
        detail,
        retryAfterMs
      );
    }

    return data as TResponse;
  }

  private async acquireRequestSlot(): Promise<() => void> {
    let releaseSlot: () => void = () => undefined;
    const nextSlot = new Promise<void>((resolve) => {
      releaseSlot = resolve;
    });
    const previousSlot = this.gate;
    this.gate = previousSlot.then(() => nextSlot);
    await previousSlot;

    const elapsedMs = this.nowFn() - this.lastFinishedAt;
    if (this.lastFinishedAt > 0 && elapsedMs >= 0 && elapsedMs < this.minDelayMs) {
      await this.sleepFn(this.minDelayMs - elapsedMs);
    }

    return () => {
      this.lastFinishedAt = this.nowFn();
      releaseSlot();
    };
  }
}

// O OMIE rejeita codigos de integracao com caracteres especiais (hifens de UUID,
// ":" das chaves de idempotencia) — "caracteres especiais nao permitidos para um codigo".
// Esta funcao mapeia qualquer valor para um codigo aceito: mantem valores curtos que ja
// sao alfanumericos e, para o resto, deriva um hash estavel (mesma entrada => mesmo
// codigo, preservando a idempotencia no OMIE).
export const OMIE_INTEGRATION_CODE_MAX_LENGTH = 20;

export function toOmieIntegrationCode(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9]+$/.test(trimmed) && trimmed.length <= OMIE_INTEGRATION_CODE_MAX_LENGTH) {
    return trimmed;
  }
  return `KR${fnv1a64(trimmed).toString(36).toUpperCase()}`;
}

function fnv1a64(input: string): bigint {
  let hash = BigInt("14695981039346656037");
  const prime = BigInt("1099511628211");
  const mask = BigInt("0xFFFFFFFFFFFFFFFF");
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash;
}

export function buildCustomerPayload(payload: PushCustomerPayload): Record<string, unknown> {
  return {
    codigo_cliente_omie: payload.omieCustomerId,
    codigo_cliente_integracao: toOmieIntegrationCode(payload.localCustomerId),
    razao_social: payload.razaoSocial,
    nome_fantasia: payload.nomeFantasia,
    cnpj_cpf: payload.cnpjCpf,
    email: payload.email,
    telefone1_ddd: payload.telefone1Ddd,
    telefone1_numero: payload.telefone1Numero,
    endereco: payload.addressStreet,
    endereco_numero: payload.addressNumber,
    bairro: payload.neighborhood,
    cidade: payload.city,
    estado: payload.state,
    cep: payload.zipcode,
    tags: payload.tags?.map((tag) => ({ tag }))
  };
}

export function buildCarrierPayload(payload: PushCarrierPayload): Record<string, unknown> {
  const tags = forceOmieTag(payload.tags, "transportadora");
  return buildCustomerPayload({
    ...payload,
    localCustomerId: payload.localCustomerId,
    razaoSocial: payload.razaoSocial ?? payload.name,
    nomeFantasia: payload.nomeFantasia ?? payload.name,
    tags
  });
}

export async function pushCustomerToOmieCore(
  queue: OmieRequester,
  credentials: OmieCredentials,
  payload: PushCustomerPayload
): Promise<number> {
  return pushCustomerBodyToOmie(
    queue,
    credentials,
    buildCustomerPayload(payload),
    payload.omieCustomerId
  );
}

export async function pushCarrierToOmie(
  queue: OmieRequester,
  credentials: OmieCredentials,
  payload: PushCarrierPayload
): Promise<number> {
  return pushCustomerBodyToOmie(
    queue,
    credentials,
    buildCarrierPayload(payload),
    payload.omieCustomerId
  );
}

export function forceOmieTag(tags: string[] | undefined, requiredTag: string): string[] {
  const normalizedRequired = normalizeTag(requiredTag);
  const unique = new Map<string, string>();
  for (const tag of tags ?? []) {
    const normalized = normalizeTag(tag);
    if (normalized) unique.set(normalized, tag);
  }
  unique.set(normalizedRequired, requiredTag);
  return [...unique.values()];
}

export function isOmieLimitError(error: unknown): boolean {
  if (!(error instanceof OmieHttpError)) return false;
  if (error.status === 429) return true;
  return /REDUNDANT|Consumo redundante|limite|limit|rate|Aguarde\s+\d+\s+segundos?/i.test(
    error.detail ?? error.message
  );
}

export function parseOmieRetryDelayMs(
  message: string | null | undefined,
  retryAfterHeader?: string | null
): number | null {
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, OMIE_MAX_BACKOFF_MS);
  }

  const match = /Aguarde\s+(\d+)\s+segundos?/i.exec(message ?? "");
  const seconds = match ? Number(match[1]) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000 + 1000, OMIE_MAX_BACKOFF_MS);
  }

  return null;
}

function getRetryDelayMs(error: OmieHttpError, attempt: number, baseBackoffMs: number): number {
  return Math.min(error.retryAfterMs ?? baseBackoffMs * Math.pow(2, attempt), OMIE_MAX_BACKOFF_MS);
}

// Quando o CPF/CNPJ ja existe no OMIE, o IncluirCliente falha com
// "Cliente ja cadastrado para o CPF/CNPJ [...] com o Id [123] ...".
// Extraimos o Id existente para converter o insert em update.
export function extractExistingCustomerId(error: unknown): number | null {
  if (!(error instanceof OmieHttpError)) return null;
  const text = error.detail ?? error.message;
  if (!/j[aá] cadastrad/i.test(text)) return null;
  const match = /\bId\s*\[(\d+)\]/i.exec(text);
  return match ? Number(match[1]) : null;
}

// O AlterarCliente localiza o registro pelo codigo_cliente_integracao quando presente.
// Para cadastros adotados (criados fora do KyberRock) o codigo nao confere e o OMIE
// responde "Cliente nao cadastrado para o Codigo de Integracao [...]". Em updates,
// identificamos apenas pelo codigo_cliente_omie.
export function toCustomerUpdateBody(
  body: Record<string, unknown>,
  omieCustomerId: number
): Record<string, unknown> {
  const updateBody = { ...body, codigo_cliente_omie: omieCustomerId };
  delete updateBody.codigo_cliente_integracao;
  return updateBody;
}

async function pushCustomerBodyToOmie(
  queue: OmieRequester,
  credentials: OmieCredentials,
  body: Record<string, unknown>,
  omieCustomerId?: number
): Promise<number> {
  if (omieCustomerId) {
    await queue.request<unknown, unknown>({
      credentials,
      endpoint: "/geral/clientes/",
      call: "AlterarCliente",
      param: toCustomerUpdateBody(body, omieCustomerId)
    });
    return omieCustomerId;
  }

  let response: { codigo_cliente_omie?: number; codigoClienteOmie?: number };
  try {
    response = await queue.request<
      unknown,
      { codigo_cliente_omie?: number; codigoClienteOmie?: number }
    >({
      credentials,
      endpoint: "/geral/clientes/",
      call: "IncluirCliente",
      param: body
    });
  } catch (error) {
    const existingId = extractExistingCustomerId(error);
    if (existingId === null) throw error;
    await queue.request<unknown, unknown>({
      credentials,
      endpoint: "/geral/clientes/",
      call: "AlterarCliente",
      param: toCustomerUpdateBody(body, existingId)
    });
    return existingId;
  }
  const id = response.codigo_cliente_omie ?? response.codigoClienteOmie;
  if (!id) throw new Error("OMIE nao retornou codigoClienteOmie");
  return id;
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

function normalizeTag(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
