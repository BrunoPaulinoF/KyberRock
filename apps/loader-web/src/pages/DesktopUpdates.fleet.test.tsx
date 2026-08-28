import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FleetVersionBars } from "./DesktopUpdates";
import { groupFleetVersions, type FleetDeviceLike } from "../lib/desktop-updates";

function device(
  id: string,
  version: string | null,
  overrides: Partial<FleetDeviceLike> = {}
): FleetDeviceLike {
  return { id, name: `Balanca ${id}`, version, ...overrides };
}

describe("FleetVersionBars", () => {
  it("mostra a versao, quantas balancas estao nela e QUAIS sao", () => {
    // A pergunta que o grafico responde nao e "quantos por cento": e qual
    // computador ficou para tras depois de uma liberacao.
    const devices = [
      device("a", "0.8.200", { name: "Portaria", unitName: "Pedreira Sul" }),
      device("b", "0.8.193", { name: "Escritorio" })
    ];
    const html = renderToStaticMarkup(
      <FleetVersionBars
        groups={groupFleetVersions(devices, { productionVersion: "0.8.200" })}
        total={devices.length}
      />
    );

    expect(html).toContain("0.8.200");
    expect(html).toContain("Portaria");
    expect(html).toContain("Pedreira Sul");
    expect(html).toContain("Escritorio");
    expect(html).toContain("1 de 2 balancas");
  });

  it("a balanca sem versao reportada aparece como sem informacao, nao como zero", () => {
    const devices = [device("a", null, { name: "Deposito" })];
    const html = renderToStaticMarkup(
      <FleetVersionBars groups={groupFleetVersions(devices)} total={devices.length} />
    );

    expect(html).toContain("Sem informacao");
    expect(html).toContain("Deposito");
  });

  it("uma balanca sozinha numa frota grande ainda desenha uma barra visivel", () => {
    // Sem largura minima a unica maquina atrasada — justamente a que interessa
    // — viraria uma barra de zero pixel.
    const devices = [
      ...Array.from({ length: 60 }, (_, index) => device(`ok${index}`, "0.8.200")),
      device("atrasada", "0.8.100")
    ];
    const html = renderToStaticMarkup(
      <FleetVersionBars
        groups={groupFleetVersions(devices, { productionVersion: "0.8.200" })}
        total={devices.length}
      />
    );

    expect(html).toContain("width:2%");
  });
});
