/**
 * A operacao-fantasma do teste de impressora.
 *
 * `printTestReceipt` precisa gravar uma via em `print_receipts`, e essa tabela exige
 * `operation_id` apontando para uma operacao de verdade (`NOT NULL REFERENCES
 * weighing_operations(id)`). Como testar a impressora nao e uma pesagem, o teste cria e
 * reaproveita esta linha unica, com peso de exemplo e `cancel_reason = 'Teste de impressora'`.
 *
 * Ela e um DETALHE LOCAL da impressao e nao pode sair da maquina. Sem esta constante ela saiu:
 * a reconciliacao (`listOperationsPendingCloudPush`) empurra toda operacao ainda nao
 * sincronizada, e o teste de impressora de uma pedreira apareceu na nuvem como operacao
 * cancelada de 12.000 kg -- ou seja, na aba Canceladas de TODAS as balancas daquela pedreira,
 * e em qualquer relatorio que leia canceladas. Um clique em "testar impressora" nao pode virar
 * registro de operacao para a pedreira inteira.
 *
 * O id e fixo de proposito: e o que permite ao teste seguinte reaproveitar a mesma linha em
 * vez de acumular uma por clique.
 */
export const PRINTER_TEST_OPERATION_ID = "test";

/** Esta operacao e a do teste de impressora (e nao uma pesagem)? */
export function isPrinterTestOperationId(operationId: string | null | undefined): boolean {
  return operationId === PRINTER_TEST_OPERATION_ID;
}
