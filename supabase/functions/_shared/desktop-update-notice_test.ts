import { describe, expect, it } from "vitest";

import { resolveUpdateNotice } from "./desktop-update-notice.ts";

describe("resolveUpdateNotice", () => {
  it("sem aviso marcado nao ha nada a fazer", () => {
    expect(resolveUpdateNotice({}, "0.8.200")).toEqual({ kind: "none" });
    expect(resolveUpdateNotice({ update_notice_version: "   " }, "0.8.200")).toEqual({
      kind: "none"
    });
  });

  it("entrega o aviso enquanto a balanca nao chegou na versao pedida", () => {
    const outcome = resolveUpdateNotice(
      {
        update_notice_version: "0.8.201",
        update_notice_sent_at: "2026-08-28T12:00:00.000Z",
        update_notice_seen_at: null
      },
      "0.8.200"
    );

    expect(outcome).toEqual({
      kind: "deliver",
      notice: { version: "0.8.201", requestedAt: "2026-08-28T12:00:00.000Z" },
      markSeen: true
    });
  });

  it("so marca a entrega uma vez: a segunda passada nao reescreve a data", () => {
    // A data diz QUANDO a balanca recebeu o recado. Reescreve-la a cada ping
    // faria toda balanca ligada parecer avisada agora mesmo.
    const outcome = resolveUpdateNotice(
      {
        update_notice_version: "0.8.201",
        update_notice_seen_at: "2026-08-28T12:00:05.000Z"
      },
      "0.8.200"
    );

    expect(outcome).toEqual({
      kind: "deliver",
      notice: { version: "0.8.201", requestedAt: null },
      markSeen: false
    });
  });

  it("apaga o aviso quando a balanca reporta a versao pedida", () => {
    // Sem isso o painel acumularia avisos vencidos para alguem limpar a mao.
    expect(resolveUpdateNotice({ update_notice_version: "0.8.201" }, "0.8.201")).toEqual({
      kind: "clear"
    });
  });

  it("desktop que ainda nao reporta versao mantem o aviso de pe", () => {
    // Nao saber onde a balanca esta nao e o mesmo que ela ter atualizado.
    const outcome = resolveUpdateNotice({ update_notice_version: "0.8.201" }, null);

    expect(outcome.kind).toBe("deliver");
  });
});
