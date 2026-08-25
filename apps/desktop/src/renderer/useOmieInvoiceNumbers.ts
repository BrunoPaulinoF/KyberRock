import { useEffect, useRef, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import {
  OMIE_INVOICE_NUMBER_ASK_LIMIT,
  selectInvoiceNumbersToAsk
} from "../services/omie-invoice-numbers";
import type { OmieInvoiceNumberRow } from "../services/omie-invoice-numbers";

/**
 * Preenche sozinha a coluna "Nota fiscal" da tela que a usa.
 *
 * Ao abrir (e a cada periodo novo), pergunta ao OMIE o numero da nota das cargas que estao
 * na tela sem ele e, quando alguma volta com numero, manda a tela recarregar. Nada disso e
 * pedido ao operador: a atendente que vai mandar o relatorio ao cliente nao tem por que
 * saber que existe uma conferencia, nem apertar um botao para dispara-la.
 *
 * A conferencia de fundo continua existindo e nao foi substituida — ela e quem cobre a
 * balanca com a tela fechada. O que ela nao cobre e o caso desta tela: o rodizio poe o
 * movimento dos ultimos dois dias na frente, e fechar a quinzena do dia 1 ao 15 e olhar
 * justamente para o acervo, que so entra na passada completa, de hora em hora.
 *
 * Tres cuidados:
 *
 *  1. **Silenciosa.** Falha nao vira aviso na tela: o relatorio local esta certo com ou sem
 *     a nota, e um erro de rede aqui nao e problema do operador. Como o id nao e marcado
 *     como perguntado quando a chamada falha, a proxima abertura tenta de novo — e e assim
 *     que a tela se resolve sozinha quando a internet volta.
 *  2. **Nao repete.** A memoria da sessao evita que filtrar por placa ou digitar na busca
 *     — que refaz a lista — vire uma chamada ao OMIE por tecla.
 *  3. **Nao bloqueia.** A tela ja renderizou com o dado local antes disto rodar; o numero
 *     aparece quando chegar.
 *
 * E vai ate o FIM da tela, em levas. O numero da nota nao vem junto com a conferencia: a
 * listagem do OMIE so enxerga a etapa do kanban, e cada numero custa uma consulta dirigida
 * ao documento, que o edge limita por passada. Mandar as 326 cargas do relatorio numa
 * pergunta so devolvia o teto — dez — e marcava as outras 316 como "ja perguntadas": a
 * coluna ficava com dez numeros e nao andava mais enquanto a tela estivesse aberta. Agora
 * cada leva e do tamanho do teto (tudo que vai e consultado) e a proxima sai assim que
 * esta volta, ate a tela nao ter mais o que perguntar.
 */
export function useOmieInvoiceNumbers(
  desktopApi: KyberRockDesktopApi | null,
  rows: readonly OmieInvoiceNumberRow[] | null | undefined,
  onFilled: () => void | Promise<void>
): void {
  const askedRef = useRef<Set<string>>(new Set());
  const busyRef = useRef(false);
  // Contador de levas. So existe para RE-DISPARAR o efeito quando a leva termina sem nada
  // ter mudado na tela: sem ele, uma leva em que nenhum numero saiu (as cargas ainda nao
  // foram faturadas no OMIE) deixaria `rows` igual e a drenagem pararia ali, com centenas
  // de cargas nunca perguntadas.
  const [round, setRound] = useState(0);
  // A tela recria `onFilled` a cada render. Guardar a ultima versao numa ref evita que
  // isso re-dispare a pergunta — o gatilho tem de ser a lista, e so ela.
  const onFilledRef = useRef(onFilled);
  onFilledRef.current = onFilled;

  useEffect(() => {
    if (!desktopApi || !rows || rows.length === 0) return;
    if (busyRef.current) return;
    // Sem internet nao ha o que perguntar. Sair aqui — antes de marcar qualquer id como
    // perguntado — e o que faz a tela tentar de novo quando a conexao voltar.
    if (!navigator.onLine) return;
    // Teto do que UMA tela aberta pergunta. O que sobra fica para a proxima abertura e para
    // a conferencia de fundo: a fila do OMIE tambem envia os fechamentos.
    if (askedRef.current.size >= OMIE_INVOICE_NUMBER_ASK_LIMIT) return;

    const operationIds = selectInvoiceNumbersToAsk(rows, askedRef.current);
    if (operationIds.length === 0) return;

    let cancelled = false;
    busyRef.current = true;
    void desktopApi
      .reconcileOmieInvoiceNumbers(operationIds)
      .then((result) => {
        for (const operationId of operationIds) askedRef.current.add(operationId);
        if (cancelled) return;
        // Proxima leva. Vem depois do recarregamento quando algum numero chegou, para a
        // lista nova ja entrar sem as cargas resolvidas.
        if (result.invoiceNumbers === 0 && result.billed === 0) {
          setRound((value) => value + 1);
          return;
        }
        return Promise.resolve(onFilledRef.current()).then(() => {
          if (!cancelled) setRound((value) => value + 1);
        });
      })
      .catch(() => {
        // De proposito: ver o numero da nota e um ganho, nao um pre-requisito da tela.
      })
      .finally(() => {
        busyRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [desktopApi, rows, round]);
}
