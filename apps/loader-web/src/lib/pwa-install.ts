import { useEffect, useState } from "react";

/**
 * Evento `beforeinstallprompt` do Chrome/Edge/Android. Nao faz parte do lib.dom
 * do TypeScript porque nunca foi padronizado, mas e a unica forma de disparar o
 * prompt nativo de instalacao do PWA.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** Roda como app instalado (janela standalone), quando o botao deixa de fazer sentido. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // Safari iOS expoe navigator.standalone fora de qualquer spec.
  return Boolean((window.navigator as { standalone?: boolean }).standalone);
}

/** iOS nao dispara beforeinstallprompt: a instalacao e manual pelo menu Compartilhar. */
export function isIosDevice(userAgent?: string, maxTouchPoints?: number): boolean {
  const hasNavigator = typeof navigator !== "undefined";
  const ua = userAgent ?? (hasNavigator ? navigator.userAgent : "");
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  // iPadOS 13+ se apresenta como Mac, mas com tela de toque.
  const touchPoints = maxTouchPoints ?? (hasNavigator ? (navigator.maxTouchPoints ?? 0) : 0);
  return /macintosh/i.test(ua) && touchPoints > 1;
}

export type InstallAppResult = "prompted" | "instructions";

/**
 * Estado do botao "Instalar app": guarda o prompt nativo quando o navegador o
 * oferece e diz se o app ja esta rodando instalado (botao escondido).
 *
 * `install()` dispara o prompt nativo quando disponivel; caso contrario devolve
 * "instructions" para a tela mostrar o passo a passo manual (iOS/menu do navegador).
 */
export function useInstallPrompt(): {
  canPromptNatively: boolean;
  isInstalled: boolean;
  install: () => Promise<InstallAppResult>;
} {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => isStandaloneDisplay());

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      // Sem o preventDefault o Chrome mostra o mini-infobar proprio e descarta
      // o evento — o botao da tela ficaria sem prompt para disparar.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setDeferredPrompt(null);
      setIsInstalled(true);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function install(): Promise<InstallAppResult> {
    if (!deferredPrompt) return "instructions";
    const prompt = deferredPrompt;
    // O evento so pode ser usado uma vez; se o usuario dispensar, o navegador
    // dispara outro beforeinstallprompt quando julgar apropriado.
    setDeferredPrompt(null);
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") {
      setIsInstalled(true);
    }
    return "prompted";
  }

  return { canPromptNatively: deferredPrompt !== null, isInstalled, install };
}

/** Registra o service worker exigido para o site ser instalavel como app. */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // Em dev (vite) nao ha /sw.js buildado; o registro falharia com 404 no console.
  if (!import.meta.env.PROD) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Best-effort: sem service worker o site continua funcionando no navegador.
    });
  });
}
