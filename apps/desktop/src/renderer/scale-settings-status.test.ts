import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(rendererDir, "App.tsx"), "utf8");

function sliceBetween(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

/** Corpo da tela Configuracoes > Balanca. */
function scaleViewSource(): string {
  return sliceBetween("function ScaleView({ desktopApi }", "\nfunction ");
}

describe("Configuracoes > Balanca: status da conexao", () => {
  // A sondagem de status so rodava com `connected` ligado e, ao ver a primeira
  // queda, chamava setConnected(false) — derrubando o proprio intervalo. A tela
  // travava em "Desconectado" e nunca mais voltava sozinha, mesmo com o adaptador
  // ja reconectado: so o botao manual recuperava.
  it("sonda o status sem depender de a tela ja se considerar conectada", () => {
    const view = scaleViewSource();
    const poll = view.slice(view.indexOf("// Sonda o status a cada 3s"));

    expect(poll).toContain("if (!desktopApi) return;");
    expect(poll).not.toContain("if (!connected || !desktopApi) return;");
  });

  it("nao usa `connected` como dependencia do efeito de sondagem", () => {
    const view = scaleViewSource();
    const poll = view.slice(
      view.indexOf("// Sonda o status a cada 3s"),
      view.indexOf("// Atualiza a lista de portas")
    );

    // Com `connected` na lista de dependencias, o efeito se desmonta e remonta a
    // cada mudanca de estado — o caminho que fazia o intervalo morrer na queda.
    expect(poll).toContain("}, [desktopApi]);");
    expect(poll).not.toContain("}, [connected, desktopApi]);");
  });

  it("deriva o estado conectado do adaptador, e nao de um latch local", () => {
    const view = scaleViewSource();

    expect(view).toContain("setConnected(link.usable)");
    expect(view).toContain("buildScaleLinkViewModel({");
  });

  it("zera a prova de leitura ao vivo quando o operador desconecta", () => {
    // Sem isto a sondagem veria a leitura de segundos atras, concluiria que a
    // balanca segue utilizavel e desfaria na tela a desconexao pedida.
    const disconnect = sliceBetween(
      "async function handleDisconnect(): Promise<void> {",
      "async function handleSaveConfig("
    );

    expect(disconnect).toContain("lastScaleReadingAtRef.current = null;");
  });
});

describe("main: encaminhador de leituras da balanca", () => {
  const mainSource = readFileSync(resolve(rendererDir, "../main/main.ts"), "utf8");

  it("registra o forwarder no boot mesmo quando o auto-connect falha", () => {
    // Preso dentro do `if (connected)`, ele nunca era registrado quando o indicador
    // ainda nao respondia no boot; o adaptador reconectava sozinho depois e a tela
    // ficava com a balanca conectada e o peso parado em "-- kg".
    const boot = mainSource.slice(
      mainSource.indexOf("// Auto-connect scale on startup if configured"),
      mainSource.indexOf("const devServerUrl")
    );

    expect(boot).toContain("attachScaleReadingForwarder();");
    expect(boot).not.toMatch(/if \(connected\) \{\s*attachScaleReadingForwarder\(\);/);
  });
});
