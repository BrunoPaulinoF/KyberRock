import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "./api";

export interface Page<T> {
  rows: T[];
  total: number;
}

/**
 * Lista paginada NO BANCO: traz `pageSize` linhas, e `more()` traz as proximas e junta no fim.
 * Mudar `deps` (a busca, o filtro) volta para a primeira pagina. Resposta que chega depois de
 * uma troca de filtro e descartada, para a lista nao misturar duas buscas.
 */
export function usePaged<T>(
  fetchPage: (from: number, to: number) => Promise<Page<T>>,
  deps: unknown[],
  pageSize = 50
) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const loaded = useRef(0);

  const load = useCallback(async (from: number, append: boolean) => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(from, from + pageSize - 1);
      if (current !== generation.current) return;
      setRows((previous) => (append ? [...previous, ...page.rows] : page.rows));
      loaded.current = from + page.rows.length;
      setTotal(page.total);
    } catch (caught) {
      if (current === generation.current) setError(errorMessage(caught, "Falha ao carregar."));
    } finally {
      if (current === generation.current) setLoading(false);
    }
    // `fetchPage` muda a cada render; quem manda recarregar sao os `deps`.
  }, deps);

  useEffect(() => {
    void load(0, false);
  }, [load]);

  return {
    rows,
    total,
    loading,
    error,
    /** Relê do comeco (depois de gravar). */
    reload: () => load(0, false),
    more: () => load(loaded.current, true)
  };
}
