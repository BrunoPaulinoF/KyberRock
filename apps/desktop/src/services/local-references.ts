import type { DesktopDatabase } from "../database/sqlite.js";

/**
 * Tabelas da identidade local que a auditoria referencia.
 *
 * Lista fechada de proposito: o nome vai para dentro de um SQL, e nenhum valor
 * daqui pode vir de fora do modulo.
 */
export type LocalReferenceTable = "companies" | "units" | "devices";

/**
 * Devolve o id se a linha existir; `null` se nao existir.
 *
 * Existe por um motivo que custou uma pedreira parada: a auditoria grava
 * `company_id`, `unit_id` e `device_id` vindos da identidade em
 * `local_settings`, e essas tres colunas sao FKs. Quando uma das linhas some, a
 * auditoria — que e o REGISTRO de que algo aconteceu — passa a DERRUBAR o que
 * aconteceu:
 *
 * - fechar operacao estoura `FOREIGN KEY constraint failed` e a saida nao fecha,
 *   com o caminhao carregado em cima da balanca;
 * - imprimir cupom estoura na mesma transacao: o papel sai (a impressao vem
 *   antes) e a via nao fica registrada, entao o operador imprime de novo.
 *
 * Isso inverte a prioridade do sistema. A operacao e o que nao pode parar; a
 * trilha de auditoria acompanha. As tres colunas de `audit_logs` ja sao
 * ANULAVEIS e o proprio codigo ja gravava `null` quando nao havia identidade
 * nenhuma — ou seja, "sem atribuicao" sempre foi um estado previsto. Gravar
 * `null` para um id cuja linha sumiu registra o mesmo que ele registraria: a
 * acao, a entidade e a hora, sem a atribuicao que o banco nao consegue provar.
 *
 * Nao serve para FK obrigatoria (`weighing_operations.company_id` e NOT NULL):
 * la o dado faz parte da operacao, e trocar por nulo seria perder a operacao,
 * nao salva-la.
 */
export function existingLocalReference(
  database: DesktopDatabase,
  table: LocalReferenceTable,
  id: string | null | undefined
): string | null {
  if (!id) return null;

  try {
    const row = database.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id) as
      | { id: string }
      | undefined;
    return row ? row.id : null;
  } catch {
    // Tabela ausente (banco a meio caminho de uma migracao) tem o mesmo
    // significado pratico da linha ausente: nao da para provar a atribuicao.
    return null;
  }
}
