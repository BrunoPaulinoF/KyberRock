/**
 * Preferencias guardadas NO APARELHO (localStorage): som e modo sol do carregador, "trocar
 * sozinho" do monitoramento. Sao conveniencias de quem esta segurando a tela, nao dado da
 * pedreira — por isso nao sobem a nuvem.
 *
 * O armazenamento pode faltar (aba anonima, cota cheia, navegador que bloqueia): ler cai no
 * padrao e gravar falha calado. A tela nunca deixa de abrir por causa disso.
 */

/** "1"/"true" liga, "0"/"false" desliga; qualquer outra coisa (ou nada) fica com o padrao. */
export function parseStoredFlag(raw: string | null | undefined, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return fallback;
}

export function serializeFlag(value: boolean): string {
  return value ? "1" : "0";
}

export function readDeviceFlag(key: string, fallback: boolean): boolean {
  try {
    return parseStoredFlag(window.localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

export function writeDeviceFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, serializeFlag(value));
  } catch {
    // Sem armazenamento: a escolha vale so ate fechar a aba.
  }
}
