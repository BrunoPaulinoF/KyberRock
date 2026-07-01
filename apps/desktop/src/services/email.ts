import { createTransport, type Transporter } from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

export interface EmailSendInput {
  to: string;
  subject: string;
  html: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function readSmtpConfig(): SmtpConfig {
  const host = process.env["SMTP_HOST"] ?? "";
  const port = Number(process.env["SMTP_PORT"] ?? "587");
  const user = process.env["SMTP_USER"] ?? "";
  const password = process.env["SMTP_PASSWORD"] ?? "";
  const from = process.env["DAILY_REPORT_SENDER"] ?? user;
  return { host, port, user, password, from };
}

function validateConfig(config: SmtpConfig): string | null {
  if (!config.host) return "SMTP_HOST nao configurado";
  if (!config.user) return "SMTP_USER nao configurado";
  if (!config.password) return "SMTP_PASSWORD nao configurado";
  if (!config.from) return "DAILY_REPORT_SENDER nao configurado";
  return null;
}

let cachedTransport: Transporter | null = null;
let cachedConfigKey: string | null = null;

function configKey(config: SmtpConfig): string {
  return `${config.host}:${config.port}:${config.user}:${config.from}`;
}

function getTransport(config: SmtpConfig): Transporter {
  const key = configKey(config);
  if (cachedTransport && cachedConfigKey === key) {
    return cachedTransport;
  }
  cachedTransport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.password
    },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
  cachedConfigKey = key;
  return cachedTransport;
}

export async function sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
  const config = readSmtpConfig();
  const validationError = validateConfig(config);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const transport = getTransport(config);
    const info = await transport.sendMail({
      from: config.from,
      to: input.to,
      subject: input.subject,
      html: input.html
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Falha ao enviar email"
    };
  }
}

export async function verifySmtpConnection(): Promise<EmailSendResult> {
  const config = readSmtpConfig();
  const validationError = validateConfig(config);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const transport = getTransport(config);
    await transport.verify();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Falha na conexao SMTP"
    };
  }
}
