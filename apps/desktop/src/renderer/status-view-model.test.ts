import { describe, expect, it } from "vitest";

import { buildStatusIndicatorViewModels } from "./status-view-model";

describe("buildStatusIndicatorViewModels", () => {
  it("creates the six Phase 3 visual indicators", () => {
    const indicators = buildStatusIndicatorViewModels({
      internet: "offline",
      scale: "not_configured",
      firebase: "not_configured",
      omie: "not_configured",
      pendingSyncJobs: 2,
      lastBackupAt: "2026-06-06T12:00:00.000Z",
      databasePath: "C:/KyberRock/data/kyberrock.sqlite3",
      identity: {
        companyId: "company-1",
        unitId: "unit-1",
        deviceId: "device-1",
        installationId: "install-1"
      },
      generatedAt: "2026-06-06T12:30:00.000Z"
    });

    expect(indicators.map((indicator) => indicator.label)).toEqual([
      "Internet",
      "Balanca",
      "Firebase",
      "OMIE",
      "Fila pendente",
      "Ultimo backup"
    ]);
    expect(indicators[0]).toMatchObject({ tone: "danger", value: "Offline" });
    expect(indicators[4]).toMatchObject({ tone: "warning", value: "2 pendente(s)" });
  });
});
