import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { installErrorLog } from "./lib/error-log";
import { registerServiceWorker } from "./lib/pwa-install";
import "./styles.css";

registerServiceWorker();
// Diario de erros do navegador: a tela Logs do administrador mostra e copia para o suporte.
installErrorLog();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
