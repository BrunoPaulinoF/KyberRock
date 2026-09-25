/**
 * Diario de erros DESTE navegador, para a tela Logs (perfil administrador) e para o "Copiar
 * relatorio para o suporte". O site nao tem servidor de log proprio: o que da errado na tela
 * (chamada a `web-api` recusada, erro de script, promessa rejeitada sem tratamento) so existia
 * no console de quem estava usando — e o suporte descobria por telefone, sem mensagem nenhuma.
 *
 * Regras:
 *   - anel dos ultimos 100 registros, guardado no `localStorage` (`kr-error-log-v1`) para
 *     sobreviver a um recarregar de pagina — que e justamente o que o usuario faz quando algo
 *     trava;
 *   - TODO acesso ao armazenamento fica em try/catch e a leitura e validada: aba anonima,
 *     cota estourada ou JSON corrompido nunca derrubam o site, so fazem o diario valer ate
 *     fechar a aba (memoria);
 *   - mensagem e detalhe sao cortados (500 / 2000 caracteres) e senha NUNCA e gravada: chave
 *     com cara de senha/token num detalhe tem o valor trocado por `[oculto]` antes de guardar.
 */

export type ErrorLogSource = "api" | "window" | "promise" | "app";

export interface ErrorLogEntry {
  /** Instante ISO em que o erro foi registrado. */
  at: string;
  source: ErrorLogSource;
  message: string;
  detail?: string;
  /** Tela em que aconteceu (`location.pathname`). */
  path?: string;
}

export type NewErrorLogEntry = Omit<ErrorLogEntry, "at">;

export const ERROR_LOG_KEY = "kr-error-log-v1";
export const ERROR_LOG_LIMIT = 100;
export const ERROR_MESSAGE_MAX = 500;
export const ERROR_DETAIL_MAX = 2000;
const PATH_MAX = 300;
const REDACTED = "[oculto]";

const SOURCES: readonly ErrorLogSource[] = ["api", "window", "promise", "app"];

/** O pedaco do `Storage` que o diario usa — injetavel para teste e para navegador sem storage. */
export interface ErrorLogStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ErrorLogListener = (entries: ErrorLogEntry[]) => void;

// ---------------------------------------------------------------------------
// Texto: corte e mascara de segredo
// ---------------------------------------------------------------------------

/** Nome de chave que pode carregar segredo (senha, senha de preco, token, chave de API...). */
const SECRET_KEY =
  "[A-Za-z0-9_.-]*(?:password|passwd|senha|pwd|secret|token|api[_-]?key|authorization)[A-Za-z0-9_.-]*";
/** `"senha": "123"` / `"password": 123` */
const JSON_SECRET = new RegExp(
  `("${SECRET_KEY}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^,}\\]\\s]+)`,
  "gi"
);
/** O mesmo JSON escapado dentro de outra string: `\"senha\":\"123\"`. */
const ESCAPED_JSON_SECRET = new RegExp(
  `(\\\\"${SECRET_KEY}\\\\"\\s*:\\s*)(\\\\"(?:(?!\\\\").)*\\\\"|[^,}\\]\\s\\\\]+)`,
  "gi"
);
/** `senha=123`, `token: abc` (query string, texto solto). */
const PLAIN_SECRET = new RegExp(`(\\b${SECRET_KEY}\\s*[=:]\\s*)([^\\s&,;"'}\\]]+)`, "gi");
/** Credencial reconhecivel pela FORMA, com ou sem chave antes: `Bearer ...` e JWT. */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g;

/**
 * Troca por `[oculto]` o VALOR de toda chave com cara de senha/token: JSON (`"senha": "123"`),
 * JSON escapado dentro de outra string (`\"password\":\"123\"`) e `chave=valor` /
 * `chave: valor` — alem de `Bearer <token>` e de JWT soltos. Mascarar demais (um
 * `requiresPricePassword: true`) nao custa nada; gravar uma senha no navegador e manda-la no
 * relatorio do suporte custa caro.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(JSON_SECRET, (_match, key: string) => `${key}"${REDACTED}"`)
    .replace(ESCAPED_JSON_SECRET, (_match, key: string) => `${key}\\"${REDACTED}\\"`)
    .replace(PLAIN_SECRET, (_match, key: string) => `${key}${REDACTED}`);
}

/** Corta com reticencias, sem passar do limite. */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return truncateText(redactSecrets(trimmed), max);
}

/** Texto legivel de qualquer coisa que foi lancada (`throw "x"`, `reject({ ... })`, Error). */
export function describeThrown(value: unknown): { message: string; detail?: string } {
  if (value instanceof Error) {
    const message = value.message || value.name || "Erro sem mensagem";
    const stack = typeof value.stack === "string" ? value.stack : undefined;
    return { message, detail: stack && stack !== message ? stack : undefined };
  }
  if (typeof value === "string") return { message: value || "Erro sem mensagem" };
  if (value === undefined || value === null) return { message: "Erro sem mensagem" };
  try {
    const json = JSON.stringify(value);
    if (json && json !== "{}") return { message: truncateText(json, ERROR_MESSAGE_MAX) };
  } catch {
    // Objeto circular: cai no String() abaixo.
  }
  return { message: String(value) };
}

