/**
 * Pedreira (unidade) e empresa de tudo que um desktop projeta na nuvem.
 *
 * A pedreira de uma operacao — e da solicitacao de carregamento dela — e a do
 * registro do dispositivo, nunca a que veio no payload. O desktop guarda a
 * unidade localmente na ativacao; se essa copia ficar velha (balanca ativada
 * numa pedreira e usada em outra, ou movida de pedreira pelo administrador), a
 * projecao caia numa unidade que nao e a da balanca e o carregador daquela
 * pedreira — que le a fila pela unidade do usuario dele — nunca via a operacao.
 * O desktop-pull ja trata o registro do dispositivo como fonte da verdade.
 */
export interface DeviceScope {
  company_id: string | null;
  unit_id: string | null;
}

export function scopeRowToDevice(
  row: Record<string, unknown>,
  device: DeviceScope
): Record<string, unknown> {
  return {
    ...row,
    ...(device.company_id ? { company_id: device.company_id } : {}),
    ...(device.unit_id ? { unit_id: device.unit_id } : {})
  };
}

export function scopeRowsToDevice(
  rows: readonly Record<string, unknown>[],
  device: DeviceScope
): Record<string, unknown>[] {
  return rows.map((row) => scopeRowToDevice(row, device));
}
