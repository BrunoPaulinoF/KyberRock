// Cifra simetrica das senhas que o painel guarda para poder exibir de volta.
//
// Por que existe: bcrypt (Supabase Auth) e SHA-256 (token do desktop) sao vias
// de mao unica — uma senha ja gravada nao volta por tela nenhuma. A unica forma
// de o administrador ver a senha de um carregador e CAPTURA-LA no momento em que
// ela e definida pelo painel. Este modulo e o cofre onde ela fica.
//
// A escolha que importa: o valor guardado e CIFRADO, e a chave vive num secret
// do Supabase (`KYBERROCK_CREDENTIAL_KEY`), fora do banco. Guardar a senha em
// texto seria mais simples e bem pior — um dump, um backup ou uma consulta com
// service role entregaria a senha de todos os carregadores de uma vez, e gente
// repete senha entre sistemas. Com a chave fora do banco, o dump sozinho nao
// abre nada.
//
// AES-GCM com IV aleatorio por gravacao: o mesmo texto cifrado duas vezes gera
// saidas diferentes, entao ninguem descobre quem repetiu a senha comparando
// linhas da tabela. O GCM ainda autentica — ciphertext adulterado falha em vez
// de decifrar em lixo.
//
// `crypto.subtle` existe no Deno e no Node 22, entao isto roda em producao e no
// vitest sem stub.

/** Formato guardado: v1.<base64(iv)>.<base64(ciphertext)>. */
const FORMAT_VERSION = "v1";
const IV_BYTES = 12;

export class CredentialCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialCipherError";
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Chave AES-256 derivada do secret por SHA-256. O secret e um texto qualquer
 * definido no painel do Supabase; o SHA-256 so normaliza o comprimento para os
 * 32 bytes que o AES-256 exige.
 */
async function importKey(secret: string): Promise<CryptoKey> {
  const trimmed = secret.trim();
  if (trimmed.length < 16) {
    throw new CredentialCipherError(
      "KYBERROCK_CREDENTIAL_KEY ausente ou curta demais (minimo de 16 caracteres)."
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(trimmed));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptCredential(plaintext: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return `${FORMAT_VERSION}.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

/**
 * Decifra. Devolve `null` — em vez de lancar — quando o valor nao abre com a
 * chave atual: chave trocada, registro de outra instalacao ou dado corrompido
 * nao podem derrubar a tela de credenciais, so deixar de mostrar aquele campo.
 */
export async function decryptCredential(
  stored: string | null | undefined,
  secret: string
): Promise<string | null> {
  const value = (stored ?? "").trim();
  if (!value) return null;

  const [version, encodedIv, encodedPayload] = value.split(".");
  if (version !== FORMAT_VERSION || !encodedIv || !encodedPayload) return null;

  try {
    const key = await importKey(secret);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(encodedIv) },
      key,
      fromBase64(encodedPayload)
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

/** O cofre so funciona com a chave configurada; a tela precisa saber disso. */
export function isCipherConfigured(secret: string | null | undefined): boolean {
  return (secret ?? "").trim().length >= 16;
}
