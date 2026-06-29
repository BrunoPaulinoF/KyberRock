import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

const mockSendMail = vi.fn();
const mockVerify = vi.fn();
const mockClose = vi.fn();

vi.mock("nodemailer", () => ({
  createTransport: vi.fn(() => ({
    sendMail: mockSendMail,
    verify: mockVerify,
    close: mockClose
  }))
}));

import { sendEmail, verifySmtpConnection } from "./email";

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
  mockSendMail.mockResolvedValue({ messageId: "msg-123" });
  mockVerify.mockResolvedValue(true);
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("email service", () => {
  describe("sendEmail", () => {
    it("retorna erro quando SMTP_HOST nao esta configurado", async () => {
      delete (process.env as Record<string, string>)["SMTP_HOST"];
      process.env["SMTP_USER"] = "user";
      process.env["SMTP_PASSWORD"] = "pass";

      const result = await sendEmail({
        to: "test@example.com",
        subject: "Test",
        html: "<p>Test</p>"
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("SMTP_HOST");
    });

    it("retorna erro quando SMTP_USER nao esta configurado", async () => {
      process.env["SMTP_HOST"] = "smtp.example.com";
      process.env["SMTP_PASSWORD"] = "pass";
      delete (process.env as Record<string, string>)["SMTP_USER"];

      const result = await sendEmail({
        to: "test@example.com",
        subject: "Test",
        html: "<p>Test</p>"
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("SMTP_USER");
    });

    it("retorna erro quando SMTP_PASSWORD nao esta configurado", async () => {
      process.env["SMTP_HOST"] = "smtp.example.com";
      process.env["SMTP_USER"] = "user";
      delete (process.env as Record<string, string>)["SMTP_PASSWORD"];

      const result = await sendEmail({
        to: "test@example.com",
        subject: "Test",
        html: "<p>Test</p>"
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("SMTP_PASSWORD");
    });

    it("envia email com sucesso quando SMTP esta configurado", async () => {
      process.env["SMTP_HOST"] = "smtp.example.com";
      process.env["SMTP_USER"] = "user";
      process.env["SMTP_PASSWORD"] = "pass";
      process.env["DAILY_REPORT_SENDER"] = "sender@example.com";

      const result = await sendEmail({
        to: "recipient@example.com",
        subject: "Test Subject",
        html: "<p>Test HTML</p>"
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("msg-123");
      expect(mockSendMail).toHaveBeenCalledWith({
        from: "sender@example.com",
        to: "recipient@example.com",
        subject: "Test Subject",
        html: "<p>Test HTML</p>"
      });
    });

    it("retorna erro quando envio SMTP falha", async () => {
      process.env["SMTP_HOST"] = "smtp.example.com";
      process.env["SMTP_USER"] = "user";
      process.env["SMTP_PASSWORD"] = "pass";

      mockSendMail.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await sendEmail({
        to: "recipient@example.com",
        subject: "Test",
        html: "<p>Test</p>"
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Connection refused");
    });

    it("usa remetente padrao igual ao usuario quando DAILY_REPORT_SENDER nao configurado", async () => {
      process.env["SMTP_HOST"] = "smtp.example.com";
      process.env["SMTP_USER"] = "user@example.com";
      process.env["SMTP_PASSWORD"] = "pass";
      delete (process.env as Record<string, string>)["DAILY_REPORT_SENDER"];

      const result = await sendEmail({
        to: "recipient@example.com",
        subject: "Test",
        html: "<p>Test</p>"
      });

      expect(result.success).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: "user@example.com" })
      );
    });
  });

  describe("verifySmtpConnection", () => {
    it("retorna sucesso quando conexao SMTP funciona", async () => {
      process.env["SMTP_HOST"] = "smtp.example.com";
      process.env["SMTP_USER"] = "user";
      process.env["SMTP_PASSWORD"] = "pass";

      const result = await verifySmtpConnection();
      expect(result.success).toBe(true);
    });

    it("retorna erro quando SMTP nao configurado", async () => {
      delete (process.env as Record<string, string>)["SMTP_HOST"];

      const result = await verifySmtpConnection();
      expect(result.success).toBe(false);
    });

    it("retorna erro quando verify falha", async () => {
      process.env["SMTP_HOST"] = "smtp.example.com";
      process.env["SMTP_USER"] = "user";
      process.env["SMTP_PASSWORD"] = "pass";

      mockVerify.mockRejectedValueOnce(new Error("Auth failed"));

      const result = await verifySmtpConnection();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Auth failed");
    });
  });
});
