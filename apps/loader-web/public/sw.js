/* global self */
/*
 * Service worker minimo, exigido por alguns navegadores para o site ser
 * instalavel como app (PWA). Nao intercepta fetch de proposito: o loader-web e
 * um espelho em tempo real da fila de cargas — cache offline aqui poderia
 * mostrar uma fila velha para o carregador, o que e pior do que uma tela de
 * erro de rede.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
