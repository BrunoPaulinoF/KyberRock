export interface ValidationResult {
  allowed: boolean;
  message?: string;
}

export class PaymentTermValidator {
  validateClosingDate(
    paymentTermCode: string,
    closingDate: Date
  ): ValidationResult {
    const day = closingDate.getDate();

    if (paymentTermCode === "a_vista") {
      return { allowed: true };
    }

    if (paymentTermCode === "mensal_30") {
      // Regra: 1 a 15 vence dia 30
      if (day >= 1 && day <= 15) {
        return { allowed: true };
      }

      return {
        allowed: false,
        message:
          "Fechamento bloqueado: periodo 1-15 vence dia 30. Aguarde proximo periodo (16-fim)."
      };
    }

    if (paymentTermCode === "mensal_15") {
      // Regra: 16 ao fim do mês vence dia 15 do mês seguinte
      if (day >= 16) {
        return { allowed: true };
      }

      return {
        allowed: false,
        message:
          "Fechamento bloqueado: periodo 16-fim vence dia 15. Aguarde proximo periodo (1-15)."
      };
    }

    return { allowed: true };
  }

  calculateDueDate(paymentTermCode: string, closingDate: Date): string {
    const year = closingDate.getFullYear();
    const month = closingDate.getMonth(); // 0-based

    if (paymentTermCode === "a_vista") {
      return this.formatDate(closingDate);
    }

    if (paymentTermCode === "mensal_30") {
      // Periodo 1-15 vence dia 30 do mesmo mês
      return this.formatDate(new Date(year, month, 30));
    }

    if (paymentTermCode === "mensal_15") {
      // Periodo 16-fim vence dia 15 do mês seguinte
      return this.formatDate(new Date(year, month + 1, 15));
    }

    return this.formatDate(closingDate);
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
}
