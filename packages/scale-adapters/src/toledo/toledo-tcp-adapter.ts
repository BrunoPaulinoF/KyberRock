import { createConnection } from "node:net";
import type { Socket } from "node:net";

import { parseToledoLine } from "./toledo-protocol-parser.js";
import { normalizeParsedReading } from "./toledo-reading.js";
import type { ParsedToledoReading, ToledoTcpConfig } from "./toledo-types.js";
import type { ScaleReading, ScaleSamplingOptions, ScaleStatus } from "../scale-adapter.js";

export type ToledoConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface ToledoTcpAdapterStatus {
  state: ToledoConnectionState;
  lastReading: ParsedToledoReading | null;
  lastReadingAt: string | null;
  errorMessage: string | null;
  reconnectAttempts: number;
  /**
   * `true` quando a ultima leitura ja passou do tempo de validade. A UI nunca deve
   * exibir peso com `stale: true` — foi exatamente esse peso vencido que continuou
   * aparecendo na tela depois que o caminhao saiu da balanca.
   */
  stale: boolean;
  /**
   * `true` quando bytes estao chegando pela conexao, mesmo que nenhum deles forme
   * um quadro valido. Separa dois diagnosticos que antes eram indistinguiveis:
   * indicador mudo (nada chega) versus protocolo/baud errado (chega lixo).
   */
  receivingRawData: boolean;
  /** Amostra legivel do ultimo trecho bruto recebido, para identificar o protocolo. */
  lastRawSample: string | null;
}

/** Silencio maximo tolerado com a conexao aberta antes de considerar a leitura vencida. */
export const DEFAULT_STALE_READING_MS = 4000;

/**
 * Comandos de leitura aceitos por indicadores em modo sob demanda. ENQ (0x05) e o
 * pedido padrao da Toledo; "P" (print) e "W" (weight) cobrem os demais firmwares
 * comuns. Todos sao comandos de consulta — nenhum altera estado da balanca.
 */
export const DEFAULT_POLL_COMMANDS = ["\x05", "P\r\n", "W\r\n"];

/** Intervalo entre comandos de sondagem enquanto nenhum byte chega. */
export const DEFAULT_POLL_INTERVAL_MS = 1500;

export interface ToledoTcpAdapter {
  /** Conectar ao indicador Toledo via TCP */
  connect(config: ToledoTcpConfig): Promise<void>;

  /** Desconectar do indicador */
  disconnect(): void;

  /** Obter a ultima leitura recebida normalizada (nao bloqueia) */
  read(): Promise<ScaleReading>;

  /** Aguardar uma leitura estavel, recente e valida sem calcular media */
  readSampled(options?: ScaleSamplingOptions): Promise<ScaleReading>;

  /** Obter status da conexao e ultima leitura */
  getStatus(): ToledoTcpAdapterStatus;

  /** Registrar callback para leituras ao vivo (stream) */
  onReading(callback: (reading: ParsedToledoReading) => void): () => void;

  /** Limpar todos os callbacks */
  removeAllListeners(): void;
}

