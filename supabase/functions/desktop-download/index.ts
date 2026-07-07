import { corsHeaders } from "../_shared/cors.ts";

// Endpoint publico de download do instalador do KyberRock Desktop.
//
// Resolve o instalador (.exe) do Release mais recente no GitHub (repo privado) e
// redireciona o navegador para a URL assinada do asset. Assim existe um link
// FIXO que sempre baixa a versao mais nova, sem gerar nada manualmente.
//
// Requer o secret `GH_RELEASES_TOKEN` (PAT fine-grained, Contents: read neste
// repo). Deve ser deployada como funcao PUBLICA (verify_jwt = false).

const GITHUB_OWNER = Deno.env.get("GH_RELEASES_OWNER") ?? "BrunoPaulinoF";
const GITHUB_REPO = Deno.env.get("GH_RELEASES_REPO") ?? "KyberRock";

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return textResponse("Method not allowed", 405);
  }

  const token = Deno.env.get("GH_RELEASES_TOKEN");
  if (!token) {
    return textResponse("Servidor de download nao configurado (GH_RELEASES_TOKEN ausente).", 500);
  }

  const apiHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "kyberrock-desktop-download"
  };

  // 1) Descobrir o release mais recente publicado.
  // Lista os releases (mais novos primeiro) e escolhe o mais recente que
  // realmente tenha um instalador .exe. Assim, um release parcial/quebrado (ex.:
  // upload interrompido) nao derruba o link -- caimos no proximo valido.
  const releasesRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`,
    { headers: apiHeaders }
  );
  if (!releasesRes.ok) {
    return textResponse(`Falha ao consultar os releases (${releasesRes.status}).`, 502);
  }
  const releases = (await releasesRes.json()) as Array<{
    draft?: boolean;
    assets?: Array<{ id: number; name?: string }>;
  }>;
  let installer: { id: number; name?: string } | undefined;
  for (const release of Array.isArray(releases) ? releases : []) {
    if (release.draft) continue;
    const found = (release.assets ?? []).find(
      (asset) => typeof asset.name === "string" && asset.name.toLowerCase().endsWith(".exe")
    );
    if (found) {
      installer = found;
      break;
    }
  }
  if (!installer) {
    return textResponse("Nenhum instalador .exe encontrado nos releases.", 404);
  }

  // 2) Resolver a URL assinada do asset (octet-stream, sem seguir o redirect).
  const assetRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/assets/${installer.id}`,
    { headers: { ...apiHeaders, Accept: "application/octet-stream" }, redirect: "manual" }
  );

  const location = assetRes.headers.get("location");
  if (assetRes.status >= 300 && assetRes.status < 400 && location) {
    // HEAD nao deve levar corpo; ambos so precisam do 302 para a URL assinada.
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: location, "Cache-Control": "no-store" }
    });
  }

  // Fallback: alguns ambientes ja devolvem o binario direto.
  if (assetRes.ok && req.method === "GET") {
    return new Response(assetRes.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${installer.name}"`,
        "Cache-Control": "no-store"
      }
    });
  }

  return textResponse(`Falha ao baixar o instalador (${assetRes.status}).`, 502);
});
