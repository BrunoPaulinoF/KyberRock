export const desktopAppInfo = {
  name: "KyberRock Desktop",
  runtime: "electron",
  offlineFirst: true
} as const;

export function getDesktopFoundationCapabilities(): string[] {
  return ["sqlite-local-data", "scale-adapters", "windows-printing", "sync-queue"];
}
