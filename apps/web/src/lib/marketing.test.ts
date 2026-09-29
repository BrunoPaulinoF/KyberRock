import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildWhatsAppLink,
  DESKTOP_DOWNLOAD_URL,
  formatWhatsAppNumber,
  GUIDE_PDF_FILE,
  GUIDE_PDF_URL,
  normalizeWhatsAppNumber,
  WHATSAPP_DEFAULT_MESSAGE,
  WHATSAPP_EXAMPLE_NUMBER
} from "./marketing";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("buildWhatsAppLink", () => {
  it("monta o wa.me com a mensagem padrao codificada", () => {
    const link = buildWhatsAppLink(WHATSAPP_DEFAULT_MESSAGE, "5511988887777");
    expect(link.startsWith("https://wa.me/5511988887777?text=")).toBe(true);
    expect(link).toContain(encodeURIComponent(WHATSAPP_DEFAULT_MESSAGE));
  });

  it("aceita mensagem e numero proprios", () => {
    expect(buildWhatsAppLink("Oi & tudo bem?", "5511888887777")).toBe(
      `https://wa.me/5511888887777?text=${encodeURIComponent("Oi & tudo bem?")}`
    );
  });

  it("o numero de exemplo continua claramente falso", () => {
    expect(WHATSAPP_EXAMPLE_NUMBER).toBe("5500000000000");
  });
});

describe("normalizeWhatsAppNumber", () => {
  it("fica so com os digitos", () => {
    expect(normalizeWhatsAppNumber("+55 (11) 98888-7777")).toBe("5511988887777");
  });

  it("vazio ou curto demais nao e telefone", () => {
    expect(normalizeWhatsAppNumber(undefined)).toBeNull();
    expect(normalizeWhatsAppNumber("")).toBeNull();
    expect(normalizeWhatsAppNumber("12345")).toBeNull();
  });
});

describe("formatWhatsAppNumber", () => {
  it("celular e fixo brasileiros", () => {
    expect(formatWhatsAppNumber("5511988887777")).toBe("+55 (11) 98888-7777");
    expect(formatWhatsAppNumber("551133334444")).toBe("+55 (11) 3333-4444");
  });

  it("numero de fora sai so com o +", () => {
    expect(formatWhatsAppNumber("14155550100")).toBe("+14155550100");
  });
});

describe("links publicos", () => {
  it("o instalador vem da Edge Function publica", () => {
    expect(DESKTOP_DOWNLOAD_URL).toMatch(/\/functions\/v1\/desktop-download$/);
  });

  it("o guia sai da raiz do site e existe em public/", () => {
    expect(GUIDE_PDF_URL).toBe(`/${GUIDE_PDF_FILE}`);
    expect(existsSync(path.resolve(here, "../../public", GUIDE_PDF_FILE))).toBe(true);
  });
});
