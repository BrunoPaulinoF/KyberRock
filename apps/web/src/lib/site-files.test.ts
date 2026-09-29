import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { publicAsset } from "./public-asset";
import { edgeFunctionUrl } from "./supabase-env";

/**
 * O que faz o site substituir o loader-web (EasyPanel) de ponta a ponta: as rotas publicas, o
 * link fixo do instalador e os caminhos que precisam funcionar em qualquer profundidade de
 * endereco — `/whatsapp/<token>` e `/admin/login` sao abertos direto, por link ou F5.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../..");
const read = (file: string) => readFileSync(path.join(web, file), "utf8");

describe("publicAsset", () => {
  it("sai da raiz do site, nunca relativo a pagina aberta", () => {
    expect(publicAsset("logo.png")).toBe("/logo.png");
    expect(publicAsset("/sw.js")).toBe("/sw.js");
  });
});

describe("edgeFunctionUrl", () => {
  it("monta o endereco da funcao sem barra dobrada", () => {
    expect(edgeFunctionUrl("desktop-download", "https://projeto.supabase.co/")).toBe(
      "https://projeto.supabase.co/functions/v1/desktop-download"
    );
  });
});

describe("index.html", () => {
  const html = read("index.html");

  it("aponta manifest e icone pela raiz: relativo, `/admin/login` pediria `/admin/logo.png`", () => {
    expect(html).toContain('href="/manifest.webmanifest"');
    expect(html).toContain('href="/logo.png"');
    expect(html).not.toMatch(/href="\.\//);
  });
});

describe(".htaccess da Hostinger", () => {
  const htaccess = read("public/.htaccess");

  it("mantem o link fixo /download do instalador, antes da regra do SPA", () => {
    const download = htaccess.indexOf("RewriteRule ^download/?$");
    const spa = htaccess.indexOf("RewriteRule . /index.html");
    expect(download).toBeGreaterThan(-1);
    expect(htaccess).toContain("/functions/v1/desktop-download [R=302,L]");
    expect(download).toBeLessThan(spa);
  });
});

describe("rotas publicas do App", () => {
  const app = read("src/App.tsx");

  it("pagina de apresentacao, painel da plataforma e link do WhatsApp existem", () => {
    expect(app).toContain('<Route path="/" element={<Entry />} />');
    expect(app).toContain('<Route path="/admin" element={<AdminPanel />} />');
    expect(app).toContain('<Route path="/admin/login" element={<AdminLogin />} />');
    expect(app).toContain('<Route path="/whatsapp/:token" element={<WhatsappConnect />} />');
  });

  it("o painel da plataforma nao passa pela sessao do site: o login dele e outro", () => {
    expect(app).not.toMatch(/only\([^)]*<Admin/);
    expect(app).not.toMatch(/<Private[^>]*>\s*<Admin/);
  });
});
