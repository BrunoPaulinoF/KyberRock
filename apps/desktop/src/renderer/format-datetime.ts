// SQLite datetime('now') grava UTC sem indicador de fuso ("2026-07-07 17:00:48").
// new Date() interpreta esse formato como horario LOCAL, exibindo o horario errado
// (ex.: 17:00 em vez de 14:00 em America/Sao_Paulo). Aqui, timestamps sem fuso sao
// tratados como UTC; strings ISO com Z/offset seguem o parse normal.
const NO_TIMEZONE_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export function parseDbTimestamp(value: string): Date {
  const trimmed = value.trim();
  if (NO_TIMEZONE_PATTERN.test(trimmed)) {
    return new Date(`${trimmed.replace(" ", "T")}Z`);
  }
  return new Date(trimmed);
}

export function formatDbDateTime(value: string): string {
  const parsed = parseDbTimestamp(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}