export function createToledoTcpAdapter(): ToledoTcpAdapter {
  let socket: Socket | null = null;
  let state: ToledoConnectionState = "disconnected";
  let lastReading: ParsedToledoReading | null = null;
  let lastReadingAt: string | null = null;
  // Trafego bruto, contado antes do parser. Sem isto, "nao chega nada" e "chega
  // conteudo que o parser rejeita" produziam exatamente o mesmo estado, e os dois
  // exigem correcoes opostas no campo.
  let lastDataAt: number | null = null;
  let lastRawSample: string | null = null;
  let errorMessage: string | null = null;
  let reconnectCount = 0;
  let config: ToledoTcpConfig | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let dataWatchdog: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let buffer = "";
  // Invalida handlers de tentativas antigas: sem isto, uma tentativa de conexao ainda
  // em voo sobrescrevia o socket da tentativa nova e dois sockets ficavam vivos ao
  // mesmo tempo. Conversores serial<->TCP aceitam uma sessao por vez e travam assim.
  let generation = 0;
  const listeners: Array<(reading: ParsedToledoReading) => void> = [];

  function getDeviceId(): string | undefined {
    return config ? `${config.host}:${config.port}` : undefined;
  }

  function staleThresholdMs(): number {
    return config?.staleReadingMs ?? DEFAULT_STALE_READING_MS;
  }

  function isStale(): boolean {
    if (!lastReadingAt) return true;
    const receivedAt = Date.parse(lastReadingAt);
    if (!Number.isFinite(receivedAt)) return true;
    return Date.now() - receivedAt > staleThresholdMs();
  }

  function getLastScaleReading(): ScaleReading | null {
    if (!lastReading || !lastReadingAt) return null;
    return normalizeParsedReading(lastReading, lastReadingAt, "toledo-tcp", getDeviceId());
  }

  function clearLastReading(): void {
    lastReading = null;
    lastReadingAt = null;
  }

  /** Ha bytes recentes na conexao, independentemente de formarem quadro valido. */
  function isReceivingRawData(): boolean {
    if (lastDataAt === null) return false;
    return Date.now() - lastDataAt <= staleThresholdMs();
  }

  /** Guarda uma amostra legivel do trafego bruto para identificar o protocolo em campo. */
  function recordRawData(chunk: string): void {
    lastDataAt = Date.now();
    lastRawSample = chunk.replace(/[^\x20-\x7e]/g, ".").slice(-120);
    // Chegou algo: o indicador nao esta em modo sob demanda, entao para de sondar.
    stopPolling();
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /**
   * Indicadores em modo sob demanda so respondem quando recebem um comando; conectados
   * em transmissao continua eles falam sozinhos. Como os dois casos sao indistinguiveis
   * do lado do cliente — socket aberto e silencio absoluto —, a sondagem cobre o
   * primeiro sem prejudicar o segundo, e se desliga assim que qualquer byte chega.
   */
  function startPolling(): void {
    stopPolling();
    const cfg = config;
    if (!cfg || cfg.autoPoll === false) return;

    const commands = cfg.pollCommands ?? DEFAULT_POLL_COMMANDS;
    if (commands.length === 0) return;

    const currentGeneration = generation;
    let index = 0;
    pollTimer = setInterval(() => {
      if (currentGeneration !== generation || state !== "connected" || !socket) return;
      if (lastDataAt !== null) {
        stopPolling();
        return;
      }
      const command = commands[index % commands.length] ?? "";
      index++;
      try {
        socket.write(Buffer.from(command, "binary"));
      } catch {
        // Falha de escrita e tratada pelos handlers de erro/close do socket
      }
    }, cfg.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }

  function clearDataWatchdog(): void {
    if (dataWatchdog) {
      clearTimeout(dataWatchdog);
      dataWatchdog = null;
    }
  }

  /**
   * Rearma a cada quadro recebido. Se o indicador parar de transmitir com o socket
   * ainda aberto, derruba a conexao e reconecta em vez de manter "connected" exibindo
   * um peso que nao existe mais.
   */
  function armDataWatchdog(): void {
    clearDataWatchdog();
    const currentGeneration = generation;
    dataWatchdog = setTimeout(() => {
      if (currentGeneration !== generation || state !== "connected") return;
      // Chegou aqui: o trafego bruto parou. Link morto de fato — derruba e reconecta.
      errorMessage =
        "Conexao aberta, mas o indicador nao envia nada. Verifique se outro programa " +
        "esta conectado na balanca, se a porta do conversor corresponde ao canal serial " +
        "ligado ao indicador e se ele esta em transmissao continua.";
      clearLastReading();
      teardownSocket();
      state = "disconnected";
      scheduleReconnect();
    }, staleThresholdMs());
  }

  /** Encerra o socket com FIN limpo antes de destruir, para o conversor liberar a sessao. */
  function teardownSocket(): void {
    clearDataWatchdog();
    stopPolling();
    if (socket) {
      const current = socket;
      socket = null;
      current.removeAllListeners();
      try {
        current.end();
      } catch {
        // socket ja invalido
      }
      current.destroy();
    }
  }

  function notify(reading: ParsedToledoReading): void {
    lastReading = reading;
    lastReadingAt = new Date().toISOString();
    armDataWatchdog();
    for (const listener of listeners) {
      try {
        listener(reading);
      } catch {
        // Ignore listener errors
      }
    }
  }

  function doDisconnect(): void {
    generation++;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    teardownSocket();
    state = "disconnected";
    config = null;
    reconnectCount = 0;
    buffer = "";
    // Zera a leitura: peso de uma sessao anterior nunca pode reaparecer apos reconectar.
    clearLastReading();
    lastDataAt = null;
    lastRawSample = null;
  }

  function scheduleReconnect(): void {
    if (!config) return;

    // Uma queda pode disparar mais de um caminho (erro + fechamento). Sem limpar o
    // timer anterior, duas tentativas simultaneas abriam dois sockets no conversor.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const maxAttempts = config.maxReconnectAttempts ?? 10;
    const interval = config.reconnectIntervalMs ?? 5000;

    if (reconnectCount >= maxAttempts) {
      state = "error";
      errorMessage = `Falha ao reconectar apos ${maxAttempts} tentativas.`;
      return;
    }

    reconnectCount++;
    state = "connecting";

    reconnectTimer = setTimeout(() => {
      // `catch` obrigatorio: a rejeicao desta tentativa em segundo plano nao tem
      // quem a aguarde, e sem tratamento virava unhandled rejection no processo main.
      if (config) void attemptConnect(config).catch(() => undefined);
    }, interval);
  }

  async function attemptConnect(cfg: ToledoTcpConfig): Promise<void> {
    const currentGeneration = generation;

    return new Promise<void>((resolve, reject) => {
      // Garante uma unica sessao TCP viva: qualquer socket remanescente sai antes de abrir outro.
      teardownSocket();

      const sock = createConnection({ host: cfg.host, port: cfg.port }, () => {
        if (currentGeneration !== generation) {
          sock.end();
          sock.destroy();
          return;
        }
        state = "connected";
        errorMessage = null;
        reconnectCount = 0;
        buffer = "";
        // O timeout de socket cobre so a fase de conexao; a partir daqui quem vigia
        // o silencio e o watchdog de dados, que sabe distinguir conexao morta de peso parado.
        sock.setTimeout(0);
        armDataWatchdog();
        // Cada sessao comeca sem historico de trafego: o que chegou na anterior nao
        // diz nada sobre esta, e a sondagem precisa saber que ainda nao veio nada.
        lastDataAt = null;
        startPolling();
        resolve();
      });
      socket = sock;

      sock.on("data", (chunk: Buffer) => {
        if (currentGeneration !== generation) return;
        const text = chunk.toString("binary");
        // Registrado antes do parser: trafego ilegivel tambem e sinal de diagnostico.
        recordRawData(text);
        // O watchdog acompanha trafego, nao quadros validos. Um indicador que envia
        // lixo continuo esta vivo; derrubar a conexao a cada 4s so esconderia a pista.
        armDataWatchdog();
        buffer += text;

        // Protecao contra indicadores que nunca enviam CR/LF: nao deixa o buffer crescer sem limite
        if (buffer.length > 4096) {
          buffer = buffer.slice(-1024);
        }

        // Process complete lines (terminated by CR/LF)
        const lines = buffer.split(/\r\n|\r|\n/);
        buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = parseToledoLine(Buffer.from(line, "binary"));
          if (parsed) {
            notify(parsed);
          }
        }
      });

      sock.on("error", (err: Error) => {
        if (currentGeneration !== generation) return;
        errorMessage = err.message;
        state = "error";
        clearLastReading();
        // Encerra de fato o socket com erro. Apenas soltar a referencia deixava a
        // sessao viva: os handlers continuavam entregando leituras ao renderer
        // (peso atualizando na tela) enquanto o estado dizia "desconectada", e o
        // conversor serial<->TCP, que aceita uma sessao por vez, recusava a
        // reconexao porque a sessao morta ainda ocupava a porta.
        teardownSocket();
        scheduleReconnect();
        reject(err);
      });

      sock.on("close", () => {
        if (currentGeneration !== generation) return;
        socket = null;
        clearDataWatchdog();
        // A sondagem escrevia num socket ja fechado ate a proxima conexao trocar o timer.
        stopPolling();
        if (state === "connected") {
          state = "disconnected";
          // A conexao caiu: o peso exibido morre junto, senao a tela segue mostrando
          // o ultimo caminhao pesado como se a balanca ainda estivesse respondendo.
          clearLastReading();
          scheduleReconnect();
        }
      });

      const timeout = cfg.timeoutMs ?? 3000;
      sock.setTimeout(timeout, () => {
        if (currentGeneration !== generation) return;
        if (state === "connecting") {
          teardownSocket();
          state = "error";
          errorMessage = `Timeout de conexao (${timeout}ms)`;
          // Indicador que demora a responder no boot nao pode deixar a balanca
          // parada ate alguem clicar: a reconexao automatica continua daqui.
          scheduleReconnect();
          reject(new Error(errorMessage));
        }
      });
    });
  }

  return {
    async connect(cfg: ToledoTcpConfig): Promise<void> {
      doDisconnect();
      config = cfg;
      state = "connecting";
      errorMessage = null;
      reconnectCount = 0;
      await attemptConnect(cfg);
    },

    disconnect: doDisconnect,

    async read(): Promise<ScaleReading> {
      if (state !== "connected") {
        throw new Error("Balanca nao esta conectada.");
      }

      const reading = getLastScaleReading();
      if (!reading) {
        throw new Error("Nenhuma leitura disponivel da balanca.");
      }

      // Ha leitura, mas ja venceu: melhor falhar do que devolver um peso antigo.
      if (isStale()) {
        throw new Error(
          "Balanca conectada, mas sem leitura recente. O indicador nao esta transmitindo: " +
            "confirme se ele esta em modo de transmissao continua e se nenhum outro " +
            "programa esta ocupando a conexao."
        );
      }

      return reading;
    },

    async readSampled(options: ScaleSamplingOptions = {}): Promise<ScaleReading> {
      if (state !== "connected") {
        throw new Error("Balanca nao esta conectada.");
      }

      const timeoutMs = Math.max(500, options.durationMs ?? 5000);
      const sampleIntervalMs = Math.max(50, options.sampleIntervalMs ?? 250);
      const minStableMs = Math.max(0, options.minStableMs ?? 0);
      const start = Date.now();
      const maxReadingAgeMs = Math.max(1500, minStableMs + sampleIntervalMs * 2);
      const maxVariationKg = options.maxVariationKg ?? 0;
      const minWeightKg = options.minWeightKg;
      let stableSince: number | null = null;
      let stableReferenceWeightKg: number | null = null;
      let lastStatus: ScaleStatus = "no_data";

      while (Date.now() - start < timeoutMs) {
        const now = Date.now();
        const reading = getLastScaleReading();
        if (!reading) {
          await delay(sampleIntervalMs);
          continue;
        }

        lastStatus = reading.status;
        const receivedAt = Date.parse(reading.receivedAt);
        if (
          !Number.isFinite(receivedAt) ||
          now - receivedAt > maxReadingAgeMs ||
          (receivedAt < start && start - receivedAt > maxReadingAgeMs)
        ) {
          await delay(sampleIntervalMs);
          continue;
        }

        if (reading.status !== "stable" || !reading.stable) {
          assertNonRecoverableStatus(reading);
          stableSince = null;
          stableReferenceWeightKg = null;
          await delay(sampleIntervalMs);
          continue;
        }

        if (minWeightKg !== undefined && reading.weightKg < minWeightKg) {
          throw new Error(
            `Peso abaixo do minimo configurado (${Math.round(reading.weightKg)} kg < ${minWeightKg} kg).`
          );
        }

        if (stableReferenceWeightKg === null) {
          stableReferenceWeightKg = reading.weightKg;
          stableSince = now;
        }

        if (Math.abs(reading.weightKg - stableReferenceWeightKg) > maxVariationKg) {
          stableReferenceWeightKg = reading.weightKg;
          stableSince = now;
        }

        if (stableSince !== null && now - stableSince >= minStableMs) {
          return { ...reading, capturedAt: new Date().toISOString() };
        }

        await delay(sampleIntervalMs);
      }

      if (lastStatus === "unstable") {
        throw new Error("Peso instavel informado pela balanca.");
      }
      throw new Error("Nenhuma leitura estavel e recente recebida da balanca.");
    },

    getStatus(): ToledoTcpAdapterStatus {
      const stale = isStale();
      const receivingRawData = isReceivingRawData();
      // Link vivo entregando conteudo que o parser rejeita: o watchdog nao dispara
      // (ha trafego), entao a pista so chega ao operador por aqui.
      const protocolMismatch =
        state === "connected" && stale && receivingRawData
          ? "Recebendo dados, mas nenhum quadro reconhecido como Toledo. Confira o baud " +
            `rate no conversor e o formato do indicador. Amostra: "${lastRawSample ?? ""}"`
          : null;

      return {
        state,
        // Leitura vencida nao sai daqui: quem consome o status desenha o peso ao vivo,
        // e devolver o valor antigo e o que congelava a tela apos o caminhao sair.
        lastReading: stale ? null : lastReading,
        lastReadingAt,
        errorMessage: protocolMismatch ?? errorMessage,
        reconnectAttempts: reconnectCount,
        stale,
        receivingRawData,
        lastRawSample
      };
    },

    onReading(callback): () => void {
      listeners.push(callback);
      return () => {
        const idx = listeners.indexOf(callback);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },

    removeAllListeners(): void {
      listeners.length = 0;
    }
  };
}

function assertNonRecoverableStatus(reading: ScaleReading): void {
  switch (reading.status) {
    case "unstable":
    case "no_data":
      return;
    case "overload":
      throw new Error("Balanca em sobrecarga ou fora de alcance.");
    case "negative":
      throw new Error("Balanca informou peso negativo.");
    case "zero":
      throw new Error("Balanca sem peso util para captura.");
    case "stable":
      return;
    default:
      throw new Error("Balanca informou erro de leitura.");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
