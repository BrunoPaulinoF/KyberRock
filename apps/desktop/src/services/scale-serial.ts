import type { SerialTransport, SerialTransportFactory } from "@kyberrock/scale-adapters";

/**
 * Integracao com a dependencia nativa `serialport`, isolada neste modulo e
 * carregada sob demanda: se o binding nativo estiver indisponivel em alguma
 * maquina, o restante do app (TCP/virtual) continua funcionando e o erro
 * apresentado ao operador e claro.
 */

export interface SerialPortInfo {
  /** Caminho para conectar: "COM3" (Windows) ou "/dev/ttyUSB0" (Linux) */
  path: string;
  /** Nome amigavel exibido ao operador (Windows traz a descricao do driver) */
  label: string;
  manufacturer: string | null;
  /** true quando a porta e um conversor/dispositivo USB */
  isUsb: boolean;
}

interface SerialPortListEntry {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  friendlyName?: string;
  pnpId?: string;
}

interface SerialPortInstance {
  open(callback: (error: Error | null) => void): void;
  close(callback?: (error: Error | null) => void): void;
  on(event: "data", callback: (chunk: Uint8Array) => void): void;
  on(event: "error", callback: (error: Error) => void): void;
  on(event: "close", callback: () => void): void;
  isOpen: boolean;
}

interface SerialPortModule {
  SerialPort: {
    new (options: {
      path: string;
      baudRate: number;
      dataBits: 8;
      stopBits: 1;
      parity: "none";
      autoOpen: false;
    }): SerialPortInstance;
    list(): Promise<SerialPortListEntry[]>;
  };
}

async function loadSerialPortModule(): Promise<SerialPortModule> {
  try {
    const imported = (await import("serialport")) as unknown as Partial<SerialPortModule> & {
      default?: Partial<SerialPortModule>;
    };
    // Interop CJS/ESM: dependendo do empacotamento o export nomeado pode vir
    // direto ou dentro de "default".
    const SerialPort = imported.SerialPort ?? imported.default?.SerialPort;
    if (!SerialPort) {
      throw new Error("Modulo serialport carregado sem o export SerialPort.");
    }
    return { SerialPort };
  } catch (error) {
    const detail = error instanceof Error ? ` (${error.message})` : "";
    throw new Error(
      `Suporte a porta serial (COM/USB) indisponivel neste computador${detail}. ` +
        "Reinstale o KyberRock Desktop ou use a conexao por rede (IP)."
    );
  }
}

/** Lista as portas seriais disponiveis no computador (COM e USB-serial). */
export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const { SerialPort } = await loadSerialPortModule();
  const ports = await SerialPort.list();
  return ports
    .filter((port) => typeof port.path === "string" && port.path.trim().length > 0)
    .map((port) => {
      const isUsb =
        Boolean(port.vendorId) || /usb/i.test(port.pnpId ?? "") || /usb/i.test(port.manufacturer ?? "");
      const friendly = port.friendlyName?.trim() || port.manufacturer?.trim() || "";
      return {
        path: port.path,
        label: friendly ? `${port.path} — ${friendly}` : port.path,
        manufacturer: port.manufacturer?.trim() || null,
        isUsb
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

/**
 * Fabrica do transporte serial usado pelo adaptador Toledo. Configuracao de
 * quadro fixa em 8N1 (padrao dos indicadores Toledo).
 */
export function createDesktopSerialTransportFactory(): SerialTransportFactory {
  return ({ path, baudRate }) => {
    let port: SerialPortInstance | null = null;
    let dataCallback: ((chunk: Uint8Array) => void) | null = null;
    let errorCallback: ((error: Error) => void) | null = null;
    let closeCallback: (() => void) | null = null;

    const transport: SerialTransport = {
      async open(): Promise<void> {
        const { SerialPort } = await loadSerialPortModule();
        const instance = new SerialPort({
          path,
          baudRate,
          dataBits: 8,
          stopBits: 1,
          parity: "none",
          autoOpen: false
        });

        instance.on("data", (chunk) => dataCallback?.(chunk));
        instance.on("error", (error) => errorCallback?.(translateSerialError(error, path)));
        instance.on("close", () => closeCallback?.());

        await new Promise<void>((resolve, reject) => {
          instance.open((error) => {
            if (error) {
              reject(translateSerialError(error, path));
              return;
            }
            resolve();
          });
        });

        port = instance;
      },

      close(): void {
        const current = port;
        port = null;
        if (current?.isOpen) {
          try {
            current.close(() => undefined);
          } catch {
            // Fechar porta nunca deve derrubar o app
          }
        }
      },

      onData(callback) {
        dataCallback = callback;
      },
      onError(callback) {
        errorCallback = callback;
      },
      onClose(callback) {
        closeCallback = callback;
      }
    };

    return transport;
  };
}

/** Converte erros crus do driver serial em mensagens acionaveis pelo operador. */
function translateSerialError(error: Error, path: string): Error {
  const message = error.message || "";
  if (/access denied|permission denied|resource busy|in use/i.test(message)) {
    return new Error(
      `A porta ${path} esta em uso por outro programa. Feche o outro programa (ou desconecte/reconecte o cabo) e tente novamente.`
    );
  }
  if (/file not found|no such file|cannot find|unknown error code 433|not found/i.test(message)) {
    return new Error(
      `A porta ${path} nao foi encontrada. Verifique se o cabo esta conectado e atualize a lista de portas.`
    );
  }
  return new Error(`Falha na porta ${path}: ${message || "erro desconhecido"}`);
}
