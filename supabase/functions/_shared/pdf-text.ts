// Texto que o pdf-lib consegue desenhar com as fontes padrao (Helvetica).
//
// As StandardFonts usam a codificacao WinAnsi: Latin-1 mais um punhado de
// sinais (aspas curvas, travessao, euro...). Qualquer outro caractere faz o
// `drawText` LANCAR, e o PDF inteiro morre — junto com o envio do relatorio.
// Enquanto o extrato do OMIE saia com o historico vazio isso nunca apareceu;
// com o nome do cliente e a observacao do lancamento (texto livre, digitado
// no OMIE) basta um emoji ou um "≥" para derrubar o relatorio do dia. Fica
// fora do pdf.ts porque aquele importa `npm:` e o vitest nao o carrega.

const WIN_ANSI_EXTRAS = new Set(Array.from("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"));

/** Troca quebras de linha por espaco e o que a WinAnsi nao tem por "?". */
export function toWinAnsiText(text: string): string {
  let result = "";
  for (const char of text.normalize("NFC").replace(/[\r\n\t]+/g, " ")) {
    const code = char.codePointAt(0) ?? 0;
    const printableLatin1 = (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff);
    result += printableLatin1 || WIN_ANSI_EXTRAS.has(char) ? char : "?";
  }
  return result;
}
