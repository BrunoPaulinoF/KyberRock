// Pagina publica do link temporario de conexao do WhatsApp.
//
// Quem abre isto e o dono do celular, no proprio celular, com o operador da
// balanca do outro lado da linha esperando. Duas decisoes vem dai:
//
//   - a pagina e um arquivo so, sem CSS, fonte ou script de fora: rede de
//     pedreira e 4G ruim, e QR que demora e QR que expira antes de aparecer;
//   - ela nunca recebe a URL nem o token da instancia UAZAPI. Tudo passa pelo
//     endpoint `/state` da propria funcao, que fala com a UAZAPI do lado do
//     servidor. O que chega ao navegador e a imagem do QR e o tempo restante.

import { WHATSAPP_LINK_TTL_MINUTES } from "../_shared/whatsapp-link.ts";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const SHELL_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: #0f172a;
    color: #e2e8f0;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main {
    width: min(420px, 100%);
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 16px;
    padding: 24px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  }
  .brand {
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #94a3b8;
    margin: 0 0 6px 0;
  }
  h1 { font-size: 19px; margin: 0 0 6px 0; color: #f8fafc; }
  p { font-size: 14px; line-height: 1.5; color: #cbd5f5; margin: 0 0 12px 0; }
  .muted { color: #94a3b8; font-size: 13px; }
  .icon { font-size: 44px; line-height: 1; margin-bottom: 10px; }
`;

function shell(title: string, body: string, extraStyle = "", script = ""): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)}</title>
<style>${SHELL_STYLE}${extraStyle}</style>
</head>
<body>
<main>${body}</main>
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

/** Link que nao existe, ja foi cancelado, expirou ou ja foi usado. */
export function renderWhatsappLinkClosedPage(input: {
  title: string;
  icon: string;
  message: string;
}): string {
  return shell(
    input.title,
    `<p class="brand">KyberRock</p>
     <div class="icon">${escapeHtml(input.icon)}</div>
     <h1>${escapeHtml(input.title)}</h1>
     <p>${escapeHtml(input.message)}</p>
     <p class="muted">Peca um link novo na tela de Relatorios do computador da balanca.</p>`
  );
}

const LIVE_STYLE = `
  .qr-frame {
    margin: 14px auto 10px auto;
    width: 260px;
    max-width: 100%;
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ffffff;
    border-radius: 12px;
    padding: 10px;
  }
  .qr-frame img { width: 100%; height: 100%; image-rendering: pixelated; }
  .qr-frame .placeholder { color: #475569; font-size: 13px; padding: 0 16px; }
  ol {
    text-align: left;
    margin: 0 0 12px 0;
    padding-left: 20px;
    font-size: 14px;
    line-height: 1.6;
    color: #cbd5f5;
  }
  .countdown {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 700;
    background: #334155;
    color: #e2e8f0;
  }
  .countdown.ending { background: #7f1d1d; color: #fee2e2; }
  .paircode {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: 0.16em;
    color: #f8fafc;
  }
  .alert { color: #fca5a5; font-size: 13px; }
  .hidden { display: none; }
`;

// O relogio da contagem e do proprio navegador (a cada segundo, a partir do
// vencimento que veio do servidor): consultar o servidor de segundo em segundo
// so para mover um numero gastaria bateria e rede sem mudar nada. Quem decide
// de verdade continua sendo o servidor -- o /state confere o prazo em toda
// resposta, entao um relogio adiantado no celular nao estende o link.
const LIVE_SCRIPT = `
(function () {
  var stateUrl = document.body.dataset.stateUrl;
  var expiresAt = Date.parse(document.body.dataset.expiresAt);
  var qrBox = document.getElementById("qr");
  var countdown = document.getElementById("countdown");
  var alertBox = document.getElementById("alert");
  var pairBox = document.getElementById("pair");
  var pollTimer = null;
  var tickTimer = null;

  function pad(value) { return String(value).padStart(2, "0"); }

  function stop() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function closed(icon, title, message) {
    stop();
    document.querySelector("main").innerHTML =
      '<p class="brand">KyberRock</p><div class="icon">' + icon + '</div><h1>' +
      title + '</h1><p>' + message + '</p>';
  }

  function tick() {
    var remaining = Math.max(0, expiresAt - Date.now());
    var seconds = Math.ceil(remaining / 1000);
    countdown.textContent = "Expira em " + pad(Math.floor(seconds / 60)) + ":" + pad(seconds % 60);
    countdown.classList.toggle("ending", remaining <= 60000);
    if (remaining <= 0) {
      closed("&#9203;", "Link expirado",
        "Este link valia ${WHATSAPP_LINK_TTL_MINUTES} minutos. Peca um link novo na tela de Relatorios.");
    }
  }

  function showQr(dataUrl) {
    var current = qrBox.querySelector("img");
    if (current) {
      if (current.src !== dataUrl) current.src = dataUrl;
      return;
    }
    qrBox.innerHTML = "";
    var image = document.createElement("img");
    image.alt = "QR code para conectar o WhatsApp";
    image.src = dataUrl;
    qrBox.appendChild(image);
  }

  function poll() {
    fetch(stateUrl, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" } })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (data.state === "connected") {
          closed("&#9989;", "WhatsApp conectado!",
            data.profileName
              ? "Conectado como " + data.profileName + ". Pode fechar esta pagina."
              : "Pareamento concluido. Pode fechar esta pagina.");
          return;
        }
        if (data.state === "expired") {
          closed("&#9203;", "Link expirado",
            "Peca um link novo na tela de Relatorios do computador da balanca.");
          return;
        }
        if (data.state === "revoked") {
          closed("&#128683;", "Link cancelado",
            "Quem gerou este link cancelou o acesso. Peca um link novo.");
          return;
        }
        if (typeof data.expiresAt === "string") {
          var parsed = Date.parse(data.expiresAt);
          if (!isNaN(parsed)) expiresAt = parsed;
        }
        if (data.qrcode) {
          showQr(data.qrcode);
          alertBox.classList.add("hidden");
        }
        if (data.paircode) {
          pairBox.classList.remove("hidden");
          pairBox.querySelector(".paircode").textContent = data.paircode;
        }
        if (data.error) {
          alertBox.textContent = data.error;
          alertBox.classList.remove("hidden");
        }
      })
      .catch(function () {
        alertBox.textContent = "Sem conexao com o servidor. Tentando de novo...";
        alertBox.classList.remove("hidden");
      });
  }

  tick();
  poll();
  tickTimer = setInterval(tick, 1000);
  pollTimer = setInterval(poll, 3000);
})();
`;

/** Pagina viva: QR que se renova sozinho, contagem regressiva e passo a passo. */
export function renderWhatsappLinkPage(input: {
  stateUrl: string;
  expiresAt: string;
  companyName: string | null;
}): string {
  const heading = input.companyName
    ? `Conectar o WhatsApp de ${escapeHtml(input.companyName)}`
    : "Conectar o WhatsApp";
  const body = `
    <p class="brand">KyberRock</p>
    <h1>${heading}</h1>
    <p>Escaneie o QR code abaixo com o celular que vai enviar os relatorios.</p>
    <div class="qr-frame" id="qr"><span class="placeholder">Gerando o QR code...</span></div>
    <span class="countdown" id="countdown">Expira em ${WHATSAPP_LINK_TTL_MINUTES}:00</span>
    <p class="alert hidden" id="alert"></p>
    <p class="hidden" id="pair">Codigo de pareamento: <span class="paircode"></span></p>
    <ol>
      <li>Abra o WhatsApp no celular do numero da pedreira.</li>
      <li>Toque em <strong>Configuracoes &gt; Aparelhos conectados</strong>.</li>
      <li>Toque em <strong>Conectar aparelho</strong> e aponte a camera para o QR acima.</li>
    </ol>
    <p class="muted">O QR se renova sozinho enquanto esta pagina estiver aberta. Nao compartilhe
    este link: quem o abrir dentro do prazo pode conectar um aparelho ao WhatsApp da pedreira.</p>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Conectar o WhatsApp - KyberRock</title>
<style>${SHELL_STYLE}${LIVE_STYLE}</style>
</head>
<body data-state-url="${escapeHtml(input.stateUrl)}" data-expires-at="${escapeHtml(input.expiresAt)}">
<main>${body}</main>
<script>${LIVE_SCRIPT}</script>
</body>
</html>`;
}
