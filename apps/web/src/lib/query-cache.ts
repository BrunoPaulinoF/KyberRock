/**
 * Memoria das leituras entre uma tela e outra (etapa 3 do plano de UI). Sem ela, voltar ao
 * Painel depois de abrir os Cadastros apagava a tela e buscava tudo de novo, com "Carregando...".
 * Com ela a tela volta NA HORA com o que ja tinha e rele por tras (`useAsync`/`usePaged` com
 * `key`) — o dado mostrado nunca fica velho por mais que uma ida e volta a nuvem.
 *
 * Fica so na memoria da aba (nada vai para o disco) e e apagada ao sair e ao entrar com outro
 * login (`auth.tsx`): a chave leva a empresa, mas dois logins da mesma empresa podem ver coisas
 * diferentes.
 */

/** Quantas leituras a memoria guarda; a mais antiga sai quando passa disso. */
export const QUERY_CACHE_LIMIT = 80;

const cache = new Map<string, unknown>();

export function readCache<T>(key: string | null | undefined): T | undefined {
  if (!key || !cache.has(key)) return undefined;
  return cache.get(key) as T;
}

export function writeCache<T>(key: string | null | undefined, data: T): void {
  if (!key) return;
  // Reinserir poe a chave no fim: a ordem do Map vira "usada por ultimo".
  cache.delete(key);
  cache.set(key, data);
  while (cache.size > QUERY_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearQueryCache(): void {
  cache.clear();
}
