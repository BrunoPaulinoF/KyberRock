/**
 * Escolha da pedreira (unidade) na ativacao de um desktop.
 *
 * O codigo de ativacao e da EMPRESA, nao da pedreira. Enquanto a ativacao
 * pegava sempre a unidade mais antiga da empresa, toda balanca de uma empresa
 * com mais de uma pedreira caia na mesma unidade — a entrada registrada na
 * pedreira B era projetada na unidade A e o carregador da pedreira B, cujo
 * usuario aponta para a unidade B, nunca via a operacao na fila.
 */
export interface ActivationUnitCandidate {
  id: string;
}

export interface ResolveActivationUnitInput<T extends ActivationUnitCandidate> {
  /** Unidades ativas da empresa, da mais antiga para a mais nova. */
  units: readonly T[];
  /** Unidade escolhida pelo operador na tela de ativacao, quando houver. */
  requestedUnitId: string | null;
  /** Unidade do registro que esta maquina ja usava (reativacao), quando houver. */
  currentDeviceUnitId: string | null;
}

export type ResolveActivationUnitResult<T extends ActivationUnitCandidate> =
  | { kind: "resolved"; unit: T }
  /** A empresa nao tem nenhuma unidade ativa. */
  | { kind: "no_units" }
  /** A unidade pedida nao existe (ou nao e da empresa / esta inativa). */
  | { kind: "unit_not_found" }
  /** Varias pedreiras e nenhuma pista de qual e esta: o operador precisa escolher. */
  | { kind: "selection_required"; units: readonly T[] };

export function resolveActivationUnit<T extends ActivationUnitCandidate>(
  input: ResolveActivationUnitInput<T>
): ResolveActivationUnitResult<T> {
  const units = input.units;
  if (units.length === 0) return { kind: "no_units" };

  const requestedUnitId = input.requestedUnitId?.trim() || null;
  if (requestedUnitId) {
    const requested = units.find((unit) => unit.id === requestedUnitId);
    return requested ? { kind: "resolved", unit: requested } : { kind: "unit_not_found" };
  }

  // Reativacao: a pedreira ja escolhida para esta maquina manda. Sem isto, um
  // desktop corretamente vinculado a segunda pedreira voltava para a primeira a
  // cada reativacao, e a fila do carregador dele esvaziava de novo.
  const currentDeviceUnitId = input.currentDeviceUnitId?.trim() || null;
  if (currentDeviceUnitId) {
    const current = units.find((unit) => unit.id === currentDeviceUnitId);
    if (current) return { kind: "resolved", unit: current };
  }

  if (units.length === 1) return { kind: "resolved", unit: units[0] };

  return { kind: "selection_required", units };
}
