/* eslint-env node */
import { createTransport } from "nodemailer";

const to = process.argv[2] || process.env.TEST_EMAIL_TO;
if (!to) {
  console.error("Uso: node scripts/test-email.mjs <email>");
  console.error("  ou defina TEST_EMAIL_TO no .env");
  process.exit(1);
}

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || "587");
const user = process.env.SMTP_USER;
const password = process.env.SMTP_PASSWORD;
const from = process.env.DAILY_REPORT_SENDER || user;

if (!host || !user || !password) {
  console.error("Credenciais SMTP nao configuradas.");
  console.error("Defina SMTP_HOST, SMTP_USER e SMTP_PASSWORD no .env.");
  console.error("");
  console.error("Exemplo (.env):");
  console.error("  SMTP_HOST=smtp.gmail.com");
  console.error("  SMTP_PORT=587");
  console.error("  SMTP_USER=seuemail@gmail.com");
  console.error("  SMTP_PASSWORD=sua_senha_de_app");
  console.error("  DAILY_REPORT_SENDER=seuemail@gmail.com");
  process.exit(1);
}

console.log(`Conectando ao SMTP ${host}:${port}...`);

const transport = createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass: password },
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 15000
});

try {
  console.log("Verificando conexao SMTP...");
  await transport.verify();
  console.log("SMTP OK!");

  const date = new Date().toISOString().slice(0, 10);

  const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body style="font-family:Arial,sans-serif;padding:24px;background:#f8fafc"><h1 style="color:#0f172a">KyberRock - Email configurado com sucesso!</h1><p style="color:#475569">Este e um email de teste para verificar a conexao SMTP.</p><p style="color:#475569">Se voce esta lendo isso, o envio de relatorios por email esta <strong>funcionando</strong>.</p><hr style="border:none;border-top:1px solid #cbd5e1;margin:24px 0" /><p style="color:#94a3b8;font-size:12px">Enviado em ${date} via KyberRock</p></body></html>`;

  console.log(`Enviando email de teste para ${to}...`);
  const info = await transport.sendMail({
    from,
    to,
    subject: `Teste de envio KyberRock - ${date}`,
    html
  });

  console.log(`Email enviado com sucesso!`);
  console.log(`  Message ID: ${info.messageId}`);
} catch (error) {
  console.error("Falha ao enviar email:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  transport.close();
}
