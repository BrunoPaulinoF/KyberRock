/**
 * O cadastro da outra balanca chegando NA HORA, sem esperar o tique.
 *
 * Tres degraus separam "o comercial salvou o cliente" de "a expedicao ve o cliente":
 *
 *   1. sair da maquina que editou  -> `triggerCadastroCloudPush` publica no salvamento;
 *   2. entrar na janela do pull    -> `cloud_synced_at` (migracao `202609150001`);
 *   3. a outra maquina PERGUNTAR   -> era so aqui que ainda se esperava: o tique de 15 s
 *                                     do `App.tsx` (`MULTI_DESKTOP_PULL_INTERVAL_MS`).
 *
 * Este modulo e o terceiro degrau. A nuvem carimba `cadastro_change_pings` a cada escrita de
 * cadastro (migracao `202609220001`), o Realtime publica essa linha, e a balanca inscrita
 * puxa na hora — o que era ate 15 s de espera vira ~1 s.
 *
 * ## O aviso nao traz cadastro, e por isso ele pode ser publico
 *
 * O que chega pelo Realtime e "mudou alguma coisa no cadastro da empresa X, as 14:32". Quem
 * busca o cadastro continua sendo o `desktop-pull` de sempre, com o token do dispositivo e a
 * janela incremental de sempre. Isso mantem duas coisas: o cadastro nunca trafega fora do
 * caminho autenticado, e um aviso falso (ou repetido) custa no maximo um pull a mais — nunca
 * um dado errado.
 *
 * ## O tique de 15 s continua
 *
 * Ele e a rede: cobre a balanca que estava sem internet quando o aviso passou, o Realtime fora
 * do ar e o evento perdido. O aviso ADIANTA o pull, nao substitui o ciclo. Por isso tudo aqui e
 * best-effort — nada neste arquivo pode derrubar a operacao se o Realtime nao conectar.
 */

/** Tabela de aviso na nuvem (migracao `202609220001_cadastro_change_pings`). */
export const CADASTRO_PING_TABLE = "cadastro_change_pings";

/**
 * Espera curta juntando avisos antes de puxar.
 *
 * Um salvamento so na tela costuma escrever em mais de uma tabela (cliente + placas +
 * transportadoras vinculadas), e o `desktop-sync` publica cada tabela num lote proprio: sao
 * varios avisos para a MESMA mudanca. Sem esta folga, cada um viraria um pull.
 */
export const CADASTRO_PING_COALESCE_MS = 400;

/**
 * Piso entre dois pulls disparados por aviso, contado do FIM do anterior.
 *
 * Protege a balanca da rajada legitima (o `omie-sync` gravando o cadastro inteiro em lotes) e
 * de qualquer aviso repetido. O que passar do piso nao se perde: vira um pull logo apos o
 * atual, porque o pull e incremental e traz tudo o que chegou desde o cursor.
 */
export const CADASTRO_PING_MIN_INTERVAL_MS = 1_500;

/** Ritmo do supervisor da inscricao (reconecta, troca de empresa, ativacao tardia). */
export const CADASTRO_REALTIME_SUPERVISOR_INTERVAL_MS = 30_000;

