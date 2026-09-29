import { useEffect, useRef, useState } from "react";

/**
 * Quanto antes do fim da lista o "Ver mais" ja dispara: a proxima pagina chega enquanto o dedo
 * ainda rola, em vez de a lista parar e esperar.
 */
export const AUTO_LOAD_MARGIN_PX = 300;

/** Qual pagina ja foi pedida: o que esta na tela e o total de entao. */
export function autoLoadKey(shown: number, total: number): string {
  return `${shown}/${total}`;
}

/**
 * Se o rodape que apareceu na tela deve trazer a proxima pagina sozinho. Nao pede de novo a
 * mesma pagina (`askedKey`): se ela falhou, a lista nao cresce, e tentar a cada rolagem viraria
 * um laco de pedidos — fica o botao, que continua ali.
 */
export function shouldAutoLoadMore(input: {
  visible: boolean;
  loading: boolean;
  left: number;
  key: string;
  askedKey: string | null;
}): boolean {
  return input.visible && !input.loading && input.left > 0 && input.key !== input.askedKey;
}

/**
 * No celular a lista paginada carrega sozinha quando o rodape "Ver mais" chega perto da tela,
 * sem precisar apertar o botao. Devolve a ref de callback do rodape.
 *
 * O observador e refeito a cada pagina que chega: ele so avisa quando a visibilidade MUDA, e o
 * rodape que continua na tela depois da pagina nova (lista curta, tela alta) precisa pedir a
 * seguinte mesmo assim — a primeira leitura de um observador novo e que da esse aviso.
 */
export function useAutoLoadMore({
  enabled,
  shown,
  total,
  loading,
  onMore
}: {
  enabled: boolean;
  shown: number;
  total: number;
  loading: boolean;
  onMore: () => void;
}) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const onMoreRef = useRef(onMore);
  const askedKey = useRef<string | null>(null);
  const left = Math.max(0, total - shown);
  const key = autoLoadKey(shown, total);

  useEffect(() => {
    onMoreRef.current = onMore;
  }, [onMore]);

  useEffect(() => {
    // A lista andou (pagina nova, busca nova): o pedido antigo ja nao trava nada. Sem isso, voltar
    // ao mesmo "50 de 2.000" depois de limpar a busca nao carregaria mais sozinho.
    if (askedKey.current !== key) askedKey.current = null;
    if (!enabled || !element || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (!shouldAutoLoadMore({ visible, loading, left, key, askedKey: askedKey.current })) {
          return;
        }
        askedKey.current = key;
        onMoreRef.current();
      },
      { rootMargin: `0px 0px ${AUTO_LOAD_MARGIN_PX}px 0px` }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, element, loading, left, key]);

  return setElement;
}
