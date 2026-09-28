/**
 * Cadastro feito na BALANCA aparecendo NA HORA no site.
 *
 * O caminho contrario ja era instantaneo: o site grava pela `web-api`, a nuvem carimba
 * `cadastro_change_pings` (migracao `202609220001`) e a balanca, inscrita no Realtime, puxa na
 * hora (`apps/desktop/src/services/cadastro-realtime.ts`). A balanca tambem ja publicava o
 * cadastro no salvamento (`triggerCadastroCloudPush`) — e o `desktop-sync` grava pelas mesmas
 * tabelas, entao o MESMO aviso ja saia para ela. Faltava so quem ouvisse do lado do site: as
 * telas liam uma vez ao abrir e so mudavam no botao de atualizar.
 *
 * Aqui mora a parte com regra (juntar a rajada, espacar, segurar com a aba escondida); a
 * inscricao e a entrega as telas ficam em `cadastro-live-provider.tsx`.
 *
 * ## O aviso nao traz cadastro
 *
 * Ele diz "mudou algo na tabela X da empresa Y". Quem busca o dado continua sendo a propria
 * tela, com o login do usuario (RLS), pela mesma consulta de sempre. Um aviso repetido ou falso
 * custa no maximo uma leitura a mais — nunca um dado errado.
 *
 * ## Por que filtrar pela tabela
 *
 * A pesagem fechada na balanca tambem mexe em cadastro (movimento de credito, saldo do cliente),
 * e a tela de Operacoes le a empresa inteira de clientes a cada releitura. Com o nome da tabela
 * que disparou o aviso (`source`), cada tela so rele quando mudou o que ela mostra. Aviso sem
 * tabela conhecida (reconexao, coluna vazia) vale como "tudo mudou".
 */

/** Tabela de aviso na nuvem (migracao `202609220001_cadastro_change_pings`). */
export const CADASTRO_PING_TABLE = "cadastro_change_pings";

/**
 * Espera juntando avisos antes de reler. Um salvamento na balanca sobe cada tabela num lote
 * proprio (cliente, depois as transportadoras dele...): sao varios avisos para UMA mudanca.
 */
export const CADASTRO_LIVE_COALESCE_MS = 800;

/** Piso entre duas releituras disparadas por aviso (rajada do `omie-sync`, lote grande). */
export const CADASTRO_LIVE_MIN_INTERVAL_MS = 2_500;

/** O que mudou: as tabelas citadas nos avisos, ou "all" quando nao da para saber. */
export type ChangedTables = ReadonlySet<string> | "all";

/** A tela que mostra estas tabelas precisa reler? */
export function touches(changed: ChangedTables, tables: readonly string[] | undefined): boolean {
  if (changed === "all" || !tables) return true;
  return tables.some((table) => changed.has(table));
}

export interface CadastroChangeGateOptions {
  /** Hora de reler: entrega o que mudou desde a ultima entrega. */
  onFlush: (changed: ChangedTables) => void;
  /** A aba esta visivel? Escondida, o aviso fica guardado e sai quando ela voltar. */
  isVisible: () => boolean;
  coalesceMs?: number;
  minIntervalMs?: number;
  now?: () => number;
  setTimeoutFn?: (callback: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface CadastroChangeGate {
  /** Chegou um aviso. `source` e a tabela que o disparou; vazio vale como "tudo". */
  ping: (source?: string | null) => void;
  /** A aba voltou a ficar visivel: entrega o que chegou enquanto ela estava escondida. */
  wake: () => void;
  stop: () => void;
}

/**
 * Transforma a rajada de avisos em releituras espacadas.
 *
 * - O primeiro aviso sai depois de `coalesceMs` (o bastante para juntar as tabelas de um mesmo
 *   salvamento); os seguintes respeitam `minIntervalMs` contado da entrega anterior.
 * - Com a aba escondida nada e relido: o aviso fica guardado e `wake` entrega tudo de uma vez.
 *   Tela que ninguem esta olhando nao gasta leitura no banco.
 * - Nenhum aviso se perde: o que chega com uma entrega agendada entra nela, e o que chega
 *   depois agenda a proxima.
 */
export function createCadastroChangeGate(options: CadastroChangeGateOptions): CadastroChangeGate {
  const setTimeoutFn =
    options.setTimeoutFn ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimeoutFn =
    options.clearTimeoutFn ?? ((handle: unknown) => clearTimeout(handle as number));
  const now = options.now ?? Date.now;
  const coalesceMs = options.coalesceMs ?? CADASTRO_LIVE_COALESCE_MS;
  const minIntervalMs = options.minIntervalMs ?? CADASTRO_LIVE_MIN_INTERVAL_MS;

  let pending: Set<string> | "all" | null = null;
  let timer: unknown = null;
  let lastFlushAt: number | null = null;
  let stopped = false;

  function schedule(): void {
    if (stopped || timer !== null || pending === null || !options.isVisible()) return;
    const sinceLast = lastFlushAt === null ? Number.POSITIVE_INFINITY : now() - lastFlushAt;
    const wait = Math.max(coalesceMs, minIntervalMs - sinceLast);
    timer = setTimeoutFn(flush, wait);
  }

  function flush(): void {
    timer = null;
    if (stopped || pending === null) return;
    // Escondeu no meio da espera: guarda para o `wake`.
    if (!options.isVisible()) return;
    const changed: ChangedTables = pending;
    pending = null;
    lastFlushAt = now();
    options.onFlush(changed);
  }

  return {
    ping(source) {
      if (stopped) return;
      const table = typeof source === "string" ? source.trim() : "";
      if (!table || pending === "all") {
        pending = "all";
      } else {
        pending ??= new Set<string>();
        pending.add(table);
      }
      schedule();
    },
    wake() {
      schedule();
    },
    stop() {
      stopped = true;
      pending = null;
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
    }
  };
}

/**
 * As tabelas de cadastro que cada tela mostra. Fica num lugar so para a lista de uma tela nao
 * esquecer a tabela que ela le (a tela de Operacoes le sete de uma vez).
 */
export const CADASTRO_TABLES = {
  customers: ["customers"],
  products: ["products", "product_default_prices"],
  specialPrices: ["customer_special_prices"],
  carriers: ["carriers"],
  drivers: ["drivers"],
  vehicles: ["vehicles"],
  payment: ["payment_methods", "payment_terms", "accounts"],
  reportRecipients: ["report_recipients"]
} as const satisfies Record<string, readonly string[]>;
