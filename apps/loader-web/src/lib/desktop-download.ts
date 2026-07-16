import { supabaseConfig } from "../config/supabase-config";

// Link FIXO para baixar o instalador (.exe) do KyberRock Desktop na versao mais
// recente. A Edge Function publica `desktop-download` resolve o Release mais
// novo no GitHub e redireciona para a URL assinada do asset.
export function resolveDesktopDownloadUrl(baseUrl: string = supabaseConfig.url): string {
  return `${baseUrl.replace(/\/+$/, "")}/functions/v1/desktop-download`;
}

export const desktopDownloadUrl = resolveDesktopDownloadUrl();
