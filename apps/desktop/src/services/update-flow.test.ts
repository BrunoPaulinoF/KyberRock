import { describe, expect, it } from "vitest";

import { getManualUpdateButtonLabel } from "./update-flow";

describe("getManualUpdateButtonLabel", () => {
  it("asks the operator to install only after an update is available", () => {
    expect(getManualUpdateButtonLabel("idle")).toBe("Verificar atualizacao");
    expect(getManualUpdateButtonLabel("available")).toBe("Baixar e instalar atualizacao");
    expect(getManualUpdateButtonLabel("downloaded")).toBe("Reiniciar e instalar");
  });
});
