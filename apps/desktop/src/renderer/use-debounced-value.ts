import { useEffect, useState } from "react";

/**
 * Quanto uma barra de pesquisa espera depois da ultima tecla antes de ir buscar.
 *
 * Toda busca do aplicativo custa uma leitura do outro lado do IPC — o cadastro em memoria,
 * o relatorio do periodo, o fechamento. Sem espera, digitar "levisa" disparava seis dessas
 * leituras e jogava cinco fora; com o relatorio de fechamento, cada uma era uma consulta
 * multi-tabela do periodo inteiro, e era ela que fazia a tela travar por tecla.
 *
 * 140ms e curto demais para o operador perceber e longo o bastante para juntar a palavra.
 */
export const SEARCH_DEBOUNCE_MS = 140;

/**
 * O valor "que parou de mudar".
 *
 * Devolve `value` na primeira pintura (a lista em repouso tem de aparecer junto com a tela)
 * e, dai em diante, so depois de `delayMs` sem alteracao.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (value === debounced) return;
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs, debounced]);

  return debounced;
}
