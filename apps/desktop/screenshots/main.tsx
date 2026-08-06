/**
 * Entrada do harness de capturas de tela: monta o renderer real do desktop com a API
 * ficticia no lugar do preload do Electron. Serve so para gerar imagens de documentacao.
 */
import { createRoot } from "react-dom/client";

import { App } from "../src/renderer/App";
import { createMockDesktopApi } from "./mock-api";

const mockApi = createMockDesktopApi();
(window as unknown as Record<string, unknown>).kyberrockDesktop = mockApi;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element was not found.");

// Sem StrictMode: a montagem dupla dispara os efeitos de carga duas vezes e deixa
// as telas piscando durante a captura.
createRoot(rootElement).render(<App desktopApi={mockApi as never} />);
