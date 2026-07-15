import { describe, expect, it } from "vitest";

import {
  AUTO_DOWNLOAD_UPDATES,
  AUTO_INSTALL_ON_QUIT,
  getManualUpdateButtonLabel
} from "./update-flow";

describe("auto-update policy", () => {
  it("downloads updates and installs them on quit without operator action", () => {
    expect(AUTO_DOWNLOAD_UPDATES).toBe(true);
    expect(AUTO_INSTALL_ON_QUIT).toBe(true);
  });
});

describe("getManualUpdateButtonLabel", () => {
  it("asks the operator to install only after an update is available", () => {
    expect(getManualUpdateButtonLabel("idle")).toBe("Verificar atualizacao");
    expect(getManualUpdateButtonLabel("available")).toBe("Baixar e instalar atualizacao");
    expect(getManualUpdateButtonLabel("downloaded")).toBe("Reiniciar e instalar");
  });
});
