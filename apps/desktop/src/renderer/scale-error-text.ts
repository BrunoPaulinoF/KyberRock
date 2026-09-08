/**
 * Texto de erro da balanca como o operador precisa ler.
 *
 * O Electron embrulha o que veio do processo principal: "Error invoking remote
 * method 'desktop:scale-connect': Error: A balanca ... nao respondeu". A parte
 * util e a ultima; o comeco e endereco de codigo na cara de quem so quer saber
 * por que a balanca nao conectou.
 */
export function scaleErrorText(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : "";
  const match = /Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?([\s\S]*)$/.exec(
    raw
  );
  return (match?.[1] ?? raw).trim() || fallback;
}
