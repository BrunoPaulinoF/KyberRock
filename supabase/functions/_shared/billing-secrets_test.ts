import { describe, expect, it } from "vitest";

import {
  BILLING_SECRETS,
  maskSecretValue,
  resolveAllBillingSecrets,
  resolveBillingSecret
} from "./billing-secrets.ts";

const MP_TOKEN = BILLING_SECRETS[0];

function envFrom(entries: Record<string, string>) {
  return (name: string) => entries[name];
}

describe("BILLING_SECRETS", () => {
  it("pins each variable name in code — the panel cannot change them", () => {
    expect(BILLING_SECRETS.map((secret) => secret.envVar)).toEqual([
      "MERCADO_PAGO_ACCESS_TOKEN",
      "MERCADO_PAGO_WEBHOOK_SECRET",
      "UAZAPI_INSTANCE_TOKEN"
    ]);
  });

  it("marks the webhook signature as the only optional one", () => {
    expect(
      BILLING_SECRETS.filter((secret) => !secret.required).map((secret) => secret.key)
    ).toEqual(["mercadoPagoWebhookSecret"]);
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
  it("reads the value from the pinned variable", () => {
    const resolved = resolveBillingSecret({
      definition: MP_TOKEN,
      readEnv: envFrom({ MERCADO_PAGO_ACCESS_TOKEN: "APP_USR-abcdef123456" })
    });
    expect(resolved).toMatchObject({
      envVar: "MERCADO_PAGO_ACCESS_TOKEN",
      configured: true,
      preview: "••••3456",
      value: "APP_USR-abcdef123456"
    });
  });

  it("reports not configured when the secret is missing or blank", () => {
    expect(resolveBillingSecret({ definition: MP_TOKEN, readEnv: envFrom({}) })).toMatchObject({
      configured: false,
      preview: "",
      value: ""
    });
    expect(
      resolveBillingSecret({
        definition: MP_TOKEN,
        readEnv: envFrom({ MERCADO_PAGO_ACCESS_TOKEN: "   " })
      })
    ).toMatchObject({ configured: false, value: "" });
  });
});

describe("resolveAllBillingSecrets", () => {
  it("separates the values from what the screen may see", () => {
    const { values, status } = resolveAllBillingSecrets({
      readEnv: envFrom({
        MERCADO_PAGO_ACCESS_TOKEN: "APP_USR-abcdef123456",
        UAZAPI_INSTANCE_TOKEN: "uaz-token-7890"
      })
    });

    expect(values.mercadoPagoAccessToken).toBe("APP_USR-abcdef123456");
    expect(values.whatsappInstanceToken).toBe("uaz-token-7890");
    expect(values.mercadoPagoWebhookSecret).toBe("");

    // O que vai para a tela nao pode carregar o valor de jeito nenhum.
    expect(JSON.stringify(status)).not.toContain("APP_USR-abcdef123456");
    expect(JSON.stringify(status)).not.toContain("uaz-token-7890");
    expect(status.map((item) => item.configured)).toEqual([true, false, true]);
  });

  it("covers every declared secret", () => {
    const { status } = resolveAllBillingSecrets({ readEnv: envFrom({}) });
    expect(status).toHaveLength(BILLING_SECRETS.length);
    expect(status.every((item) => item.configured === false)).toBe(true);
  });
});
