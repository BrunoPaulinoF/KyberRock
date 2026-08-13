import { useMemo, useState } from "react";
import {
  buildReceiptDocument,
  buildSampleReceiptInput,
  DEFAULT_RECEIPT_TEMPLATE_CONFIG,
  fitReceiptBodyFontSizePx,
  isReceiptRuleLine,
  receiptBodyStartIndex,
  receiptContentWidthMm,
  receiptCopyNumberLine,
  receiptEscPosFontSizePx,
  receiptEscPosLayout,
  receiptEscPosRenderLine,
  receiptOperationCodeLine,
  splitReceiptNumbers,
  RECEIPT_FONT_STACKS,
  RECEIPT_PAPER_MARGIN_MM,
  type ReceiptDocument,
  type ReceiptEscPosRenderedLine,
  type ReceiptTemplateConfig
} from "@kyberrock/print-templates";

import type { ReceiptLogoConfig } from "../services/printing";

/**
 * Como o cupom sera impresso — e, portanto, como a previa precisa desenha-lo.
 *
 * - `graphic`: a impressora do Windows recebe HTML e o driver desenha (cabecalho grafico).
 * - `escpos`: a impressora recebe os bytes ESC/POS prontos e imprime texto em 48 colunas com
 *   a logo como imagem de 1 bit. O papel NAO tem o cabecalho grafico, entao a previa tambem
 *   nao pode ter: era exatamente essa diferenca que fazia a tela prometer um cupom e o papel
 *   entregar outro.
 */
export type ReceiptPreviewMode = "graphic" | "escpos";

/**
 * Previa do cupom na tela de impressao. Usa o MESMO construtor do cupom impresso
 * (`buildReceiptDocument`) e a mesma pilha de fontes do HTML enviado para a impressora,
 * entao o que aparece aqui e o que sai no papel — inclusive a logo, o tamanho dos
 * numeros e os blocos ligados/desligados.
 */
export function ReceiptPreviewCard({
  config,
  logo,
  paperWidthMm = 80,
  mode = "graphic",
  unsavedChanges = false
}: {
  config: ReceiptTemplateConfig;
  logo: ReceiptLogoConfig;
  paperWidthMm?: number;
  mode?: ReceiptPreviewMode;
  /** Ha edicao no formulario que ainda nao foi gravada no perfil que imprime. */
  unsavedChanges?: boolean;
}) {
  // Compara os dois modelos sem precisar salvar: a aba comeca no modelo selecionado.
  const [tab, setTab] = useState<"selected" | "default">("selected");
  const effectiveConfig = tab === "default" ? DEFAULT_RECEIPT_TEMPLATE_CONFIG : config;

  return (
    <div
      style={{
        // Acompanha a rolagem: o editor fica a esquerda e e comprido, entao a previa
        // precisa continuar visivel enquanto o operador mexe nos controles la embaixo.
        position: "sticky",
        top: "12px",
        border: "1px solid var(--kr-border)",
        borderRadius: "14px",
        background: "var(--kr-surface-soft)",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        minHeight: 0
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <strong style={{ flex: 1, fontSize: "13px", color: "var(--kr-text-strong)" }}>
          Previa do cupom ({paperWidthMm} mm)
        </strong>
        <div style={{ display: "flex", gap: "4px" }}>
          <PreviewTab
            active={tab === "selected"}
            label={config.mode === "custom" ? "Personalizado" : "Padrao"}
            onClick={() => setTab("selected")}
          />
          <PreviewTab
            active={tab === "default"}
            label="Comparar com o padrao"
            onClick={() => setTab("default")}
          />
        </div>
      </div>
      <p style={{ margin: 0, fontSize: "11px", color: "var(--kr-muted)" }}>
        {mode === "escpos"
          ? "Modo texto direto (ESC/POS): o papel sai exatamente assim — a impressora imprime o cupom que montamos, sem o driver do Windows redesenhar nada."
          : "Modo grafico: quem desenha o cupom no papel e o driver da impressora, entao o resultado pode sair diferente desta previa."}{" "}
        Dados de exemplo — a impressao usa os dados reais da operacao.
      </p>
      {/*
        A previa mostra o FORMULARIO; quem imprime e o perfil SALVO. Sem este aviso, digitar o
        telefone de contato (ou trocar a logo) e mandar imprimir mostrava o cupom certo na tela
        e imprimia o antigo no papel — sem nada na tela explicando por que.
      */}
      {unsavedChanges ? (
        <p
          style={{
            margin: 0,
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid var(--kr-warning-border, #b45309)",
            background: "var(--kr-warning-surface, rgba(180, 83, 9, 0.12))",
            color: "var(--kr-text-strong)",
            fontSize: "11px",
            fontWeight: 700
          }}
        >
          Alteracoes ainda nao salvas. O cupom impresso continua saindo com o perfil anterior ate
          voce clicar em &quot;Salvar perfil&quot;.
        </p>
      ) : null}
      {/*
        Bloco (nao flex) de proposito: num container flex que rola, o item filho fica com
        a altura da caixa (`align-items: stretch`) e o texto do cupom vazava para fora do
        papel — o branco terminava no meio da previa e o resto das linhas caia sobre o
        fundo escuro. Com bloco + `margin: 0 auto`, o papel cresce com o conteudo.
      */}
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          maxHeight: "min(60vh, 620px)",
          overflowY: "auto",
          padding: "10px",
          borderRadius: "10px",
          background: "var(--kr-scroll-track)"
        }}
      >
        <ReceiptPaper
          config={effectiveConfig}
          logo={logo}
          paperWidthMm={paperWidthMm}
          mode={mode}
        />
      </div>
    </div>
  );
}

function PreviewTab({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        border: `1px solid ${active ? "var(--kr-primary-strong)" : "var(--kr-border)"}`,
        background: active ? "var(--kr-primary-strong)" : "var(--kr-surface)",
        color: active ? "var(--kr-primary-text)" : "var(--kr-text)",
        borderRadius: "999px",
        padding: "4px 10px",
        cursor: "pointer",
        fontWeight: 800,
        fontSize: "11px"
      }}
    >
      {label}
    </button>
  );
}

