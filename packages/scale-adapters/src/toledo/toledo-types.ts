export interface ToledoStatusFlags {
  /** Fora de alcance / sobrecarga */
  outOfRange: boolean;
  /** Peso negativo */
  negative: boolean;
  /** Centralizado no zero */
  atZero: boolean;
  /** Em movimento / instavel */
  inMotion: boolean;
  /** Tara ativa */
  tareActive: boolean;
  /** Peso bruto */
  isGross: boolean;
  /** Peso liquido */
  isNet: boolean;
}

export interface ToledoTcpConfig {
  host: string;
  port: number;
  /** Tempo maximo de espera por dados no socket (ms). Padrao: 3000 */
  timeoutMs?: number;
  /** Intervalo entre tentativas de reconexao (ms). Padrao: 5000 */
  reconnectIntervalMs?: number;
  /** Numero maximo de tentativas de reconexao. Padrao: 10 */
  maxReconnectAttempts?: number;
}

export interface ToledoSerialConfig {
  /** Caminho da porta serial: "COM3" no Windows, "/dev/ttyUSB0" no Linux */
  path: string;
  /** Velocidade da porta (bps). Padrao dos indicadores Toledo: 9600 */
  baudRate: number;
  /** Intervalo entre tentativas de reconexao (ms). Padrao: 5000 */
  reconnectIntervalMs?: number;
  /** Numero maximo de tentativas de reconexao. Padrao: 10 */
  maxReconnectAttempts?: number;
}

export interface ParsedToledoReading {
  /** Peso em kg */
  weightKg: number;
  /** Unidade da leitura */
  unit: "kg" | "lb" | "t" | "unknown";
  /** A leitura esta estavel (caminhao parado na balanca) */
  stable: boolean;
  /** Flags de status da balanca Toledo */
  statusFlags: ToledoStatusFlags;
  /** Linha original recebida da balanca (para debug) */
  raw: string;
}
