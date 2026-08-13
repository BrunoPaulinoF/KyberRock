import { receiptHighlightLines } from "@kyberrock/print-templates";

import { encodeEscPos, type EscPosRasterImage } from "./escpos-encoder.js";
import { maxLogoWidthDots } from "./receipt-logo-raster.js";
import type { ReceiptLogoRasterizer } from "./network-printer.js";
import type { ReceiptPrintPayload, ReceiptPrinter } from "./printing.js";

/**
 * Impressao ESC/POS DIRETA na termica instalada no Windows.
 *
 * ## Por que existe
 *
 * No tipo "windows" o cupom vai como pagina HTML e quem decide como o papel sai e o
 * driver: tamanho de pagina, margens, escala e ate se a imagem sera impressa dependem de
 * como aquele computador esta configurado. Numa termica isso e um intermediario a toa — e
 * um intermediario que ja custou caro: cupom saindo sem a logo e sem o numero porque o
 * driver diagramava numa pagina A4/Carta e tudo que e centralizado caia fora da bobina.
 *
 * A termica (Bematech MP-4200 TH, Epson TM, Elgin, Daruma...) entende ESC/POS — o MESMO
 * fluxo de bytes que a impressora de rede ja recebe aqui: a logo como bit image no tamanho
 * exato em pontos e o texto em 48 colunas. Mandando ESC/POS direto, o que sai no papel
 * depende so do KyberRock; nao ha nada para acertar no driver.
 *
 * ## Como os bytes chegam na impressora
 *
 * O spooler do Windows aceita um trabalho "RAW" — bytes que ele entrega a impressora sem
 * passar pelo desenho do driver. A API e a `winspool.drv` (OpenPrinter / StartDocPrinter
 * com datatype RAW / WritePrinter), que o app alcanca por um script PowerShell gerado aqui.
 * E de proposito que nao ha modulo nativo no meio: o desktop ja sofre com recompilacao
 * nativa (`better-sqlite3`), e uma dependencia nova quebraria o instalador em toda troca de
 * versao do Electron.
 */

/** Nome do trabalho que aparece na fila de impressao do Windows. */
export const WINDOWS_RAW_DOCUMENT_NAME = "KyberRock - cupom";

/**
 * Script que entrega os bytes ao spooler. Recebe o nome da impressora e o arquivo com o
 * cupom ja em ESC/POS; qualquer falha vira excecao com o codigo de erro do Windows, que o
 * app mostra na tela de impressao em vez de engolir.
 */
export const WINDOWS_RAW_PRINT_SCRIPT = `param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$Path
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class KyberRockRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DocInfo
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, EntryPoint = "OpenPrinterW", SetLastError = true)]
    private static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, EntryPoint = "StartDocPrinterW", SetLastError = true)]
    private static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] DocInfo di);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static void Send(string printerName, string documentName, byte[] bytes)
    {
        IntPtr printer;

        if (!OpenPrinter(printerName, out printer, IntPtr.Zero))
        {
            throw new Exception("Nao foi possivel abrir a impressora (erro " + Marshal.GetLastWin32Error() + ").");
        }

        try
        {
            DocInfo info = new DocInfo();
            info.pDocName = documentName;
            info.pDataType = "RAW";

            if (StartDocPrinter(printer, 1, info) == 0)
            {
                throw new Exception("A fila de impressao recusou o trabalho (erro " + Marshal.GetLastWin32Error() + ").");
            }

            try
            {
                if (!StartPagePrinter(printer))
                {
                    throw new Exception("A fila de impressao recusou a pagina (erro " + Marshal.GetLastWin32Error() + ").");
                }

                IntPtr buffer = Marshal.AllocCoTaskMem(bytes.Length);

                try
                {
                    Marshal.Copy(bytes, 0, buffer, bytes.Length);
                    int written;

                    if (!WritePrinter(printer, buffer, bytes.Length, out written))
                    {
                        throw new Exception("Falha ao enviar o cupom para a impressora (erro " + Marshal.GetLastWin32Error() + ").");
                    }

                    if (written != bytes.Length)
                    {
                        throw new Exception("A impressora recebeu " + written + " de " + bytes.Length + " bytes do cupom.");
                    }
                }
                finally
                {
                    Marshal.FreeCoTaskMem(buffer);
                }

                EndPagePrinter(printer);
            }
            finally
            {
                EndDocPrinter(printer);
            }
        }
        finally
        {
            ClosePrinter(printer);
        }
    }
}
"@

[KyberRockRawPrinter]::Send($PrinterName, '${WINDOWS_RAW_DOCUMENT_NAME}', [System.IO.File]::ReadAllBytes($Path))
`;

