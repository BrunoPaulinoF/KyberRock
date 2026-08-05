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
  /**
   * Numero maximo de tentativas de reconexao. Padrao: 10. Use
   * `Number.POSITIVE_INFINITY` para nunca desistir — e o que a operacao precisa
   * quando o indicador fica fora do ar (queda de energia, PC ligado antes da
   * rede): desistindo, so um clique manual traz a balanca de volta.
   */
  maxReconnectAttempts?: number;
  /**
   * Teto do intervalo entre tentativas (ms). Quando definido, o intervalo dobra a
   * cada tentativa ate este limite, em vez de ficar fixo em `reconnectIntervalMs`.
   * Omitido, o intervalo e constante — comportamento historico.
   */
  reconnectBackoffMaxMs?: number;
  /**
   * Silencio maximo tolerado com o socket aberto (ms). Padrao: 4000.
   * Indicadores em transmissao continua enviam varios quadros por segundo; passar
   * deste tempo sem quadro significa conexao morta (socket meio-aberto ou sessao
   * do conversor entregue a outro cliente), e nao peso parado.
   */
  staleReadingMs?: number;
  /**
   * Silencio absoluto tolerado antes de fechar e reabrir a sessao (ms). Padrao:
   * 45000. Um indicador calado nao justifica derrubar a conexao a cada
   * `staleReadingMs`: com o socket aberto o proximo quadro chega na hora, enquanto
   * o ciclo de queda-e-reconexao a cada poucos segundos aparecia na tela como uma
   * balanca reconectando sem parar. A sessao so e girada depois deste tempo, que e
   * quando vale suspeitar de socket meio-aberto ou de sessao entregue a outro cliente.
   */
  silenceRotateMs?: number;
  /**
   * Sondar o indicador enquanto nenhum byte chegar. Indicadores em modo sob demanda
   * so respondem a um comando; do lado do cliente isso e indistinguivel de um
   * indicador mudo. Padrao: `true`. A sondagem se desliga ao primeiro byte recebido.
   */
  autoPoll?: boolean;
  /** Comandos de consulta enviados na sondagem. Padrao: ENQ, "P\r\n", "W\r\n". */
  pollCommands?: string[];
  /** Intervalo entre comandos de sondagem (ms). Padrao: 1500 */
  pollIntervalMs?: number;
}

export interface ToledoSerialConfig {
  /** Caminho da porta serial: "COM3" no Windows, "/dev/ttyUSB0" no Linux */
  path: string;
  /** Velocidade da porta (bps). Padrao dos indicadores Toledo: 9600 */
  baudRate: number;
  /** Intervalo entre tentativas de reconexao (ms). Padrao: 5000 */
  reconnectIntervalMs?: number;
  /**
   * Numero maximo de tentativas de reconexao. Padrao: 10.
   * `Number.POSITIVE_INFINITY` para nunca desistir (ver `ToledoTcpConfig`).
   */
  maxReconnectAttempts?: number;
  /**
   * Teto do intervalo entre tentativas (ms). Definido, o intervalo dobra a cada
   * tentativa ate este limite; omitido, fica constante em `reconnectIntervalMs`.
   */
  reconnectBackoffMaxMs?: number;
  /** Silencio maximo tolerado com a porta aberta (ms). Padrao: 4000. */
  staleReadingMs?: number;
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
