const refs = {
  endpoint: document.querySelector("#tcpEndpoint"),
  weight: document.querySelector("#weightKg"),
  stable: document.querySelector("#stableBadge"),
  zero: document.querySelector("#zeroBadge"),
  mode: document.querySelector("#modeBadge"),
  tare: document.querySelector("#tareBadge"),
  overload: document.querySelector("#overloadBadge"),
  sample: document.querySelector("#sampleBadge"),
  tareKg: document.querySelector("#tareKg"),
  netKg: document.querySelector("#netKg"),
  capacity: document.querySelector("#capacityKg"),
  phase: document.querySelector("#phaseBadge"),
  frame: document.querySelector("#framePreview"),
  events: document.querySelector("#events")
};

let socket = null;
let reconnectTimer = null;
let lastSnapshot = null;

connectWebSocket();
refreshState();

for (const button of document.querySelectorAll("[data-action]")) {
  button.addEventListener("click", () => runAction(button.dataset.action));
}

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}`);

  socket.addEventListener("open", () => {
    setEndpoint("conectado");
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") render(message.payload);
  });

  socket.addEventListener("close", () => {
    setEndpoint("reconectando...");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, 1200);
  });
}

async function refreshState() {
  try {
    const response = await fetch("/api/state");
    render(await response.json());
  } catch {
    setEndpoint("API indisponivel");
  }
}

async function runAction(type, data = {}) {
  try {
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    render(await response.json());
  } catch (err) {
    addEvent("error", `Acao ${type} falhou: ${err.message}`);
  }
}

function render(snapshot) {
  if (!snapshot) return;
  lastSnapshot = snapshot;

  setEndpoint(`${location.hostname || "localhost"}:4001`);
  refs.weight.textContent = Math.round(Math.abs(snapshot.weightKg)).toString().padStart(9, "0");
  refs.tareKg.textContent = `${Math.round(snapshot.tareKg).toLocaleString("pt-BR")} kg`;
  refs.netKg.textContent = `${Math.round(snapshot.netKg).toLocaleString("pt-BR")} kg`;
  refs.capacity.textContent = `${snapshot.capacityKg.toLocaleString("pt-BR")} kg`;

  refs.phase.textContent = phaseLabel(snapshot.phase);
  refs.phase.style.color = snapshot.phase === "IDLE" ? "var(--good)" : "var(--accent)";

  setBadge(
    refs.stable,
    snapshot.motion ? "EM MOVIMENTO" : "ESTAVEL",
    snapshot.motion ? "warn" : "good"
  );
  setBadge(
    refs.zero,
    snapshot.atZero ? "CENTRO ZERO" : "FORA DO ZERO",
    snapshot.atZero ? "good" : "warn"
  );
  setBadge(
    refs.mode,
    snapshot.netMode ? "MODO LIQUIDO" : "MODO BRUTO",
    snapshot.netMode ? "warn" : "good"
  );
  setBadge(
    refs.tare,
    snapshot.tareActive ? "TARA ATIVA" : "SEM TARA",
    snapshot.tareActive ? "warn" : "good"
  );
  setBadge(
    refs.overload,
    snapshot.overload ? "SOBRECARGA" : "CARGA OK",
    snapshot.overload ? "bad" : "good"
  );

  if (
    snapshot.pendingMean !== null &&
    (snapshot.phase === "TARE_DONE" || snapshot.phase === "WEIGHING_LOADED")
  ) {
    const which = snapshot.phase === "TARE_DONE" ? "tara" : "bruto";
    refs.sample.textContent = `Media ${which}: ${snapshot.pendingMean} kg`;
    refs.sample.style.display = "inline-block";
    refs.sample.className = "badge good";
    addEvent("info", `Amostragem de ${which} concluida: media ${snapshot.pendingMean} kg.`);
    setTimeout(() => {
      if (lastSnapshot && lastSnapshot.phase === snapshot.phase) {
        refs.sample.style.display = "none";
      }
    }, 4000);
  }

  refs.frame.textContent = printableFrame(buildFramePreview(snapshot));
}

function buildFramePreview(snapshot) {
  const status = [
    snapshot.overload ? "O" : " ",
    snapshot.negative ? "M" : " ",
    snapshot.atZero ? "C" : " ",
    snapshot.motion ? "I" : " ",
    snapshot.tareActive ? "T" : " ",
    snapshot.grossMode ? "G" : " ",
    snapshot.netMode ? "N" : " ",
    " "
  ].join("");
  const weight = Math.round(Math.abs(snapshot.weightKg)).toString().padStart(9, "0");
  return `${status} ${weight}kg`;
}

function printableFrame(text) {
  return text.replace(/\r/g, "<CR>").replace(/\n/g, "<LF>");
}

function setBadge(element, text, tone) {
  element.textContent = text;
  element.className = `badge ${tone}`;
}

function setEndpoint(text) {
  refs.endpoint.textContent = `TCP ${text}`;
}

function phaseLabel(phase) {
  return (
    {
      IDLE: "IDLE",
      TARING: "AGUARDANDO TARA",
      TARE_DONE: "TARA PRONTA",
      LOADING: "CARREGANDO",
      WEIGHING_LOADED: "CARREGADO",
      RELEASED: "LIBERADO"
    }[phase] ?? phase
  );
}

function addEvent(level, text) {
  const li = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString("pt-BR");
  li.appendChild(time);
  li.appendChild(document.createTextNode(text));
  if (level === "error") li.style.borderLeftColor = "var(--bad)";
  if (level === "warn") li.style.borderLeftColor = "var(--warn)";
  refs.events.prepend(li);
  while (refs.events.children.length > 30) {
    refs.events.removeChild(refs.events.lastChild);
  }
}