/** Como o PowerShell e chamado: sem perfil, sem interacao e sem depender da politica local. */
export function buildWindowsRawPrintCommand(
  scriptPath: string,
  printerName: string,
  dataPath: string
): { command: string; args: string[] } {
  return {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-PrinterName",
      printerName,
      "-Path",
      dataPath
    ]
  };
}

export interface WindowsRawCommandResult {
  code: number;
  stderr: string;
}

export interface WindowsRawPrinterDeps {
  /** Grava um arquivo temporario (o script e o cupom em bytes). */
  writeFile: (path: string, data: string | Buffer) => void;
  /** Apaga o arquivo temporario; nunca pode derrubar a impressao. */
  removeFile: (path: string) => void;
  /** Caminho de um arquivo temporario com o nome dado. */
  tempPath: (fileName: string) => string;
  /** Executa o PowerShell e devolve o codigo de saida e o erro. */
  run: (command: string, args: string[]) => Promise<WindowsRawCommandResult>;
  /** Converte a logo configurada no bit image da termica (injetado: depende do Electron). */
  rasterizeLogo?: ReceiptLogoRasterizer;
  /** Identificador unico do arquivo temporario (injetado para o teste ser previsivel). */
  uniqueId: () => string;
}

export class WindowsRawEscPosPrinter implements ReceiptPrinter {
  private readonly deps: WindowsRawPrinterDeps;

  constructor(deps: WindowsRawPrinterDeps) {
    this.deps = deps;
  }

  async printReceipt(payload: ReceiptPrintPayload): Promise<void> {
    const printerName = payload.printerName.trim();

    if (!printerName) {
      throw new Error("Selecione a impressora do Windows no perfil de cupom.");
    }

    const data = encodeEscPos(payload.lines, payload.paperWidthMm, this.buildLogo(payload), {
      emphasizedLines: receiptHighlightLines(payload.snapshot.header)
    });
    const id = this.deps.uniqueId();
    const scriptPath = this.deps.tempPath(`kyberrock-cupom-${id}.ps1`);
    const dataPath = this.deps.tempPath(`kyberrock-cupom-${id}.bin`);

    try {
      this.deps.writeFile(scriptPath, WINDOWS_RAW_PRINT_SCRIPT);
      this.deps.writeFile(dataPath, data);

      const { command, args } = buildWindowsRawPrintCommand(scriptPath, printerName, dataPath);
      const result = await this.deps.run(command, args);

      if (result.code !== 0) {
        throw new Error(describeWindowsRawFailure(printerName, result));
      }
    } finally {
      this.deps.removeFile(scriptPath);
      this.deps.removeFile(dataPath);
    }
  }

  /** Uma logo invalida nunca pode impedir a impressao do cupom — no pior caso sai sem ela. */
  private buildLogo(payload: ReceiptPrintPayload): EscPosRasterImage | null {
    const logo = payload.snapshot.receiptLogo;

    if (payload.snapshot.style?.showLogo === false) {
      return null;
    }

    if (!this.deps.rasterizeLogo || !logo?.dataUrl) {
      return null;
    }

    try {
      return this.deps.rasterizeLogo(logo, maxLogoWidthDots(payload.paperWidthMm));
    } catch {
      return null;
    }
  }
}

/**
 * Erro que o operador consegue agir em cima. O PowerShell escreve a excecao no stderr; o
 * que interessa e a primeira linha (a mensagem), nao o rastro de pilha.
 */
export function describeWindowsRawFailure(
  printerName: string,
  result: WindowsRawCommandResult
): string {
  const detail = result.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return detail
    ? `Falha ao imprimir em ${printerName}: ${detail}`
    : `Falha ao imprimir em ${printerName} (codigo ${result.code}).`;
}
