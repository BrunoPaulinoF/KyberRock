/**
 * Entrada do harness de capturas do loader-web: monta o app real com o Supabase
 * substituido pelo mock (alias no vite.screenshots.config.ts). Somente documentacao.
 */
import { createRoot } from "react-dom/client";

import { App } from "../src/App";
import "../src/loader-ui.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root was not found.");

createRoot(rootElement).render(<App />);
