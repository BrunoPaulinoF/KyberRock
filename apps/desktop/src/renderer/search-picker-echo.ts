/**
 * O eco do clique que escolhe uma linha da lista de busca.
 *
 * Quase todo seletor do aplicativo mora dentro de um `<label>` (o rotulo
 * "Cliente", "Produto", "Transportadora" envolve o campo inteiro). Quando o
 * operador clica numa linha, o `SearchPicker` fecha a lista na hora — e, com a
 * linha ja fora da tela, o navegador entende aquele mesmo clique como um clique
 * no ROTULO e devolve foco e clique para o campo. Como o campo abre a lista ao
 * receber foco, a lista reabria sozinha: na tela Nova entrada era preciso
 * escolher o cliente e depois clicar fora da tela para o campo enfim fechar.
 *
 * A saida nao e tirar o `<label>` (clicar no rotulo para cair no campo e util):
 * e o campo reconhecer que o foco e o clique chegando junto com a escolha sao o
 * eco do mesmo gesto, e nao um pedido novo de abrir a lista. O eco vem no mesmo
 * ciclo de eventos da escolha, entao a trava dura so ate o proximo — nao ha
 * janela de tempo arbitraria que pudesse engolir o clique seguinte do operador.
 */

/** O que pediu para abrir a lista. */
export type PickerGesture = "focus" | "click" | "type" | "arrow-down";

/**
 * Se este gesto deve abrir a lista.
 *
 * `justPicked` vale enquanto o ciclo de eventos da escolha nao terminou. Digitar
 * e a seta para baixo passam mesmo assim: o eco do `<label>` e sempre foco ou
 * clique, e um gesto de teclado logo apos escolher e o operador querendo trocar
 * o que acabou de escolher.
 */
export function shouldOpenOnGesture(gesture: PickerGesture, justPicked: boolean): boolean {
  if (gesture === "type" || gesture === "arrow-down") return true;
  return !justPicked;
}
