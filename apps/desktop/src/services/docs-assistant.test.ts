import { describe, expect, it } from "vitest";

import type { DesktopDatabase } from "../database/sqlite.js";
import { askDocsAssistant } from "./docs-assistant.js";

/**
 * Banco falso com apenas o suficiente para `readStringLocalSetting`: o que este
 * teste cobre sao as guardas ANTES de qualquer rede — a parte que decide, sem
 * chamar a nuvem, que o chat deve responder com a documentacao local.
 */
function fakeDatabase(settings: Record<string, string>): DesktopDatabase {
  return {
    prepare: () => ({
      get: (key: string) =>
        key in settings ? { value_json: JSON.stringify(settings[key]) } : undefined
    })
  } as unknown as DesktopDatabase;
}

const activated = {
  cloud_device_id: "device-1",
  cloud_device_token: "token-1"
};

describe("askDocsAssistant", () => {
  it("recusa pergunta vazia sem tocar na nuvem", async () => {
    const result = await askDocsAssistant(fakeDatabase(activated), {
      question: "   ",
      passages: [],
      history: []
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain("vazia");
  });

  it("fica indisponivel quando o dispositivo ainda nao foi ativado", async () => {
    const result = await askDocsAssistant(fakeDatabase({}), {
      question: "como emito a nota fiscal?",
      passages: [],
      history: []
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain("ativado");
  });

  it("fica indisponivel quando so metade da ativacao existe", async () => {
    const result = await askDocsAssistant(fakeDatabase({ cloud_device_id: "device-1" }), {
      question: "como emito a nota fiscal?",
      passages: [],
      history: []
    });

    expect(result.available).toBe(false);
  });

  it("nunca lanca quando o banco falha — degrada para indisponivel", async () => {
    const broken = {
      prepare: () => {
        throw new Error("banco indisponivel");
      }
    } as unknown as DesktopDatabase;

    const result = await askDocsAssistant(broken, {
      question: "como emito a nota fiscal?",
      passages: [],
      history: []
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain("banco indisponivel");
  });
});
