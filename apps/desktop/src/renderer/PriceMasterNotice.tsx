import { useEffect, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import { priceMasterWhere, type PriceAuthority } from "../services/price-authority";

/**
 * Aviso de "os precos vem da balanca principal".
 *
 * Ele existe porque a trava do backend, sozinha, e muda: a operadora clicaria em salvar
 * para so entao descobrir que este computador nao define preco. O aviso aparece ANTES, diz
 * o nome do computador que define, e some sozinho na pedreira que nao elegeu principal.
 */

const PRICE_AUTHORITY_REFRESH_MS = 15_000;

const AUTHORITY_FALLBACK: PriceAuthority = {
  mode: "standalone",
  masterDeviceIds: [],
  masterDeviceNames: []
};

/**
 * Le o papel desta balanca no cadastro de preco. Falha de leitura vira `standalone` de
 * proposito: uma tela que trava preco por causa de um erro de IPC e pior que uma tela que
 * deixa tentar e recebe a recusa do backend.
 */
export function usePriceAuthority(desktopApi: KyberRockDesktopApi | null | undefined) {
  const [authority, setAuthority] = useState<PriceAuthority>(AUTHORITY_FALLBACK);

  useEffect(() => {
    let active = true;
    if (!desktopApi?.priceAuthorityGet) {
      setAuthority(AUTHORITY_FALLBACK);
      return;
    }
    const read = () => {
      void desktopApi
        .priceAuthorityGet()
        .then((value) => {
          if (active && value) setAuthority(value);
        })
        .catch(() => {
          if (active) setAuthority(AUTHORITY_FALLBACK);
        });
    };
    read();
    // O papel muda no painel web e chega aqui pelo heartbeat de acesso (5 s). A releitura
    // periodica e o que faz a tela aberta acompanhar a eleicao sem o operador sair e
    // voltar — e uma leitura do SQLite local, nao uma chamada de rede.
    const timer = setInterval(read, PRICE_AUTHORITY_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [desktopApi]);

  return authority;
}

export function PriceMasterNotice({
  authority,
  what = "Os precos"
}: {
  authority: PriceAuthority;
  /** Sujeito da frase: "Os precos", "Os precos especiais", "Os valores de frete". */
  what?: string;
}) {
  if (authority.mode !== "follower") return null;

  return (
    <p style={noticeStyle}>
      {what} desta pedreira sao definidos {priceMasterWhere(authority.masterDeviceNames)}. Aqui eles
      so sao exibidos — a alteracao feita la chega neste computador em segundos.
    </p>
  );
}

/** Texto curto para o `hint` de um campo desabilitado pela balanca principal. */
export function priceMasterHint(masterDeviceNames: readonly string[]): string {
  const where = priceMasterWhere(masterDeviceNames);
  return masterDeviceNames.length > 1
    ? `Definido ${where} — as balancas principais da pedreira.`
    : `Definido ${where}${masterDeviceNames.length === 1 ? ", a balanca principal da pedreira" : ""}.`;
}

const noticeStyle = {
  margin: "0 0 10px",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid #fde68a",
  background: "#fffbeb",
  color: "#92400e",
  fontSize: "12px",
  fontWeight: 600
} as const;
