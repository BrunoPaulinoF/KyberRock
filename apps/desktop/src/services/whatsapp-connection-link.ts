// Link temporario de conexao do WhatsApp, do lado da balanca.
//
// A tela de Relatorios gera o QR code para quem esta na frente do computador,
// mas o celular dono do numero quase nunca esta ali. O link resolve isso: a
// nuvem devolve um endereco publico com prazo de 15 minutos, o operador manda
// para quem tem o aparelho e essa pessoa escaneia o QR pelo proprio celular.
//
// Aqui so vive a REGRA do link: o formato do registro e ate quando ele vale. O
// prazo NAO e calculado nesta ponta -- quem carimba o vencimento e a Edge
// Function, e o desktop apenas o respeita. Um relogio errado na balanca nao
// pode esticar nem encurtar um link que o servidor ja datou.
//
// Modulo puro de proposito: a tela de Relatorios importa daqui a contagem
// regressiva, e o renderer nao pode arrastar junto nada que fale com o SQLite.
// Quem guarda e le o link no banco e `report-channels.ts`.

export const WHATSAPP_CONNECTION_LINK_SETTING_KEY = "whatsapp_connection_link";

export interface WhatsappConnectionLink {
  /** Id da linha em `whatsapp_connection_links`, usado para cancelar. */
  id: string;
  /** Endereco publico que o operador envia. Carrega o token em claro. */
  url: string;
  createdAt: string;
  expiresAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Aceita so o registro completo: link pela metade nao tem como ser exibido. */
export function parseWhatsappConnectionLink(value: unknown): WhatsappConnectionLink | null {
  if (!isRecord(value)) return null;
  const { id, url, createdAt, expiresAt } = value;
  if (
    typeof id !== "string" ||
    typeof url !== "string" ||
    typeof createdAt !== "string" ||
    typeof expiresAt !== "string" ||
    !id ||
    !url ||
    !expiresAt
  ) {
    return null;
  }
  return { id, url, createdAt, expiresAt };
}

export function whatsappConnectionLinkRemainingMs(
  link: Pick<WhatsappConnectionLink, "expiresAt">,
  now: Date = new Date()
): number {
  const expiresAt = Date.parse(link.expiresAt);
  if (Number.isNaN(expiresAt)) return 0;
  return Math.max(0, expiresAt - now.getTime());
}

export function isWhatsappConnectionLinkActive(
  link: Pick<WhatsappConnectionLink, "expiresAt">,
  now: Date = new Date()
): boolean {
  return whatsappConnectionLinkRemainingMs(link, now) > 0;
}

/** Contagem regressiva em mm:ss, exibida ao lado do link na tela. */
export function formatWhatsappConnectionLinkCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
