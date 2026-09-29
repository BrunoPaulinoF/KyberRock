import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "./api";
import { readCache, writeCache } from "./query-cache";

export interface AsyncOptions {
  /**
   * Chave da memoria entre telas (`lib/query-cache.ts`). Com ela, voltar a tela mostra na hora
   * o que ja tinha e rele por tras, sem "Carregando...". Precisa mudar junto com os `deps`
   * (empresa, periodo, filtro): `painel:<empresa>:<unidade>:<dia>`.
   */
  key?: string | null;
}

/**
 * Carrega dados com estado de loading/erro, um `reload` para depois de gravar e um `refresh`
 * silencioso para o aviso de cadastro (`useOnCadastroChange`).
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[], options?: AsyncOptions) {
  const key = options?.key ?? null;
  const [data, setData] = useState<T | null>(() => readCache<T>(key) ?? null);
  const [loading, setLoading] = useState(() => readCache<T>(key) === undefined);
  const [error, setError] = useState<string | null>(null);
  // Resposta velha nao cobre a nova: o aviso pode reler enquanto a tela ainda relia.
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    const cached = readCache<T>(key);
    // Com memoria, a tela mostra o que ja tinha enquanto rele: nada de "Carregando...".
    if (cached !== undefined) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const next = await loader();
      if (current === generation.current) {
        setData(next);
        writeCache(key, next);
      }
    } catch (caught) {
      if (current === generation.current) setError(errorMessage(caught, "Falha ao carregar."));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [...deps, key]);

  /**
   * Rele sem "Carregando...": o que esta na tela fica ate a resposta chegar. Falha fica calada
   * — e releitura de fundo, a tela continua com o que ja tinha e o botao de atualizar segue la.
   */
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await loader();
      if (current === generation.current) {
        setData(next);
        writeCache(key, next);
        setError(null);
      }
    } catch {
      // Silencioso de proposito (ver acima).
    } finally {
      // Se esta releitura passou na frente de um `reload`, e ela quem desliga o loading.
      if (current === generation.current) setLoading(false);
    }
  }, [...deps, key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload, refresh };
}
