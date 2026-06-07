import type { KyberRockDesktopApi } from "../preload/preload";

declare global {
  interface Window {
    kyberrockDesktop?: KyberRockDesktopApi;
  }
}

export type { KyberRockDesktopApi };
