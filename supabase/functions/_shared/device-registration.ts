/**
 * Escolha do registro de dispositivo na ativacao de um desktop.
 *
 * Varios computadores operam ao mesmo tempo na mesma pedreira, cada um com seu
 * registro e seu token. Ativar um computador NAO pode tocar no registro de
 * outro: rotacionar o token alheio derruba a maquina que estava trabalhando
 * (ela passa a receber "token invalido" e aparece como bloqueada).
 */
export interface DeviceRegistrationCandidate {
  id: string;
  installation_id: string | null;
}

export interface SelectDeviceRegistrationInput<T extends DeviceRegistrationCandidate> {
  devices: readonly T[];
  /** Identificador estavel desta instalacao fisica, gerado pelo desktop. */
  installationId: string | null;
  /** Id de dispositivo que esta maquina ja usava (ativacao anterior), se houver. */
  previousDeviceId: string | null;
}

/**
 * Retorna o registro a reaproveitar, ou null quando a ativacao deve criar um
 * registro novo. Sao apenas dois casos de reaproveitamento:
 *
 * 1. mesma instalacao (installation_id bate) — reativacao normal;
 * 2. registro anterior ao multi-desktop (sem installation_id) que a propria
 *    maquina apresenta pelo id que ja usava.
 *
 * Registro ja vinculado a outra instalacao nunca e adotado.
 */
export function selectDeviceRegistration<T extends DeviceRegistrationCandidate>(
  input: SelectDeviceRegistrationInput<T>
): T | null {
  const installationId = input.installationId?.trim() || null;
  const previousDeviceId = input.previousDeviceId?.trim() || null;

  if (installationId) {
    const byInstallation = input.devices.find(
      (device) => device.installation_id === installationId
    );
    if (byInstallation) return byInstallation;
  }

  if (!previousDeviceId) return null;

  const byPreviousId = input.devices.find(
    (device) =>
      device.id === previousDeviceId &&
      (!device.installation_id || device.installation_id === installationId)
  );

  return byPreviousId ?? null;
}