/**
 * O papel em si. A largura vem em milimetros para a previa ter a mesma proporcao do
 * cupom real; o navegador converte mm em px, entao o texto quebra onde vai quebrar no
 * papel.
 */
function ReceiptPaper({
  config,
  logo,
  paperWidthMm,
  mode
}: {
  config: ReceiptTemplateConfig;
  logo: ReceiptLogoConfig;
  paperWidthMm: number;
  mode: ReceiptPreviewMode;
}) {
  // A data de exemplo e fixa para a previa nao "piscar" a cada render.
  const document = useMemo(
    () => buildReceiptDocument(buildSampleReceiptInput("2026-06-07T12:00:00.000Z"), config),
    [config]
  );
  const style = document.style;

  if (mode === "escpos") {
    return <EscPosPaper document={document} logo={logo} paperWidthMm={paperWidthMm} />;
  }
  const header = document.header;
  // Faixa util e tamanho das linhas decorativas saem das MESMAS funcoes do HTML de
  // impressao: a previa quebra linha (ou nao) exatamente como o papel.
  const contentWidthMm = receiptContentWidthMm(paperWidthMm);
  const ruleFontSizePx = fitReceiptBodyFontSizePx(
    style.fontSizePx,
    style.fontFamily,
    contentWidthMm
  );
  const logoJustify =
    style.logoAlignment === "left"
      ? "flex-start"
      : style.logoAlignment === "right"
        ? "flex-end"
        : "center";

  return (
    <div
      style={{
        width: `${paperWidthMm}mm`,
        maxWidth: "100%",
        // `margin: 0 auto` centraliza sem flex, para o papel poder crescer com o texto.
        margin: "0 auto",
        background: "#fff",
        color: "#000",
        padding: `${RECEIPT_PAPER_MARGIN_MM}mm`,
        boxShadow: "0 1px 6px rgba(0,0,0,0.25)",
        fontFamily: RECEIPT_FONT_STACKS[style.fontFamily],
        fontSize: `${style.fontSizePx}px`,
        boxSizing: "border-box",
        // O papel corta o que passa da borda; a previa tem que cortar no mesmo lugar.
        overflow: "hidden"
      }}
    >
      {/*
        Codigo da operacao: a primeira linha do cupom, e e por ele que o operador acha a
        venda a partir do papel em maos. A previa nao o desenhava — o cabecalho grafico foi
        copiado para ca antes de o codigo existir —, entao a tela de impressao mostrava
        apenas o numero da copia e parecia que o cupom saia sem codigo nenhum.
      */}
      {header.operationCodeLabel ? (
        <div
          style={{
            textAlign: "center",
            fontWeight: 900,
            letterSpacing: "0.08em",
            fontSize: `${Math.round(style.headerFontSizePx * 1.3)}px`,
            marginBottom: "4px"
          }}
        >
          {receiptOperationCodeLine(header.operationCodeLabel)}
        </div>
      ) : null}
      {header.customHeaderText ? (
        <div style={{ textAlign: "center", fontWeight: 800, marginBottom: "4px" }}>
          {header.customHeaderText}
        </div>
      ) : null}
      {header.nonFiscalLabel ? (
        <div
          style={{
            textAlign: "center",
            fontWeight: 900,
            letterSpacing: "0.06em",
            borderTop: "1px solid #000",
            borderBottom: "1px solid #000",
            padding: "2px 0",
            marginBottom: "4px"
          }}
        >
          {header.nonFiscalLabel}
        </div>
      ) : null}
      {header.companyName ? (
        <>
          <div style={{ fontWeight: 700, letterSpacing: "0.08em" }}>{header.companyName}</div>
          <div style={{ borderTop: "1px solid #000", margin: "4px 0 8px" }} />
        </>
      ) : null}
      {style.showLogo ? (
        <div style={{ display: "flex", justifyContent: logoJustify }}>
          <div
            style={{
              width: `${logo.widthMm}mm`,
              height: `${logo.heightMm}mm`,
              marginBottom: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden"
            }}
          >
            {logo.dataUrl ? (
              <img
                src={logo.dataUrl}
                alt="Logo do cupom"
                style={{ width: "100%", height: "100%", objectFit: logo.fit }}
              />
            ) : (
              <span
                style={{
                  fontSize: `${Math.round(style.headerFontSizePx * 1.3)}px`,
                  fontWeight: 800,
                  textAlign: "center",
                  lineHeight: 1.05
                }}
              >
                {"Pedreira Teste"}
              </span>
            )}
          </div>
        </div>
      ) : null}
      {header.dateLabel ? (
        <div
          style={{
            textAlign: "center",
            fontSize: `${style.headerFontSizePx}px`,
            fontWeight: 700,
            lineHeight: 1.35
          }}
        >
          <div>DATA: {header.dateLabel}</div>
          <div>HORA: {header.timeLabel}</div>
        </div>
      ) : null}
      {header.receiptNumberLabel ? (
        <div
          style={{
            margin: "8px 0 2px",
            textAlign: "center",
            fontSize: `${Math.round(style.headerFontSizePx * 1.2)}px`,
            fontWeight: 900,
            letterSpacing: "0.04em"
          }}
        >
          {receiptCopyNumberLine(header.receiptNumberLabel)}
        </div>
      ) : null}
      {header.copyLabel ? (
        <div style={{ textAlign: "center", fontWeight: 800 }}>{header.copyLabel}</div>
      ) : null}
      <pre
        style={{
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          margin: 0,
          font: "inherit",
          lineHeight: style.lineHeight,
          fontWeight: style.boldBody ? 700 : undefined
        }}
      >
        {renderPreviewBody(document.bodyLines, style, ruleFontSizePx)}
      </pre>
    </div>
  );
}

