import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "./api";
import { readCache, writeCache } from "./query-cache";

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
  pageSize = 50,
  /**
   * `key`: memoria da PRIMEIRA pagina entre telas (`lib/query-cache.ts`) — voltar a lista mostra
   * na hora o que ja tinha e rele por tras. Muda junto com os `deps` (a busca, o filtro).
   */
  options?: { key?: string | null }
) {
  const key = options?.key ?? null;
  const [rows, setRows] = useState<T[]>(() => readCache<Page<T>>(key)?.rows ?? []);
  const [total, setTotal] = useState(() => readCache<Page<T>>(key)?.total ?? 0);
  const [loading, setLoading] = useState(() => readCache<Page<T>>(key) === undefined);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const loaded = useRef(0);
  // Quantas linhas a tela quer ter: o que ja veio mais o "Ver mais" que ainda esta a caminho.
  const wanted = useRef(pageSize);

  const load = useCallback(
    async (from: number, append: boolean) => {
      const current = ++generation.current;
      wanted.current = from + pageSize;
      const cached = !append && from === 0 ? readCache<Page<T>>(key) : undefined;
      if (cached) {
        // Primeira pagina ja vista: aparece na hora e a leitura corre por tras.
        setRows(cached.rows);
        setTotal(cached.total);
        loaded.current = cached.rows.length;
        setLoading(false);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const page = await fetchPage(from, from + pageSize - 1);
        if (current !== generation.current) return;
        setRows((previous) => (append ? [...previous, ...page.rows] : page.rows));
        loaded.current = from + page.rows.length;
        setTotal(page.total);
        if (!append && from === 0) writeCache(key, page);
      } catch (caught) {
        if (current === generation.current) setError(errorMessage(caught, "Falha ao carregar."));
      } finally {
        if (current === generation.current) setLoading(false);
      }
      // `fetchPage` muda a cada render; quem manda recarregar sao os `deps`.
    },
    [...deps, key]
  );

  /**
   * Rele o que ja esta na tela (as paginas que o "Ver mais" trouxe, nao so a primeira), sem
   * "Carregando..." e sem voltar a lista para o comeco — e a releitura do aviso de cadastro
   * (`useOnCadastroChange`). Falha fica calada: a lista continua com o que ja tinha. Um "Ver
   * mais" que estava a caminho entra nesta leitura (`wanted`), em vez de se perder.
   */
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const page = await fetchPage(0, Math.max(wanted.current, loaded.current, pageSize) - 1);
      if (current !== generation.current) return;
      setRows(page.rows);
      loaded.current = page.rows.length;
      setTotal(page.total);
      setError(null);
    } catch {
      // Silencioso de proposito (ver acima).
    } finally {
      // Se esta releitura passou na frente de um `load`, e ela quem desliga o loading.
      if (current === generation.current) setLoading(false);
    }
  }, [...deps, key]);

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
    refresh,
    more: () => load(loaded.current, true)
  };
}
