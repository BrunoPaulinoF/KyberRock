import { describe, expect, it } from "vitest";

import {
  BILLING_SECRETS,
  describeEnvVarNameError,
  isValidEnvVarName,
  looksLikeSecretValue,
  maskSecretValue,
  resolveAllBillingSecrets,
  resolveBillingSecret,
  resolveEnvVarName
} from "./billing-secrets.ts";

const MP_TOKEN = BILLING_SECRETS[0];

function envFrom(entries: Record<string, string>) {
  return (name: string) => entries[name];
}

describe("isValidEnvVarName", () => {
  it("accepts POSIX-style names", () => {
    expect(isValidEnvVarName("MERCADO_PAGO_ACCESS_TOKEN")).toBe(true);
    expect(isValidEnvVarName("_PRIVADO")).toBe(true);
    expect(isValidEnvVarName("MP2")).toBe(true);
  });

  it("rejects anything that is not a variable name", () => {
    expect(isValidEnvVarName("")).toBe(false);
    expect(isValidEnvVarName("token do mercado pago")).toBe(false);
    expect(isValidEnvVarName("mercado_pago")).toBe(false);
    expect(isValidEnvVarName("2FATORES")).toBe(false);
    expect(isValidEnvVarName("A".repeat(65))).toBe(false);
  });
});

describe("looksLikeSecretValue", () => {
  it("recognizes a pasted Mercado Pago token", () => {
    expect(looksLikeSecretValue("APP_USR-1234567890abcdef-081211-abc")).toBe(true);
    expect(looksLikeSecretValue("TEST-9999999999999999")).toBe(true);
  });

  it("does not flag a plain variable name", () => {
    expect(looksLikeSecretValue("MERCADO_PAGO_ACCESS_TOKEN")).toBe(false);
  });
});

describe("describeEnvVarNameError", () => {
  it("is silent for an empty field — empty means 'use the default name'", () => {
    expect(describeEnvVarNameError("")).toBeNull();
    expect(describeEnvVarNameError("   ")).toBeNull();
  });

  it("is silent for a valid name", () => {
    expect(describeEnvVarNameError("MERCADO_PAGO_ACCESS_TOKEN")).toBeNull();
  });

  it("says the value goes in the Supabase secret when a token was pasted", () => {
    const message = describeEnvVarNameError("APP_USR-1234567890abcdef-081211-abc");
    expect(message).toContain("NOME da variavel");
    expect(message).toContain("Secrets");
  });

  it("explains the allowed characters for a malformed name", () => {
    expect(describeEnvVarNameError("MP TOKEN!")).toContain("letras maiusculas");
  });
});

describe("resolveEnvVarName", () => {
  it("falls back to the canonical name", () => {
    expect(resolveEnvVarName(null, "MERCADO_PAGO_ACCESS_TOKEN")).toBe("MERCADO_PAGO_ACCESS_TOKEN");
    expect(resolveEnvVarName("", "MERCADO_PAGO_ACCESS_TOKEN")).toBe("MERCADO_PAGO_ACCESS_TOKEN");
  });

  it("uses the configured name when it is valid", () => {
    expect(resolveEnvVarName("MP_CONTA_2", "MERCADO_PAGO_ACCESS_TOKEN")).toBe("MP_CONTA_2");
  });

  it("ignores an invalid configured name instead of reading a bogus variable", () => {
    expect(resolveEnvVarName("mp conta 2", "MERCADO_PAGO_ACCESS_TOKEN")).toBe(
      "MERCADO_PAGO_ACCESS_TOKEN"
    );
  });
});

describe("maskSecretValue", () => {
  it("shows only the last four characters", () => {
    expect(maskSecretValue("APP_USR-abcdef123456")).toBe("••••3456");
    expect(maskSecretValue("abc")).toBe("");
    expect(maskSecretValue("")).toBe("");
  });
});

describe("resolveBillingSecret", () => {
  it("reads the value from the default variable", () => {
    const resolved = resolveBillingSecret({
      definition: MP_TOKEN,
      configuredName: null,
      readEnv: envFrom({ MERCADO_PAGO_ACCESS_TOKEN: "APP_USR-abcdef123456" })
    });
    expect(resolved).toMatchObject({
      envVar: "MERCADO_PAGO_ACCESS_TOKEN",
      isCustomEnvVar: false,
      configured: true,
      preview: "••••3456",
      value: "APP_USR-abcdef123456"
    });
  });

  it("reads from a custom variable and flags it as custom", () => {
    const resolved = resolveBillingSecret({
      definition: MP_TOKEN,
      configuredName: "MP_CONTA_2",
      readEnv: envFrom({ MP_CONTA_2: "APP_USR-999999999999" })
    });
    expect(resolved.envVar).toBe("MP_CONTA_2");
    expect(resolved.isCustomEnvVar).toBe(true);
    expect(resolved.value).toBe("APP_USR-999999999999");
  });

  it("reports not configured when the secret is missing or blank", () => {
    expect(
      resolveBillingSecret({ definition: MP_TOKEN, configuredName: null, readEnv: envFrom({}) })
    ).toMatchObject({ configured: false, preview: "", value: "" });
    expect(
      resolveBillingSecret({
        definition: MP_TOKEN,
        configuredName: null,
        readEnv: envFrom({ MERCADO_PAGO_ACCESS_TOKEN: "   " })
      })
    ).toMatchObject({ configured: false, value: "" });
  });
});

describe("resolveAllBillingSecrets", () => {
  it("separates the values from what the screen may see", () => {
    const { values, status } = resolveAllBillingSecrets({
      settingsRow: { whatsapp_instance_token_env: "UAZAPI_COBRANCA" },
      readEnv: envFrom({
        MERCADO_PAGO_ACCESS_TOKEN: "APP_USR-abcdef123456",
        UAZAPI_COBRANCA: "uaz-token-7890"
      })
    });

    expect(values.mercadoPagoAccessToken).toBe("APP_USR-abcdef123456");
    expect(values.whatsappInstanceToken).toBe("uaz-token-7890");
    expect(values.mercadoPagoWebhookSecret).toBe("");

    // O que vai para a tela nao pode carregar o valor de jeito nenhum.
    expect(JSON.stringify(status)).not.toContain("APP_USR-abcdef123456");
    expect(JSON.stringify(status)).not.toContain("uaz-token-7890");
    expect(status.map((item) => item.envVar)).toEqual([
      "MERCADO_PAGO_ACCESS_TOKEN",
      "MERCADO_PAGO_WEBHOOK_SECRET",
      "UAZAPI_COBRANCA"
    ]);
    expect(status.map((item) => item.configured)).toEqual([true, false, true]);
  });

  it("covers every declared secret", () => {
    const { status } = resolveAllBillingSecrets({ settingsRow: {}, readEnv: envFrom({}) });
    expect(status).toHaveLength(BILLING_SECRETS.length);
    expect(status.every((item) => item.configured === false)).toBe(true);
  });
});