/**
 * Papel do modo texto direto (ESC/POS) — o que a termica realmente imprime.
 *
 * A aparencia escolhida na tela nao e copiada, e TRADUZIDA: a impressora tem duas fontes
 * embutidas e multiplicadores inteiros, nao um corpo em px. Quem traduz e
 * `receiptEscPosLayout`, e o codificador dos bytes le a mesma traducao — a previa desenha
 * exatamente o que a impressora vai receber, linha por linha, por `receiptEscPosRenderLine`.
 */
function EscPosPaper({
  document,
  logo,
  paperWidthMm
}: {
  document: ReceiptDocument;
  logo: ReceiptLogoConfig;
  paperWidthMm: number;
}) {
  const layout = receiptEscPosLayout(document.style, paperWidthMm);
  const fontSizePx = receiptEscPosFontSizePx(paperWidthMm, layout.columns);
  const showLogo = document.style.showLogo && Boolean(logo.dataUrl);
  const bodyStartIndex = receiptBodyStartIndex(document);
  // A entrelinha da impressora e em pontos, medida contra a altura do caractere.
  const lineHeight = layout.lineSpacingDots / (layout.charHeightDots * layout.bodyHeightScale);

  return (
    <div
      style={{
        width: `${paperWidthMm}mm`,
        maxWidth: "100%",
        margin: "0 auto",
        background: "#fff",
        color: "#000",
        padding: `${RECEIPT_PAPER_MARGIN_MM}mm`,
        boxShadow: "0 1px 6px rgba(0,0,0,0.25)",
        fontFamily: RECEIPT_FONT_STACKS.monospace,
        fontSize: `${fontSizePx}px`,
        boxSizing: "border-box",
        overflow: "hidden"
      }}
    >
      {showLogo ? (
        <div
          style={{
            display: "flex",
            justifyContent:
              layout.logoAlignment === "left"
                ? "flex-start"
                : layout.logoAlignment === "right"
                  ? "flex-end"
                  : "center",
            marginBottom: "4px"
          }}
        >
          <img
            src={logo.dataUrl ?? ""}
            alt="Logo do cupom"
            style={{
              width: `${logo.widthMm}mm`,
              height: `${logo.heightMm}mm`,
              objectFit: logo.fit,
              // A termica e de 1 bit: a previa avisa que o papel nao tem tons de cinza.
              filter: "grayscale(1) contrast(2)"
            }}
          />
        </div>
      ) : null}
      <pre style={{ margin: 0, font: "inherit", whiteSpace: "pre" }}>
        {document.lines.map((line, index) => (
          <EscPosLine
            key={index}
            line={receiptEscPosRenderLine(line, layout, index >= bodyStartIndex)}
            numberHeightScale={layout.numberHeightScale}
            lineHeight={lineHeight}
          />
        ))}
      </pre>
    </div>
  );
}

