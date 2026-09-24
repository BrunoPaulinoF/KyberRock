/* global self */
/*
 * Service worker minimo, exigido por alguns navegadores para o site ser instalavel como app
 * (o "Instalar app" do carregador). Nao intercepta fetch de proposito: a fila de cargas e um
 * espelho em tempo real — cache offline aqui poderia mostrar uma fila velha, o que e pior do
 * que uma tela de erro de rede.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
