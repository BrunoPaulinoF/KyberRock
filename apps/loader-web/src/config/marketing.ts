// Conteudo comercial da landing page do loader-web.
//
// ATENCAO: o numero abaixo e um PLACEHOLDER de exemplo (nao e um telefone
// real). Antes de divulgar o site, troque por o numero comercial verdadeiro
// no formato E.164 sem simbolos (ex.: "5531999998888").
export const WHATSAPP_EXAMPLE_NUMBER = "5500000000000";

export const WHATSAPP_DISPLAY_NUMBER = "+55 (00) 00000-0000";

export const WHATSAPP_DEFAULT_MESSAGE =
  "Ola! Tenho uma pedreira e quero conhecer o KyberRock (pesagem, carregamento e faturamento).";

export function buildWhatsAppLink(
  message: string = WHATSAPP_DEFAULT_MESSAGE,
  number: string = WHATSAPP_EXAMPLE_NUMBER
): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