// ---------------------------------------------------------------------------
// Validacao da leitura
// ---------------------------------------------------------------------------

function isSource(value: unknown): value is ErrorLogSource {
  return typeof value === "string" && (SOURCES as readonly string[]).includes(value);
}

/** Uma entrada gravada, se ela for valida; qualquer coisa estranha e descartada. */
function toEntry(value: unknown): ErrorLogEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.at !== "string" || Number.isNaN(Date.parse(record.at))) return null;
  if (!isSource(record.source)) return null;
  if (typeof record.message !== "string") return null;
  const entry: ErrorLogEntry = {
    at: record.at,
    source: record.source,
    message: truncateText(record.message, ERROR_MESSAGE_MAX)
  };
  if (typeof record.detail === "string" && record.detail) {
    entry.detail = truncateText(record.detail, ERROR_DETAIL_MAX);
  }
  if (typeof record.path === "string" && record.path) {
    entry.path = truncateText(record.path, PATH_MAX);
  }
  return entry;
}

/** Le o JSON gravado (do mais antigo ao mais novo). `null` quando nao ha nada valido. */
export function parseErrorLog(raw: string | null): ErrorLogEntry[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const entries: ErrorLogEntry[] = [];
  for (const item of parsed) {
    const entry = toEntry(item);
    if (entry) entries.push(entry);
  }
  return entries.slice(-ERROR_LOG_LIMIT);
}

// ---------------------------------------------------------------------------
// O diario
// ---------------------------------------------------------------------------

export interface ErrorLog {
  record(entry: NewErrorLogEntry): ErrorLogEntry;
  /** Mais novo primeiro. */
  read(): ErrorLogEntry[];
  clear(): void;
  subscribe(listener: ErrorLogListener): () => void;
  /** Avisa os inscritos de novo (outra aba gravou no mesmo storage). */
  refresh(): void;
}

export interface ErrorLogOptions {
  /** Devolve o storage da vez (ou `null`); chamado a cada acesso, sempre dentro de try/catch. */
  storage?: () => ErrorLogStorage | null;
  now?: () => Date;
  limit?: number;
}

function browserStorage(): ErrorLogStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    // Acessar `window.localStorage` ja estoura em navegador com cookies bloqueados.
    return null;
  }
}

export function createErrorLog(options: ErrorLogOptions = {}): ErrorLog {
  const getStorage = options.storage ?? browserStorage;
  const now = options.now ?? (() => new Date());
  const limit = options.limit ?? ERROR_LOG_LIMIT;
  const listeners = new Set<ErrorLogListener>();
  // O que vale quando o storage nao responde (aba anonima, cota, bloqueio).
  let memory: ErrorLogEntry[] = [];
  // A ultima gravacao chegou ao storage? Enquanto sim, ele e a verdade (outra aba pode ter
  // gravado ou limpado); quando uma escrita falha, a memoria passa a valer.
  let persisted = true;

  function storage(): ErrorLogStorage | null {
    try {
      return getStorage();
    } catch {
      return null;
    }
  }

  /** Do mais antigo ao mais novo. Relido do storage a cada vez: outra aba pode ter gravado. */
  function load(): ErrorLogEntry[] {
    const store = storage();
    if (!store || !persisted) return memory;
    let raw: string | null;
    try {
      raw = store.getItem(ERROR_LOG_KEY);
    } catch {
      return memory;
    }
    // Nada gravado ou lixo (JSON corrompido, formato antigo): comeca vazio.
    memory = parseErrorLog(raw) ?? [];
    return memory;
  }

  function save(entries: ErrorLogEntry[]): void {
    memory = entries;
    const store = storage();
    if (!store) return;
    try {
      if (entries.length === 0) store.removeItem(ERROR_LOG_KEY);
      else store.setItem(ERROR_LOG_KEY, JSON.stringify(entries));
      persisted = true;
    } catch {
      // Cota estourada ou storage bloqueado: fica so em memoria ate fechar a aba.
      persisted = false;
    }
  }

  function snapshot(): ErrorLogEntry[] {
    return [...load()].reverse();
  }

  function notify(): void {
    if (listeners.size === 0) return;
    const entries = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener(entries);
      } catch {
        // Um inscrito com defeito nao pode impedir os outros nem voltar como erro novo.
      }
    }
  }

  return {
    record(input) {
      const entry: ErrorLogEntry = {
        at: now().toISOString(),
        source: isSource(input.source) ? input.source : "app",
        message: cleanText(input.message, ERROR_MESSAGE_MAX) ?? "Erro sem mensagem"
      };
      const detail = cleanText(input.detail, ERROR_DETAIL_MAX);
      if (detail) entry.detail = detail;
      const path = cleanText(input.path, PATH_MAX);
      if (path) entry.path = path;
      save([...load(), entry].slice(-limit));
      notify();
      return entry;
    },
    read: snapshot,
    clear() {
      save([]);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: notify
  };
}

