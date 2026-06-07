import { describe, expect, it } from "vitest";

import { InputValidator, SecurityService } from "./security";

describe("InputValidator", () => {
  it("validates plate format (Mercosul)", () => {
    const validator = new InputValidator();

    expect(validator.validatePlate("ABC1D23")).toBe(true);
    expect(validator.validatePlate("abc1d23")).toBe(true);
    expect(validator.validatePlate("ABC1234")).toBe(true); // Antigo
    expect(validator.validatePlate("ABC1D234")).toBe(false); // Muito longo
    expect(validator.validatePlate("ABCD123")).toBe(false); // Formato inválido
    expect(validator.validatePlate("")).toBe(false);
  });

  it("validates CNPJ/CPF", () => {
    const validator = new InputValidator();

    expect(validator.validateDocument("12345678000195")).toBe(true); // CNPJ
    expect(validator.validateDocument("12345678901")).toBe(true); // CPF
    expect(validator.validateDocument("123")).toBe(false);
    expect(validator.validateDocument("")).toBe(false);
  });

  it("validates weight is positive number", () => {
    const validator = new InputValidator();

    expect(validator.validateWeight(1000)).toBe(true);
    expect(validator.validateWeight(0)).toBe(false);
    expect(validator.validateWeight(-100)).toBe(false);
    expect(validator.validateWeight(NaN)).toBe(false);
  });

  it("validates email format", () => {
    const validator = new InputValidator();

    expect(validator.validateEmail("teste@email.com")).toBe(true);
    expect(validator.validateEmail("invalido")).toBe(false);
    expect(validator.validateEmail("")).toBe(false);
  });

  it("sanitizes string input", () => {
    const validator = new InputValidator();

    expect(validator.sanitizeString("  Teste  ")).toBe("Teste");
    expect(validator.sanitizeString("Teste<script>alert('xss')</script>")).toBe(
      "Teste"
    );
    expect(validator.sanitizeString("Teste\"drop")).toBe("Testedrop");
  });
});

describe("SecurityService", () => {
  it("validates operation data before saving", () => {
    const service = new SecurityService();

    const validData = {
      customerName: "Cliente Teste",
      plate: "ABC1D23",
      driverName: "Motorista Teste",
      productDescription: "Brita 0",
      entryWeightKg: 10000
    };

    const result = service.validateOperationData(validData);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects invalid operation data", () => {
    const service = new SecurityService();

    const invalidData = {
      customerName: "",
      plate: "invalid",
      driverName: "Motorista",
      productDescription: "Produto",
      entryWeightKg: -100
    };

    const result = service.validateOperationData(invalidData);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("detects SQL injection attempts", () => {
    const service = new SecurityService();

    const maliciousData = {
      customerName: "Robert'); DROP TABLE customers; --",
      plate: "ABC1D23",
      driverName: "Motorista",
      productDescription: "Produto",
      entryWeightKg: 10000
    };

    const result = service.validateOperationData(maliciousData);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("caracteres invalidos"))).toBe(
      true
    );
  });

  it("masks sensitive data in logs", () => {
    const service = new SecurityService();

    const sensitive = {
      name: "Cliente",
      document: "12345678000195",
      email: "cliente@email.com",
      creditLimit: 1000000
    };

    const masked = service.maskSensitiveData(sensitive);

    expect(masked.document).toBe("***00195");
    expect(masked.email).toBe("cli***@email.com");
    expect(masked.name).toBe("Cliente"); // Nome não é mascarado
  });
});
