import { describe, expect, it } from "vitest";

import { PaymentTermValidator } from "./payment-term-validator";

function localDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

describe("PaymentTermValidator", () => {
  describe("validateClosingDate", () => {
    it("allows closing on any day for cash payment", () => {
      const validator = new PaymentTermValidator();

      expect(
        validator.validateClosingDate("a_vista", localDate("2026-06-07"))
      ).toEqual({ allowed: true });
    });

    it("allows closing on day 1-15 for monthly payment (vence dia 30)", () => {
      const validator = new PaymentTermValidator();

      expect(
        validator.validateClosingDate("mensal_30", localDate("2026-06-10"))
      ).toEqual({ allowed: true });
    });

    it("blocks closing after day 15 for monthly payment (vence dia 30)", () => {
      const validator = new PaymentTermValidator();

      expect(
        validator.validateClosingDate("mensal_30", localDate("2026-06-16"))
      ).toEqual({
        allowed: false,
        message: "Fechamento bloqueado: periodo 1-15 vence dia 30. Aguarde proximo periodo (16-fim)."
      });
    });

    it("allows closing on day 16-fim for monthly payment (vence dia 15)", () => {
      const validator = new PaymentTermValidator();

      expect(
        validator.validateClosingDate("mensal_15", localDate("2026-06-20"))
      ).toEqual({ allowed: true });
    });

    it("blocks closing before day 16 for monthly payment (vence dia 15)", () => {
      const validator = new PaymentTermValidator();

      expect(
        validator.validateClosingDate("mensal_15", localDate("2026-06-10"))
      ).toEqual({
        allowed: false,
        message: "Fechamento bloqueado: periodo 16-fim vence dia 15. Aguarde proximo periodo (1-15)."
      });
    });
  });

  describe("calculateDueDate", () => {
    it("calculates due date for period 1-15 (vence dia 30)", () => {
      const validator = new PaymentTermValidator();

      const dueDate = validator.calculateDueDate("mensal_30", localDate("2026-06-10"));

      expect(dueDate).toBe("2026-06-30");
    });

    it("calculates due date for period 16-fim (vence dia 15 do mes seguinte)", () => {
      const validator = new PaymentTermValidator();

      const dueDate = validator.calculateDueDate("mensal_15", localDate("2026-06-20"));

      expect(dueDate).toBe("2026-07-15");
    });

    it("returns today for cash payment", () => {
      const validator = new PaymentTermValidator();
      const today = localDate("2026-06-07");

      const dueDate = validator.calculateDueDate("a_vista", today);

      expect(dueDate).toBe("2026-06-07");
    });
  });
});
