/**
 * Troca de pedreira (unidade) de um desktop ja registrado.
 *
 * `device_number` e o numero do computador DENTRO da unidade — o sufixo do cupom
 * que impede duas balancas da mesma pedreira de imprimirem o mesmo numero. Ele e
 * protegido pelo indice unico parcial `idx_device_registrations_unit_number`
 * sobre `(unit_id, device_number)`.
 *
 * Levar o numero antigo junto na mudanca de pedreira estoura esse indice sempre
 * que a pedreira destino ja tem um computador com o mesmo numero:
 *
 *   duplicate key value violates unique constraint
 *   "idx_device_registrations_unit_number"
 *
 * Como o indice ignora nulos, a mesma escrita que muda `unit_id` zera
 * `device_number` e a troca nunca colide. Quem renumera em seguida e a RPC
 * `assign_device_number`, que pega o menor numero livre da unidade destino sob
 * lock por unidade. Se ela falhar, o desktop fica sem numero apenas na nuvem: a
 * proxima validacao de acesso (`desktop-status`) atribui o numero e o desktop
 * continua imprimindo com o numero que ja tem em cache ate la.
 */
export interface DeviceUnitAssignment {
  unit_id: string;
  /** Presente (nulo) so quando a pedreira muda: renumerar na unidade destino. */
  device_number?: null;
}

/**
 * Campos de `device_registrations` a gravar para colocar o desktop na unidade
 * `targetUnitId`. Mantendo a mesma pedreira, o numero atual e preservado.
 */
export function deviceUnitAssignment(
  currentUnitId: string | null | undefined,
  targetUnitId: string
): DeviceUnitAssignment {
  if (currentUnitId && currentUnitId === targetUnitId) {
    return { unit_id: targetUnitId };
  }
  return { unit_id: targetUnitId, device_number: null };
}
