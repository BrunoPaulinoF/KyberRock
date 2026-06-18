let state = null;
let socket = null;
let reconnectTimer = null;

const refs = {
  wsDot: document.querySelector("#wsDot"),
  wsStatus: document.querySelector("#wsStatus"),
  tcpEndpoint: document.querySelector("#tcpEndpoint"),
  scaleStatus: document.querySelector("#scaleStatus"),
  weightKg: document.querySelector("#weightKg"),
  stableBadge: document.querySelector("#stableBadge"),
  motionBadge: document.querySelector("#motionBadge"),
  zeroBadge: document.querySelector("#zeroBadge"),
  overloadBadge: document.querySelector("#overloadBadge"),
  modeBadge: document.querySelector("#modeBadge"),
  lightBadge: document.querySelector("#lightBadge"),
  grossKg: document.querySelector("#grossKg"),
  tareKg: document.querySelector("#tareKg"),
  netKg: document.querySelector("#netKg"),
  plate: document.querySelector("#plate"),
  driver: document.querySelector("#driver"),
  company: document.querySelector("#company"),
  material: document.querySelector("#material"),
  destination: document.querySelector("#destination"),
  axleCount: document.querySelector("#axleCount"),
  plannedGross: document.querySelector("#plannedGross"),
  autoMode: document.querySelector("#autoMode"),
  toggleAuto: document.querySelector("#toggleAuto"),
  clientCount: document.querySelector("#clientCount"),
  lastFrame: document.querySelector("#lastFrame"),
  updatedAt: document.querySelector("#updatedAt"),
  events: document.querySelector("#events"),
  manualForm: document.querySelector("#manualForm")
};

connectWebSocket();
fetchState();

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => runAction(button.dataset.action));
});

refs.toggleAuto.addEventListener("click", () => {
  runAction(state?.autoMode ? "stopAuto" : "startAuto");
});

refs.manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(refs.manualForm);
  const data = {};
  for (const [key, value] of formData.entries()) {
    const text = String(value).trim();
    if (!text) continue;
    if (["weight", "target", "tare"].includes(key)) {
      data[key] = Number(text);
    } else if (["stable", "motion", "overload"].includes(key) && text !== "auto") {
      data[key] = text === "true";
    } else {
      data[key] = text;
    }
  }
  runAction("manualSet", data);
});

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}`);
  setUiOnline(false, "Conectando UI...");

  socket.addEventListener("open", () => {
    setUiOnline(true, "UI conectada");
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") render(message.payload);
  });

  socket.addEventListener("close", () => {
    setUiOnline(false, "Reconectando UI...");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, 1200);
  });
}

async function fetchState() {
  try {
    const response = await fetch("/api/state");
    render(await response.json());
  } catch {
    setUiOnline(false, "API indisponivel");
  }
}

async function runAction(type, data = {}) {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, data })
  });
  render(await response.json());
}

function render(nextState) {
  state = nextState;
  const truck = state.currentTruck;
  const endpointHost = location.hostname || "localhost";

  refs.tcpEndpoint.textContent = `TCP ${endpointHost}:${state.tcpPort}`;
  refs.scaleStatus.textContent = statusLabel(state.status);
  refs.weightKg.textContent = displayWeight(state.weightKg);
  refs.grossKg.textContent = kg(state.grossKg);
  refs.tareKg.textContent = kg(state.tareKg);
  refs.netKg.textContent = kg(state.netKg);
  refs.plate.textContent = truck?.plate ?? "SEM PLACA";
  refs.driver.textContent = truck?.driver ?? "-";
  refs.company.textContent = truck?.company ?? "-";
  refs.material.textContent = truck?.material ?? "-";
  refs.destination.textContent = truck?.destination ?? "-";
  refs.axleCount.textContent = truck ? `${truck.axleCount} eixos` : "-";
  refs.plannedGross.textContent = truck ? kg(truck.plannedGrossKg) : "-";
  refs.autoMode.textContent = state.autoMode ? "Automatico" : "Manual";
  refs.toggleAuto.textContent = state.autoMode ? "Pausar automatico" : "Ativar automatico";
  refs.clientCount.textContent = `${state.connectedClients} cliente${state.connectedClients === 1 ? "" : "s"}`;
  refs.lastFrame.textContent = printableFrame(state.lastFrame);
  refs.updatedAt.textContent = new Date(state.updatedAt).toLocaleTimeString("pt-BR");

  setBadge(refs.stableBadge, state.stable ? "ESTAVEL" : "INSTAVEL", state.stable ? "good" : "warn");
  setBadge(
    refs.motionBadge,
    state.motion ? "MOVIMENTO" : "SEM MOVIMENTO",
    state.motion ? "warn" : "good"
  );
  setBadge(
    refs.zeroBadge,
    state.zeroed ? "CENTRO ZERO" : "FORA DO ZERO",
    state.zeroed ? "good" : "warn"
  );
  setBadge(
    refs.overloadBadge,
    state.overload ? "SOBRECARGA" : "CARGA OK",
    state.overload ? "bad" : "good"
  );
  setBadge(refs.modeBadge, state.netMode ? "LIQUIDO" : "BRUTO", state.netMode ? "warn" : "good");
  setBadge(
    refs.lightBadge,
    state.trafficLight === "GREEN" ? "SINAL VERDE" : "SINAL VERMELHO",
    state.trafficLight === "GREEN" ? "good" : "bad"
  );

  refs.events.innerHTML = state.events
    .map(
      (event) =>
        `<li class="${escapeHtml(event.level)}"><time>${new Date(event.at).toLocaleTimeString("pt-BR")}</time>${escapeHtml(event.text)}</li>`
    )
    .join("");
}

function setUiOnline(online, text) {
  refs.wsDot.classList.toggle("online", online);
  refs.wsStatus.textContent = text;
}

function setBadge(element, text, tone) {
  element.textContent = text;
  element.className = `badge ${tone}`;
}

function kg(value) {
  return `${Math.round(value).toLocaleString("pt-BR")} kg`;
}

function displayWeight(value) {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toString().padStart(6, "0")}`;
}

function printableFrame(frame) {
  return frame.replace(/\x02/g, "<STX>").replace(/\x03/g, "<ETX>").replace(/\r\n/g, "<CRLF>");
}

function statusLabel(status) {
  return (
    {
      IDLE: "Livre",
      APPROACHING: "Entrada",
      WEIGHING_EMPTY: "Pesando vazio",
      LOADING: "Carregando",
      WEIGHING_LOADED: "Pesando carregado",
      LEAVING: "Saida",
      ERROR: "Erro"
    }[status] ?? status
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