export interface StartCadastroPingSchedulerOptions {
  /** O pull incremental. A trava contra concorrencia vive no runtime. */
  pull: () => Promise<void>;
  onError?: (error: unknown) => void;
  coalesceMs?: number;
  minIntervalMs?: number;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export interface CadastroPingSchedulerHandle {
  /** Chegou um aviso. Pode ser chamado em rajada: o agendador junta. */
  ping: () => void;
  stop: () => void;
  /** Diagnostico: ha pull agendado ou em andamento? */
  isBusy: () => boolean;
}

/**
 * Transforma a rajada de avisos em pulls espacados.
 *
 * Separado da inscricao de proposito: e a unica parte com regra de verdade (juntar, espacar,
 * nao sobrepor) e a unica que precisa de teste — a inscricao em si e encanamento do
 * supabase-js.
 */
export function startCadastroPingScheduler(
  options: StartCadastroPingSchedulerOptions
): CadastroPingSchedulerHandle {
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const now = options.now ?? Date.now;
  const coalesceMs = options.coalesceMs ?? CADASTRO_PING_COALESCE_MS;
  const minIntervalMs = options.minIntervalMs ?? CADASTRO_PING_MIN_INTERVAL_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pendingWhileRunning = false;
  let stopped = false;
  // `null` (e nao 0) para o primeiro aviso nao ter de esperar o piso: a balanca acabou de
  // abrir, ninguem puxou nada ainda, e o dado ja esta na nuvem.
  let lastFinishedAt: number | null = null;

  function schedule(): void {
    if (stopped || timer) return;
    if (running) {
      // Aviso que chegou com um pull em andamento nao pode ser descartado: ele pode ser de
      // uma linha gravada DEPOIS que este pull montou a janela dele.
      pendingWhileRunning = true;
      return;
    }
    const sinceLast = lastFinishedAt === null ? Number.POSITIVE_INFINITY : now() - lastFinishedAt;
    const wait = Math.max(coalesceMs, minIntervalMs - sinceLast);
    timer = setTimeoutFn(() => {
      timer = null;
      void run();
    }, wait);
  }

  async function run(): Promise<void> {
    if (stopped) return;
    running = true;
    pendingWhileRunning = false;
    try {
      await options.pull();
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
      lastFinishedAt = now();
      if (pendingWhileRunning) {
        pendingWhileRunning = false;
        schedule();
      }
    }
  }

  return {
    ping: () => schedule(),
    stop: () => {
      stopped = true;
      pendingWhileRunning = false;
      if (timer) {
        clearTimeoutFn(timer);
        timer = null;
      }
    },
    isBusy: () => running || timer !== null
  };
}

/** O que esta conexao esta fazendo — o que a tela e o log precisam saber. */
export type CadastroRealtimeState = "off" | "connecting" | "live" | "error";

/**
 * O minimo do supabase-js que este modulo usa. Declarado aqui, e nao importado, para o teste
 * poder passar um cliente de mentira sem montar meio SDK.
 */
export interface RealtimeChannelLike {
  on: (
    type: "postgres_changes",
    filter: { event: string; schema: string; table: string; filter?: string },
    callback: (payload: unknown) => void
  ) => RealtimeChannelLike;
  subscribe: (callback?: (status: string, error?: unknown) => void) => unknown;
}

export interface RealtimeCapableClient {
  channel: (name: string) => RealtimeChannelLike;
  removeChannel: (channel: RealtimeChannelLike) => unknown;
}

export interface StartCadastroRealtimeOptions {
  /** Cliente da nuvem, ou `null` enquanto a balanca nao tem configuracao. */
  getClient: () => RealtimeCapableClient | null;
  /** Empresa desta balanca, ou `null` enquanto ela nao foi ativada. */
  getCompanyId: () => string | null;
  /** Chegou aviso (ou a inscricao acabou de subir — ver `onStateChange`). */
  onPing: () => void;
  onStateChange?: (state: CadastroRealtimeState) => void;
  onError?: (error: unknown) => void;
  supervisorIntervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface CadastroRealtimeHandle {
  stop: () => void;
  getState: () => CadastroRealtimeState;
}

/**
 * Mantem a balanca inscrita no aviso da empresa dela.
 *
 * O supervisor periodico existe porque a inscricao depende de coisas que mudam DEPOIS da
 * abertura do programa: a ativacao (que define a empresa), a configuracao da nuvem e a
 * internet. Sem ele, uma balanca que abriu offline — ou que foi ativada com o programa ja
 * aberto — ficaria para sempre sem aviso, esperando o tique de 15 s e sem ninguem para notar.
 */
export function startCadastroRealtime(
  options: StartCadastroRealtimeOptions
): CadastroRealtimeHandle {
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const supervisorIntervalMs =
    options.supervisorIntervalMs ?? CADASTRO_REALTIME_SUPERVISOR_INTERVAL_MS;

  let channel: RealtimeChannelLike | null = null;
  let client: RealtimeCapableClient | null = null;
  let subscribedCompanyId: string | null = null;
  let state: CadastroRealtimeState = "off";
  let stopped = false;

  function setState(next: CadastroRealtimeState): void {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  }

  function teardown(): void {
    if (channel && client) {
      try {
        client.removeChannel(channel);
      } catch (error) {
        options.onError?.(error);
      }
    }
    channel = null;
    client = null;
    subscribedCompanyId = null;
  }

  function ensure(): void {
    if (stopped) return;
    const nextClient = options.getClient();
    const companyId = options.getCompanyId();

    if (!nextClient || !companyId) {
      // Sem nuvem ou sem ativacao nao ha o que assinar. Nao e erro: e a balanca que ainda nao
      // entrou na pedreira, e o tique de 15 s segue cobrindo quando ela entrar.
      teardown();
      setState("off");
      return;
    }

    const alive =
      channel !== null &&
      client === nextClient &&
      subscribedCompanyId === companyId &&
      (state === "live" || state === "connecting");
    if (alive) return;

    teardown();
    setState("connecting");

    try {
      const created = nextClient.channel(`${CADASTRO_PING_TABLE}:${companyId}`);
      created
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: CADASTRO_PING_TABLE,
            // O filtro e do servidor: esta balanca nao recebe (nem ve) o aviso de outra
            // pedreira. `company_id` e a chave primaria da tabela de aviso, entao ele vale
            // para INSERT e UPDATE sem precisar de replica identity cheia.
            filter: `company_id=eq.${companyId}`
          },
          () => {
            if (stopped) return;
            options.onPing();
          }
        )
        .subscribe((status: string) => {
          if (stopped) return;
          if (status === "SUBSCRIBED") {
            const wasLive = state === "live";
            setState("live");
            // Toda subida vale um pull: enquanto a inscricao esteve fora do ar (abertura do
            // programa, queda de internet, servidor reiniciado) os avisos daquele periodo nao
            // ficaram guardados em lugar nenhum. Sem isto, a balanca voltaria "conectada" e
            // desatualizada ao mesmo tempo — o pior dos dois mundos.
            if (!wasLive) options.onPing();
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            // Nao reconecta aqui: quem refaz e o proximo tique do supervisor. Reagir no
            // proprio callback somaria a nossa re-tentativa a do supabase-js, e duas
            // reconexoes concorrentes derrubam uma a outra.
            setState("error");
          }
        });
      channel = created;
      client = nextClient;
      subscribedCompanyId = companyId;
    } catch (error) {
      options.onError?.(error);
      teardown();
      setState("error");
    }
  }

  ensure();
  const supervisor = setIntervalFn(() => ensure(), supervisorIntervalMs);

  return {
    stop: () => {
      stopped = true;
      clearIntervalFn(supervisor);
      teardown();
      state = "off";
    },
    getState: () => state
  };
}
