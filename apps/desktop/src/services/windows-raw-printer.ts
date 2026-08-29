import { buildReceiptEscPosData, type ReceiptLogoRasterizer } from "./escpos-receipt.js";
import type { ReceiptPrintPayload, ReceiptPrinter } from "./printing.js";

/**
 * Envia bytes crus para uma fila de impressao do Windows (datatype RAW). O envio de verdade
 * mora no processo principal (depende do Windows); entra por injecao para este servico ficar
 * testavel e livre de dependencia de sistema operacional.
 */
export type RawSpoolSender = (
  printerName: string,
  data: Buffer,
  documentName: string
) => Promise<void>;

export interface WindowsRawPrinterConfig {
  sendRaw: RawSpoolSender;
  rasterizeLogo?: ReceiptLogoRasterizer;
}

/**
 * Impressora do Windows recebendo ESC/POS pronto, sem passar pelo desenho do driver.
 *
 * ## Por que este caminho existe
 *
 * A impressora termica de cupom (Bematech MP-4200 TH, Elgin, Epson TM...) e nativamente
 * ESC/POS: ela sabe imprimir texto em 48 colunas, centralizar uma linha e marcar uma imagem
 * de 1 bit. O caminho `windows` faz o oposto disso — monta o cupom em HTML, manda o Chromium
 * desenhar uma PAGINA e entrega essa pagina ao driver, que decide sozinho o tamanho do papel,
 * onde fica o que e centralizado e como transformar a logo em pontos. Cada uma dessas
 * decisoes e do driver, nao nossa, e e ai que o cabecalho do cupom (a logo, o `COD`, o
 * `COPIA NRO`, a data/hora) se perdia no papel enquanto aparecia perfeito na previa: o corpo,
 * alinhado a esquerda, sobrevivia; o cabecalho, nao.
 *
 * Aqui nao ha nada para o driver decidir. Sao os MESMOS bytes que a impressora de rede ja
 * recebia (`buildReceiptEscPosData`), entregues na fila do Windows em modo RAW: a impressora
 * imprime exatamente o cupom que montamos — cabecalho, numero, logo e telefone incluidos.
 */
export class WindowsRawEscPosPrinter implements ReceiptPrinter {
  private readonly sendRaw: RawSpoolSender;
  private readonly rasterizeLogo: ReceiptLogoRasterizer | null;

  constructor(config: WindowsRawPrinterConfig) {
    this.sendRaw = config.sendRaw;
    this.rasterizeLogo = config.rasterizeLogo ?? null;
  }

  async printReceipt(payload: ReceiptPrintPayload): Promise<void> {
    const printerName = payload.printerName.trim();

    if (!printerName) {
      throw new Error("Impressora do Windows nao configurada.");
    }

    const data = buildReceiptEscPosData(payload, this.rasterizeLogo);

    await this.sendRaw(printerName, data, receiptDocumentName(payload));
  }
}

/**
 * Nome que aparece na fila de impressao do Windows. Leva o numero do cupom para o operador
 * conseguir identificar (e cancelar) um trabalho especifico quando a impressora empaca.
 */
export function receiptDocumentName(payload: ReceiptPrintPayload): string {
  const receiptNumber = payload.snapshot.header?.receiptNumberLabel;
  return receiptNumber ? `KyberRock cupom ${receiptNumber}` : "KyberRock cupom";
}

/**
 * Estado da impressora do Windows lido logo depois de entregar o cupom na fila.
 *
 * ## Por que isso existe
 *
 * Entregar na fila NAO e imprimir. `WritePrinter` devolve sucesso assim que o spooler aceita
 * os bytes, e o `webContents.print` do caminho grafico faz o mesmo: os dois respondem "deu
 * certo" com a impressora pausada, offline, sem papel ou com a tampa aberta. O cupom entao
 * era gravado como `printed`, a tela nao dizia nada, e do lado do operador a unica evidencia
 * era papel nenhum — foram seis numeros de cupom queimados numa mesma operacao antes de
 * alguem perceber que o problema nao estava no sistema.
 *
 * O que este modulo faz e transformar esse silencio em frase. Nao ha como confirmar que o
 * papel saiu (a termica nao responde), mas da para perguntar ao Windows se a impressora esta
 * em condicao de imprimir — e essa e a diferenca entre "impresso" e "a MP-4200 TH esta em
 * pausa".
 *
 * A leitura e BEST-EFFORT e nunca inventa: quando o Windows nao sabe responder (modulo de
 * impressao ausente, permissao negada), o estado e `unknown` e o cupom segue como antes.
 */
export interface RawSpoolPrinterState {
  /** Como o Windows chama o estado (`Normal`, `Paused`, `Offline`, ...). */
  state: string;
  /** Trabalhos ainda na fila depois do envio. `null` quando nao deu para contar. */
  queuedJobs: number | null;
}

/** Prefixo que o script PowerShell usa para reportar o estado. */
export const RAW_SPOOL_STATE_PREFIX = "KYBERROCK-PRINTER-STATE";

/**
 * Le o estado da saida do script. Formato: `KYBERROCK-PRINTER-STATE <estado> <trabalhos>`.
 *
 * Devolve `null` quando a linha nao veio (script antigo, saida truncada): ausencia de
 * diagnostico nao pode virar diagnostico de problema.
 */
export function parseRawSpoolPrinterState(stdout: string): RawSpoolPrinterState | null {
  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.startsWith(RAW_SPOOL_STATE_PREFIX))
    .pop();
  if (!line) return null;

  const [, state, jobs] = line.split(/\s+/);
  if (!state) return null;

  const queuedJobs = Number.parseInt(jobs ?? "", 10);
  return {
    state,
    queuedJobs: Number.isFinite(queuedJobs) && queuedJobs >= 0 ? queuedJobs : null
  };
}

/**
 * Estados em que a impressora ACEITA o cupom e nao imprime.
 *
 * Lista fechada e conservadora de proposito: so entra aqui o que exige alguem ir ate a
 * impressora. `Printing`, `Busy`, `Processing` e `Warming Up` ficam de FORA — sao a
 * impressora trabalhando, e acusa-los transformaria uma impressao normal em erro.
 */
const BLOCKING_PRINTER_STATES = new Map<string, string>([
  ["paused", "esta em pausa na fila do Windows"],
  ["offline", "esta marcada como offline no Windows"],
  ["error", "esta em estado de erro"],
  ["paperout", "esta sem papel"],
  ["paperjam", "esta com papel preso"],
  ["paperproblem", "esta com problema de papel"],
  ["dooropen", "esta com a tampa aberta"],
  ["notavailable", "nao esta disponivel"],
  ["nottoner", "esta sem suprimento"],
  ["notoner", "esta sem suprimento"],
  ["userinterventionrequired", "esta pedindo intervencao"],
  ["outofmemory", "esta sem memoria"],
  ["pendingdeletion", "esta sendo removida do Windows"]
]);

/**
 * Frase para o operador quando o estado explica o papel que nao saiu; `null` quando nao ha
 * nada a dizer (impressora normal, imprimindo, ou estado desconhecido).
 */
export function describeRawSpoolProblem(
  printerName: string,
  state: RawSpoolPrinterState | null
): string | null {
  if (!state) return null;

  const reason = BLOCKING_PRINTER_STATES.get(state.state.replace(/[\s_-]/g, "").toLowerCase());
  if (!reason) return null;

  const fila =
    state.queuedJobs && state.queuedJobs > 0
      ? ` Ha ${state.queuedJobs} trabalho(s) parado(s) na fila.`
      : "";

  return `A impressora "${printerName}" recebeu o cupom mas ${reason}.${fila}`;
}
