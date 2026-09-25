/**
 * Como o site entrega os relatorios que o KyberRock Desktop salva em arquivo.
 *
 * O desktop monta cada relatorio como HTML (`lib/desktop/*-render.ts`, copias fieis do desktop)
 * e salva: o PDF passa pelo `printToPDF` do Electron, e o "Excel" e o proprio HTML de tabela
 * gravado com extensao `.xls` (o Excel abre com as celulas tipadas). O site entrega o MESMO HTML:
 *
 * - PDF: abre a janela de impressao do navegador com o documento — la se imprime ou escolhe
 *   "Salvar como PDF", ja com o nome de arquivo do desktop.
 * - Excel: baixa o HTML como `.xls`, com o mesmo nome de arquivo do desktop.
 */

/** Um documento pronto do desktop: nome do arquivo e o HTML. */
export interface ReportFile {
  filename: string;
  html: string;
}

/**
 * Abre a impressao do navegador com o documento. Resolve quando a janela de impressao fecha
 * (ou depois de um tempo, no navegador sem `afterprint`), para dois documentos seguidos nao
 * disputarem a mesma janela.
 */
export function printReportHtml(html: string, filename?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, {
      position: "fixed",
      width: "0",
      height: "0",
      border: "0",
      right: "0",
      bottom: "0"
    });
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      frame.remove();
      reject(new Error("O navegador bloqueou a impressao."));
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    // O "Salvar como PDF" sugere o titulo do documento como nome: trocando so o titulo da
    // pagina aberta (o HTML fica igual ao do desktop), o arquivo sugerido e o mesmo do desktop.
    if (filename) doc.title = filename.replace(/\.pdf$/i, "");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setTimeout(() => frame.remove(), 1000);
      resolve();
    };
    win.addEventListener("afterprint", finish, { once: true });
    setTimeout(() => {
      win.focus();
      win.print();
      // `print()` bloqueia ate a janela fechar na maioria dos navegadores; sem `afterprint`,
      // o quadro sai depois de um minuto.
      setTimeout(finish, 60_000);
    }, 250);
  });
}

/** Baixa um arquivo gerado no navegador. */
export function downloadFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** O "Excel" do desktop: o HTML de planilha salvo como `.xls` (UTF-8, como o desktop grava). */
export function downloadSpreadsheet(file: ReportFile): void {
  downloadFile(file.filename, file.html, "application/vnd.ms-excel;charset=utf-8");
}

/**
 * Entrega os documentos escolhidos: planilhas baixam na hora; PDFs abrem a impressao um de
 * cada vez.
 */
export async function deliverReports(files: {
  pdf: ReportFile[];
  xls: ReportFile[];
}): Promise<void> {
  for (const file of files.xls) downloadSpreadsheet(file);
  for (const file of files.pdf) await printReportHtml(file.html, file.filename);
}