const defaultLog = createErrorLog();

/** Registra um erro (o instante e carimbado aqui). Nunca lanca. */
export function recordError(entry: NewErrorLogEntry): void {
  try {
    defaultLog.record(entry);
  } catch {
    // Registrar erro nao pode virar outro erro.
  }
}

/** Os registros deste navegador, do mais novo ao mais antigo. */
export function readErrorLog(): ErrorLogEntry[] {
  try {
    return defaultLog.read();
  } catch {
    return [];
  }
}

export function clearErrorLog(): void {
  try {
    defaultLog.clear();
  } catch {
    // Sem storage: nada a limpar alem da memoria, que o `save` ja trocou.
  }
}

/** Avisa a cada registro/limpeza (para a tela atualizar ao vivo). Devolve o cancelamento. */
export function subscribeErrorLog(listener: ErrorLogListener): () => void {
  return defaultLog.subscribe(listener);
}

// ---------------------------------------------------------------------------
// Captura global (window.onerror / unhandledrejection)
// ---------------------------------------------------------------------------

/** O minimo de `window` que a captura usa — injetavel para teste. */
export interface ErrorLogTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  location?: { pathname?: string };
}

/**
 * Ruido conhecido que nao e defeito: o aviso de laco do ResizeObserver (o navegador so esta
 * dizendo que adiou um quadro) e erro de script de outra origem sem detalhe nenhum (extensao
 * do navegador, que o site nao controla e nao tem como corrigir).
 */
export function isIgnorableWindowError(message: string): boolean {
  return /^ResizeObserver loop/i.test(message) || message === "Script error.";
}

function currentPath(target: ErrorLogTarget): string | undefined {
  try {
    return target.location?.pathname || undefined;
  } catch {
    return undefined;
  }
}

function field(event: unknown, key: string): unknown {
  if (!event || typeof event !== "object") return undefined;
  return (event as Record<string, unknown>)[key];
}

/** Traduz o `ErrorEvent` do navegador para a entrada do diario (ou `null` se for ruido). */
export function entryFromErrorEvent(event: unknown, path?: string): NewErrorLogEntry | null {
  const error = field(event, "error");
  const eventMessage = field(event, "message");
  const thrown = error !== undefined && error !== null ? describeThrown(error) : null;
  const message =
    (typeof eventMessage === "string" && eventMessage) || thrown?.message || "Erro de script";
  if (isIgnorableWindowError(message)) return null;
  const file = field(event, "filename");
  const line = field(event, "lineno");
  const column = field(event, "colno");
  const where =
    typeof file === "string" && file
      ? `${file}${typeof line === "number" ? `:${line}` : ""}${typeof column === "number" ? `:${column}` : ""}`
      : undefined;
  return { source: "window", message, detail: thrown?.detail ?? where, path };
}

/** Traduz o `PromiseRejectionEvent` (promessa rejeitada que ninguem tratou). */
export function entryFromRejection(event: unknown, path?: string): NewErrorLogEntry {
  const thrown = describeThrown(field(event, "reason"));
  return { source: "promise", message: thrown.message, detail: thrown.detail, path };
}

let uninstallCurrent: (() => void) | null = null;

/**
 * Liga a captura de `error` e `unhandledrejection` no `window` (uma vez so: chamar de novo nao
 * duplica). Devolve o desligamento — util em teste; o site liga no `main.tsx` e nao desliga.
 */
export function installErrorLog(
  target: ErrorLogTarget | undefined = typeof window !== "undefined" ? window : undefined,
  log: Pick<ErrorLog, "record" | "refresh"> = defaultLog
): () => void {
  if (uninstallCurrent) return uninstallCurrent;
  if (!target) return () => undefined;

  const onError = (event: unknown) => {
    try {
      const entry = entryFromErrorEvent(event, currentPath(target));
      if (entry) log.record(entry);
    } catch {
      // A captura nunca pode gerar um erro novo (seria um laco).
    }
  };
  const onRejection = (event: unknown) => {
    try {
      log.record(entryFromRejection(event, currentPath(target)));
    } catch {
      // Idem.
    }
  };
  // Outra aba gravou no mesmo storage: a tela Logs desta aba acompanha.
  const onStorage = (event: unknown) => {
    const key = field(event, "key");
    if (key === ERROR_LOG_KEY || key === null) log.refresh();
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  target.addEventListener("storage", onStorage);

  const uninstall = () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    target.removeEventListener("storage", onStorage);
    if (uninstallCurrent === uninstall) uninstallCurrent = null;
  };
  uninstallCurrent = uninstall;
  return uninstall;
}
