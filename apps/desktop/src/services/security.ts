export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class InputValidator {
  validatePlate(plate: string): boolean {
    const sanitized = plate.trim().toUpperCase();
    if (sanitized.length === 0) return false;

    // Mercosul: ABC1D23 (7 chars) ou antigo: ABC1234 (7 chars)
    const mercosulPattern = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;
    const oldPattern = /^[A-Z]{3}[0-9]{4}$/;

    return mercosulPattern.test(sanitized) || oldPattern.test(sanitized);
  }

  validateDocument(document: string): boolean {
    const digits = document.replace(/\D/g, "");
    return digits.length === 11 || digits.length === 14;
  }

  validateWeight(weight: number): boolean {
    return typeof weight === "number" && weight > 0 && !isNaN(weight) && isFinite(weight);
  }

  validateEmail(email: string): boolean {
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(email.trim());
  }

  sanitizeString(input: string): string {
    return input
      .trim()
      .replace(/<script[^>]*>.*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, "") // Remove HTML tags
      .replace(/['";`]/g, "") // Remove aspas e caracteres SQL perigosos
      .replace(/--/g, "") // Remove comentários SQL
      .trim();
  }

  hasSqlInjection(input: string): boolean {
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
      /(--|#|\/\*)/,
      /(\bOR\b\s*\d+\s*=\s*\d+)/i,
      /(\bAND\b\s*\d+\s*=\s*\d+)/i,
      /(\bWAITFOR\b|\bDELAY\b|\bSHUTDOWN\b)/i
    ];

    return sqlPatterns.some((pattern) => pattern.test(input));
  }
}

export interface OperationData {
  customerName: string;
  plate: string;
  driverName: string;
  productDescription: string;
  entryWeightKg: number;
}

export class SecurityService {
  private readonly validator = new InputValidator();

  validateOperationData(data: OperationData): ValidationResult {
    const errors: string[] = [];

    if (!data.customerName || data.customerName.trim().length < 2) {
      errors.push("Nome do cliente deve ter pelo menos 2 caracteres");
    }

    if (this.validator.hasSqlInjection(data.customerName)) {
      errors.push("Nome do cliente contem caracteres invalidos");
    }

    if (!this.validator.validatePlate(data.plate)) {
      errors.push("Placa invalida");
    }

    if (!data.driverName || data.driverName.trim().length < 2) {
      errors.push("Nome do motorista deve ter pelo menos 2 caracteres");
    }

    if (this.validator.hasSqlInjection(data.driverName)) {
      errors.push("Nome do motorista contem caracteres invalidos");
    }

    if (!data.productDescription || data.productDescription.trim().length < 2) {
      errors.push("Descricao do produto deve ter pelo menos 2 caracteres");
    }

    if (!this.validator.validateWeight(data.entryWeightKg)) {
      errors.push("Peso de entrada deve ser maior que zero");
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  maskSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const masked = { ...data };

    if (typeof masked.document === "string" && masked.document.length > 5) {
      const doc = masked.document as string;
      masked.document = "***" + doc.slice(-5);
    }

    if (typeof masked.email === "string" && masked.email.includes("@")) {
      const email = masked.email as string;
      const [user, domain] = email.split("@");
      masked.email = user.slice(0, 3) + "***@" + domain;
    }

    return masked;
  }
}
