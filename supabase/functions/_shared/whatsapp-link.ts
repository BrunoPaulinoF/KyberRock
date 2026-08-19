// Regras do link temporario de conexao do WhatsApp.
//
// O link existe porque o QR code da UAZAPI so serve a quem esta na frente do
// computador da balanca, e o celular dono do numero quase nunca esta ali. A
// balanca gera um endereco publico, manda para quem tem o aparelho e essa
// pessoa escaneia o QR pelo proprio celular.
//
// Tudo o que decide se o link ainda vale mora aqui, puro e testado pelo vitest:
// prazo, estado, contagem regressiva, formato do token e roteamento do caminho.
// A Edge Function so faz banco e rede; a pagina do convidado e do loader-web. O
// motivo e o de sempre -- prazo calculado em dois lugares vira prazo diferente
// em dois lugares.

/** Quinze minutos: o link e para usar na hora, com alguem do outro lado da linha. */
export const WHATSAPP_LINK_TTL_MINUTES = 15;
export const WHATSAPP_LINK_TTL_MS = WHATSAPP_LINK_TTL_MINUTES * 60_000;

/** Quantos bytes de aleatoriedade o token carrega (256 bits). */
const TOKEN_BYTES = 32;

/** Comprimento do token em base64url, sem padding, para TOKEN_BYTES bytes. */
const TOKEN_LENGTH = Math.ceil((TOKEN_BYTES * 4) / 3);

export type WhatsappLinkState = "active" | "expired" | "revoked" | "connected";

/** Colunas de `whatsapp_connection_links` que decidem o estado do link. */
export interface WhatsappLinkLifecycle {
  expires_at: string;
  revoked_at?: string | null;
  connected_at?: string | null;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Vencimento de um link criado agora. */
export function whatsappLinkExpiresAt(createdAt: Date): string {
  return new Date(createdAt.getTime() + WHATSAPP_LINK_TTL_MS).toISOString();
}

/**
 * Estado do link. A ordem importa: conectado ganha de tudo (o pareamento deu
 * certo, e essa e a noticia que a pagina precisa dar), revogado ganha do prazo
 * (foi o operador que cancelou, e dizer "expirou" seria mentir sobre o motivo).
 */
export function whatsappLinkState(
  link: WhatsappLinkLifecycle,
  now: Date = new Date()
): WhatsappLinkState {
  if (parseTime(link.connected_at) !== null) return "connected";
  if (parseTime(link.revoked_at) !== null) return "revoked";
  const expiresAt = parseTime(link.expires_at);
  if (expiresAt === null || expiresAt <= now.getTime()) return "expired";
  return "active";
}

/** Milissegundos restantes, nunca negativo. */
export function whatsappLinkRemainingMs(
  expiresAt: string | null | undefined,
  now: Date = new Date()
): number {
  const parsed = parseTime(expiresAt);
  if (parsed === null) return 0;
  return Math.max(0, parsed - now.getTime());
}

/** Contagem regressiva em mm:ss, para a tela e para a pagina do link. */
export function formatWhatsappLinkCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Token novo, em base64url (o que vai na URL). O banco guarda so o hash dele. */
export function generateWhatsappLinkToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Confere o formato antes de ir ao banco. Nao e seguranca (o hash e que decide),
 * e sim nao transformar cada varredura de URL de robo numa consulta.
 */
export function isWhatsappLinkToken(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTH}}$`).test(value);
}

/** Caminho da pagina do convidado dentro do site (rota do loader-web). */
export const WHATSAPP_LINK_PAGE_PATH = "whatsapp";

/**
 * Endereco publico do loader-web hoje. Nao e segredo -- e a barra de enderecos
 * do navegador de quem usa o site --, e por isso vive no codigo, como o
 * `DEFAULT_SUPABASE_URL` do desktop e o destino do `/download` no nginx. Assim o
 * link funciona numa instalacao nova sem nenhum passo manual no dashboard.
 */
export const DEFAULT_WHATSAPP_LINK_SITE_URL = "https://kybernan-kyber-rock.qdidmr.easypanel.host";

/**
 * Site de onde sai a pagina do convidado: o valor do ambiente manda, o padrao
 * acima cobre o resto. Trocar de dominio e definir `KYBERROCK_SITE_URL` no
 * projeto Supabase -- sem deploy, sem mexer no codigo.
 */
export function resolveWhatsappLinkSiteUrl(configured: string | undefined | null): string {
  const trimmed = (configured ?? "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_WHATSAPP_LINK_SITE_URL;
}

/**
 * Endereco que o operador envia. Ele aponta para o SITE (loader-web), nao para
 * o dominio do projeto Supabase: as Edge Functions respondem HTML como
 * `text/plain` com `nosniff` -- protecao anti-phishing do `*.supabase.co` --
 * entao uma pagina servida de la chegaria ao celular do convidado como
 * codigo-fonte, nao como pagina. O QR continua vindo da Edge Function, mas em
 * JSON, que passa sem problema.
 */
export function buildWhatsappLinkUrl(siteUrl: string, token: string): string {
  const trimmed = siteUrl.trim().replace(/\/+$/, "");
  return `${trimmed}/${WHATSAPP_LINK_PAGE_PATH}/${token}`;
}

/** Endpoint que a pagina consulta de 3 em 3 s para o QR e o estado (JSON). */
export function buildWhatsappLinkStateUrl(supabaseUrl: string, token: string): string {
  const trimmed = supabaseUrl.trim().replace(/\/+$/, "");
  return `${trimmed}/functions/v1/whatsapp-link/c/${token}/state`;
}

export type WhatsappLinkRouteKind = "api" | "state" | "unknown";

export interface WhatsappLinkRoute {
  kind: WhatsappLinkRouteKind;
  token: string | null;
}

/**
 * Le o caminho da requisicao. O mesmo codigo atende dois prefixos: no projeto a
 * funcao vive em `/functions/v1/whatsapp-link/...` e no `supabase functions
 * serve` em `/whatsapp-link/...`. Por isso o roteamento parte do slug, e nao da
 * posicao dos segmentos.
 */
export function routeWhatsappLinkPath(pathname: string): WhatsappLinkRoute {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const slugIndex = segments.lastIndexOf("whatsapp-link");
  const rest = slugIndex >= 0 ? segments.slice(slugIndex + 1) : segments;

  if (rest.length === 0) return { kind: "api", token: null };
  if (rest[0] !== "c") return { kind: "unknown", token: null };

  const token = rest[1] ?? "";
  if (!isWhatsappLinkToken(token)) return { kind: "unknown", token: null };
  if (rest.length === 3 && rest[2] === "state") return { kind: "state", token };
  return { kind: "unknown", token: null };
}

/**
 * O QR chega da UAZAPI como data URL, mas nem toda versao manda o prefixo --
 * e `<img src>` sem ele mostra imagem quebrada, que na pagina do link vira
 * "nao funciona" sem nenhuma pista do porque.
 */
export function normalizeQrCodeDataUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}
