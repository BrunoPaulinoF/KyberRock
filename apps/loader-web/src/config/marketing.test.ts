import { describe, expect, it } from "vitest";

import {
  buildWhatsAppLink,
  WHATSAPP_DEFAULT_MESSAGE,
  WHATSAPP_EXAMPLE_NUMBER
} from "./marketing";

describe("buildWhatsAppLink", () => {
  it("builds a wa.me link with the encoded default message", () => {
    const link = buildWhatsAppLink();
    expect(link.startsWith(`https://wa.me/${WHATSAPP_EXAMPLE_NUMBER}?text=`)).toBe(true);
    expect(link).toContain(encodeURIComponent(WHATSAPP_DEFAULT_MESSAGE));
  });

  it("accepts a custom message and number", () => {
    expect(buildWhatsAppLink("Oi & tudo bem?", "5511888887777")).toBe(
      `https://wa.me/5511888887777?text=${encodeURIComponent("Oi & tudo bem?")}`
    );
  });

  it("keeps the placeholder number clearly fake (no real-looking digits)", () => {
    expect(WHATSAPP_EXAMPLE_NUMBER).toBe("5500000000000");
  });
});