function EscPosLine({
  line,
  numberHeightScale,
  lineHeight
}: {
  line: ReceiptEscPosRenderedLine;
  numberHeightScale: 1 | 2;
  lineHeight: number;
}) {
  const content = line.emphasizeNumbers
    ? splitReceiptNumbers(line.text).map((part, index) =>
        part.isNumber ? (
          <EscPosGlyphs key={index} heightScale={numberHeightScale}>
            {part.text}
          </EscPosGlyphs>
        ) : (
          part.text
        )
      )
    : line.text || " ";

  return (
    <div
      style={{
        textAlign: line.align,
        // A altura dupla come duas linhas de papel; a entrelinha da impressora ja considera
        // isso, entao a previa reserva o mesmo espaco.
        lineHeight: lineHeight * Math.max(line.heightScale, numberHeightScale),
        fontWeight: line.bold ? 700 : undefined
      }}
    >
      <EscPosGlyphs widthScale={line.widthScale} heightScale={line.heightScale}>
        {content}
      </EscPosGlyphs>
    </div>
  );
}

/**
 * Caracteres nos multiplicadores da impressora. `GS ! n` estica o DESENHO do caractere, e nao
 * troca por uma fonte maior — `scale` reproduz isso, e mantem a largura da coluna quando so a
 * altura dobra.
 */
function EscPosGlyphs({
  children,
  widthScale = 1,
  heightScale = 1
}: {
  children: React.ReactNode;
  widthScale?: 1 | 2;
  heightScale?: 1 | 2;
}) {
  if (widthScale === 1 && heightScale === 1) {
    return <>{children}</>;
  }

  return (
    <span
      style={{
        display: "inline-block",
        transform: `scale(${widthScale}, ${heightScale})`,
        transformOrigin: "center"
      }}
    >
      {children}
    </span>
  );
}

/**
 * Corpo do cupom como o HTML de impressao monta: linha decorativa (divisor, assinatura) no
 * tamanho que cabe na faixa util do papel e numeros no tamanho configurado para numeros.
 */
function renderPreviewBody(
  bodyLines: string[],
  style: { numberFontSizePx: number; fontSizePx: number },
  ruleFontSizePx: number
): React.ReactNode {
  return bodyLines.map((line, index) => (
    <span key={index}>
      {isReceiptRuleLine(line) ? (
        // `pre` (nao quebra) e o mesmo comportamento do cupom impresso: o traco que sobrar
        // e cortado na borda do papel em vez de virar um toco de tracos na linha de baixo.
        <span style={{ fontSize: `${ruleFontSizePx}px`, whiteSpace: "pre" }}>{line}</span>
      ) : (
        renderPreviewLine(line, style.numberFontSizePx, style.fontSizePx)
      )}
      {index < bodyLines.length - 1 ? "\n" : null}
    </span>
  ));
}

/**
 * Aplica o tamanho configurado para numeros apenas nos numeros — o mesmo recorte que o
 * HTML de impressao faz com `<span class="num">`.
 */
function renderPreviewLine(
  text: string,
  numberFontSizePx: number,
  fontSizePx: number
): React.ReactNode {
  if (numberFontSizePx === fontSizePx) return text;

  const parts = text.split(/(\d[\d.,]*)/g);
  return parts.map((part, index) =>
    /^\d/.test(part) ? (
      <span
        key={index}
        style={{
          fontSize: `${numberFontSizePx}px`,
          fontWeight: numberFontSizePx > fontSizePx ? 700 : undefined
        }}
      >
        {part}
      </span>
    ) : (
      part
    )
  );
}
