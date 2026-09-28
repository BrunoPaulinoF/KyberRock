import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

import {
  CADASTRO_PING_TABLE,
  createCadastroChangeGate,
  touches,
  type ChangedTables
} from "./cadastro-live";
import { supabase } from "./supabase";

/**
 * A inscricao do site no aviso de cadastro (`cadastro_change_pings`) e a entrega as telas.
 * A regra (juntar, espacar, segurar com a aba escondida) vive em `cadastro-live.ts`.
 *
 * UMA inscricao por aba, montada na casca (`Layout`), e nao uma por tela: trocar de tela nao
 * reconecta, e a tela que abre ja encontra o aviso ligado. A entrega e por assinatura, nao por
 * estado do React — o aviso nao redesenha nada; so quem mostra a tabela que mudou rele.
 */

type Listener = (changed: ChangedTables) => void;

interface CadastroLive {
  subscribe: (listener: Listener) => () => void;
}

// Fora do provedor (teste, tela sem a casca) nada chega, e a tela segue com o botao de atualizar.
const CadastroLiveContext = createContext<CadastroLive>({ subscribe: () => () => undefined });

export function CadastroLiveProvider({
  companyId,
  children
}: {
  companyId: string;
  children: ReactNode;
}) {
  const listeners = useRef(new Set<Listener>());
  const live = useMemo<CadastroLive>(
    () => ({
      subscribe(listener) {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      }
    }),
    []
  );

  useEffect(() => {
    const isVisible = () => document.visibilityState !== "hidden";
    const gate = createCadastroChangeGate({
      isVisible,
      onFlush: (changed) => {
        for (const listener of [...listeners.current]) listener(changed);
      }
    });
    let subscribedBefore = false;
    const channel = supabase
      .channel(`cadastro-live:${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: CADASTRO_PING_TABLE,
          filter: `company_id=eq.${companyId}`
        },
        (payload) => {
          const row = payload.new as { source?: unknown } | null;
          gate.ping(typeof row?.source === "string" ? row.source : null);
        }
      )
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // O que mudou enquanto a inscricao esteve fora do ar (internet caiu, aba dormiu) nao
        // volta sozinho: na reconexao, toda tela aberta rele.
        if (subscribedBefore) gate.ping(null);
        subscribedBefore = true;
      });
    const onVisibility = () => {
      if (isVisible()) gate.wake();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      gate.stop();
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [companyId]);

  return <CadastroLiveContext.Provider value={live}>{children}</CadastroLiveContext.Provider>;
}

/**
 * Rele a tela quando a balanca (ou outra aba, ou o OMIE) mudar uma das `tables`.
 *
 * `refresh` deve ser a releitura SILENCIOSA da tela (`refresh` de `useAsync`/`usePaged`): o
 * que esta na tela fica ate a resposta chegar, sem "Carregando..." piscando e sem voltar a
 * lista para a primeira pagina.
 */
export function useOnCadastroChange(
  refresh: () => unknown,
  tables: readonly string[] | undefined
): void {
  const live = useContext(CadastroLiveContext);
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  const key = tables ? tables.join(",") : "*";
  useEffect(() => {
    const wanted = key === "*" ? undefined : key.split(",");
    return live.subscribe((changed) => {
      if (touches(changed, wanted)) void latest.current();
    });
  }, [live, key]);
}
