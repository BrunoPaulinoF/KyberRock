import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildStateUrl, formatCountdown } from "./WhatsappConnect";

const pagesDir = dirname(fileURLToPath(import.meta.url));

describe("buildStateUrl", () => {
  it("consulta o QR na Edge Function, onde o JSON passa intacto", () => {
    expect(buildStateUrl("https://projeto.supabase.co", "tok")).toBe(
      "https://projeto.supabase.co/functions/v1/whatsapp-link/c/tok/state"
    );
  });

  it("tolera barra sobrando na url do projeto", () => {
    expect(buildStateUrl("https://projeto.supabase.co/", "tok")).toBe(
      "https://projeto.supabase.co/functions/v1/whatsapp-link/c/tok/state"
    );
  });

  it("escapa o token vindo da URL antes de montar o endereco", () => {
    expect(buildStateUrl("https://projeto.supabase.co", "a/b?c")).toBe(
      "https://projeto.supabase.co/functions/v1/whatsapp-link/c/a%2Fb%3Fc/state"
    );
  });
});

describe("formatCountdown", () => {
  it("mostra mm:ss e nunca desce abaixo de zero", () => {
    expect(formatCountdown(15 * 60_000)).toBe("15:00");
    expect(formatCountdown(61_200)).toBe("01:02");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-5_000)).toBe("00:00");
  });
});

describe("WhatsappConnect", () => {
  const source = readFileSync(resolve(pagesDir, "WhatsappConnect.tsx"), "utf8");

  it("mostra o QR, a contagem regressiva e o passo a passo do pareamento", () => {
    expect(source).toContain("Escaneie o QR code");
    expect(source).toContain("Expira em ");
    expect(source).toContain("Aparelhos conectados");
    expect(source).toContain("Conectar aparelho");
  });

  it("cobre os tres finais possiveis do link", () => {
    expect(source).toContain("WhatsApp conectado!");
    expect(source).toContain("Link cancelado");
    expect(source).toContain("Link expirado");
  });

  it("nao pede login nem toca no cliente Supabase — o convidado nao tem conta", () => {
    expect(source).not.toContain("useAuth");
    expect(source).not.toContain('from "../lib/supabase"');
  });

  it("e uma rota publica do site, fora das rotas privadas", () => {
    const appSource = readFileSync(resolve(pagesDir, "..", "App.tsx"), "utf8");
    expect(appSource).toContain('path="/whatsapp/:token"');
    expect(appSource).toContain("<WhatsappConnect />");
    expect(appSource).not.toContain("<PrivateLoaderRoute>\n            <WhatsappConnect />");
  });
});
