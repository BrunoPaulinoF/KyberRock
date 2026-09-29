import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

/**
 * Filtro de tela que fica no endereco (`?aba=concluidas&placa=ABC`) e e LEMBRADO: voltar a tela
 * pelo menu devolve a aba, a busca e o periodo que estavam escolhidos (etapa 4 do plano de UI).
 * O endereco manda — um link com filtro abre exatamente com aquele filtro —; so quando o
 * endereco chega SEM filtro nenhum (a pessoa voltou pelo menu) vale o ultimo escolhido nesta aba
 * do navegador (`sessionStorage`, some ao fechar a aba).
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

/**
 * Mudancas de filtro feitas no MESMO clique (ou no mesmo ciclo de efeitos) se somam: o
 * `setSearchParams` parte do endereco do ultimo desenho da tela, entao o segundo `set` do mesmo
 * clique apagaria o primeiro. Aqui fica o endereco "ja com as mudancas", ate o fim do clique.
 */
let pending: { pathname: string; params: URLSearchParams } | null = null;

export function mergeParam(
  base: URLSearchParams,
  key: string,
  next: string,
  fallback: string
): URLSearchParams {
  const copy = new URLSearchParams(base);
  if (!next || next === fallback) copy.delete(key);
  else copy.set(key, next);
  return copy;
}

export function useUrlState(key: string, fallback = ""): [string, (next: string) => void] {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const storageKey = rememberedKey(pathname, key);
  const fromUrl = params.get(key);
  const urlHasFilters = Array.from(params.keys()).length > 0;
  const remembered = fromUrl === null && !urlHasFilters ? readRemembered(storageKey) : null;
  const urlValue = fromUrl ?? remembered ?? fallback;

  /*
   * O valor mostrado muda NA HORA (o roteador troca o endereco numa transicao, e um campo de
   * texto preso direto nele pulava o cursor e perdia letra digitada rapido). O endereco segue
   * atras; quando ele muda por fora (link, voltar do navegador), o valor acompanha — o que for
   * so o eco do que esta propria tela escreveu e ignorado.
   */
  const [value, setValue] = useState(urlValue);
  const written = useRef<string[]>([]);
  useEffect(() => {
    const echo = written.current.indexOf(urlValue);
    if (echo >= 0) {
      written.current = written.current.slice(echo + 1);
      return;
    }
    written.current = [];
    setValue(urlValue);
  }, [urlValue]);

  const set = useCallback(
    (next: string) => {
      setValue(next);
      written.current = [...written.current, next || fallback];
      writeRemembered(storageKey, next && next !== fallback ? next : null);
      const base = pending?.pathname === pathname ? pending.params : params;
      const merged = mergeParam(base, key, next, fallback);
      pending = { pathname, params: merged };
      queueMicrotask(() => {
        pending = null;
      });
      setParams(merged, { replace: true });
    },
    [key, fallback, params, pathname, setParams, storageKey]
  );

  // Voltou pelo menu (sem filtro no endereco) com um filtro lembrado: ele volta para o endereco.
  useEffect(() => {
    if (fromUrl === null && remembered !== null && remembered !== fallback) set(remembered);
    // So quando a tela abre sem filtro: depois disso quem manda e o endereco.
  }, [fromUrl, remembered, fallback]);

  return [value, set];
}
