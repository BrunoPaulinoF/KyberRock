import { useMemo, useState } from "react";
import {
  buildReceiptDocument,
  buildSampleReceiptInput,
  DEFAULT_RECEIPT_TEMPLATE_CONFIG,
  RECEIPT_FONT_STACKS,
  receiptOperationCodeLine,
  type ReceiptTemplateConfig
} from "@kyberrock/print-templates";

import type { ReceiptLogoConfig } from "../services/printing";

/**
 * Previa do cupom na tela de impressao. Usa o MESMO construtor do cupom impresso
 * (`buildReceiptDocument`) e a mesma pilha de fontes do HTML enviado para a impressora,
 * entao o que aparece aqui e o que sai no papel — inclusive a logo, o tamanho dos
 * numeros e os blocos ligados/desligados.
 */
export function ReceiptPreviewCard({
  config,
  logo,
  paperWidthMm = 80
}: {
  config: ReceiptTemplateConfig;
  logo: ReceiptLogoConfig;
  paperWidthMm?: number;
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
        Atualiza em tempo real conforme voce configura. Dados de exemplo — a impressao usa os dados
        reais da operacao.
      </p>
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
        <ReceiptPaper config={effectiveConfig} logo={logo} paperWidthMm={paperWidthMm} />
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
  paperWidthMm
}: {
  config: ReceiptTemplateConfig;
  logo: ReceiptLogoConfig;
  paperWidthMm: number;
}) {
  // A data de exemplo e fixa para a previa nao "piscar" a cada render.
  const document = useMemo(
    () => buildReceiptDocument(buildSampleReceiptInput("2026-06-07T12:00:00.000Z"), config),
    [config]
  );
  const style = document.style;
  const header = document.header;
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
        padding: "4mm",
        boxShadow: "0 1px 6px rgba(0,0,0,0.25)",
        fontFamily: RECEIPT_FONT_STACKS[style.fontFamily],
        fontSize: `${style.fontSizePx}px`,
        boxSizing: "border-box"
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
          COPIA NRO {header.receiptNumberLabel}
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
        {renderPreviewBody(document.bodyLines.join("\n"), style.numberFontSizePx, style.fontSizePx)}
      </pre>
    </div>
  );
}

/**
 * Aplica o tamanho configurado para numeros apenas nos numeros — o mesmo recorte que o
 * HTML de impressao faz com `<span class="num">`.
 */
function renderPreviewBody(
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
