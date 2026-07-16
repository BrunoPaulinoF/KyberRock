import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));

describe("ReportChannelsSettings", () => {
  const source = readFileSync(resolve(rendererDir, "ReportChannelsSettings.tsx"), "utf8");

  it("has the e-mail (SMTP) configuration fields", () => {
    expect(source).toContain("Servidor SMTP");
    expect(source).toContain("Porta");
    expect(source).toContain("Usuario (e-mail)");
    expect(source).toContain("Senha");
    expect(source).toContain("Testar conexao SMTP");
  });

  it("has the WhatsApp (UAZAPI) configuration and QR flow", () => {
    expect(source).toContain("Servidor UAZAPI (URL)");
    expect(source).toContain("Nome da instancia");
    expect(source).toContain("Token da instancia");
    expect(source).not.toContain("admin token");
    expect(source).toContain("Conectar WhatsApp (gerar QR code)");
    expect(source).toContain("whatsappConnect");
    expect(source).toContain("whatsappDisconnect");
    expect(source).toContain("qrcode");
  });

  it("shows clear connection states", () => {
    expect(source).toContain("WhatsApp conectado");
    expect(source).toContain("WhatsApp conectando...");
    expect(source).toContain("WhatsApp desconectado");
    expect(source).toContain("WhatsApp nao configurado");
  });

  it("polls the status while the QR code is on screen", () => {
    expect(source).toContain("setInterval");
    expect(source).toContain("whatsappStatus");
  });

  it("is rendered by the reports view", () => {
    const reportsSource = readFileSync(resolve(rendererDir, "ReportsView.tsx"), "utf8");
    expect(reportsSource).toContain("ReportChannelsSettings");
  });
});
