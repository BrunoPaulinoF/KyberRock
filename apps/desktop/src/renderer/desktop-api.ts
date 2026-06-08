import type { KyberRockDesktopApi } from "../preload/api-types";

declare global {
  interface Window {
    kyberrockDesktop?: KyberRockDesktopApi;
  }
}

export type { KyberRockDesktopApi };
