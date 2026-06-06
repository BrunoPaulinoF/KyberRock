export const loaderWebAppInfo = {
  name: "KyberRock Loader Web",
  runtime: "vite-spa",
  deploymentTarget: "docker-easypanel"
} as const;

export function getLoaderWebCapabilities(): string[] {
  return ["firebase-auth", "firestore-read-only", "open-loading-requests"];
}
