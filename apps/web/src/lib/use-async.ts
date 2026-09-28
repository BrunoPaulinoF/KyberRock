import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "./api";

/**
 * Carrega dados com estado de loading/erro, um `reload` para depois de gravar e um `refresh`
 * silencioso para o aviso de cadastro (`useOnCadastroChange`).
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Resposta velha nao cobre a nova: o aviso pode reler enquanto a tela ainda relia.
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const next = await loader();
      if (current === generation.current) setData(next);
    } catch (caught) {
      if (current === generation.current) setError(errorMessage(caught, "Falha ao carregar."));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, deps);

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
        setError(null);
      }
    } catch {
      // Silencioso de proposito (ver acima).
    } finally {
      // Se esta releitura passou na frente de um `reload`, e ela quem desliga o loading.
      if (current === generation.current) setLoading(false);
    }
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload, refresh };
}
