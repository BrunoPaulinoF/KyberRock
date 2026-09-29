import { useCallback, useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

/**
 * Filtro de tela que fica no endereco (`?aba=concluidas&placa=ABC`) e e LEMBRADO: voltar a tela
 * pelo menu devolve a aba, a busca e o periodo que estavam escolhidos (etapa 4 do plano de UI).
 * O endereco manda — um link com filtro abre filtrado —; sem filtro no endereco, vale o ultimo
 * escolhido nesta aba do navegador (`sessionStorage`, some ao fechar a aba).
 */
export function rememberedKey(pathname: string, key: string): string {
  return `kr.filtro:${pathname}:${key}`;
}

function readRemembered(storageKey: string): string | null {
  try {
    return window.sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeRemembered(storageKey: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(storageKey);
    else window.sessionStorage.setItem(storageKey, value);
  } catch {
    // Navegador sem armazenamento: o filtro vale so enquanto a tela esta aberta.
  }
}

export function useUrlState(key: string, fallback = ""): [string, (next: string) => void] {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const storageKey = rememberedKey(pathname, key);
  const fromUrl = params.get(key);
  const remembered = fromUrl === null ? readRemembered(storageKey) : null;
  const value = fromUrl ?? remembered ?? fallback;

  const set = useCallback(
    (next: string) => {
      writeRemembered(storageKey, next && next !== fallback ? next : null);
      setParams(
        (current) => {
          const copy = new URLSearchParams(current);
          if (!next || next === fallback) copy.delete(key);
          else copy.set(key, next);
          return copy;
        },
        { replace: true }
      );
    },
    [key, fallback, setParams, storageKey]
  );

  // Voltou pelo menu (sem filtro no endereco) com um filtro lembrado: ele volta para o endereco.
  useEffect(() => {
    if (fromUrl === null && remembered !== null && remembered !== fallback) set(remembered);
  }, [fromUrl, remembered, fallback, set]);

  return [value, set];
}
