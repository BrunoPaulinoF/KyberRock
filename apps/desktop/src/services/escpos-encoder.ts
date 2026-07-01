export interface EscPosLine {
  text: string;
  bold?: boolean;
  align?: "left" | "center" | "right";
}

const ESC = 0x1b;
const GS = 0x1d;

export function encodeEscPos(lines: string[], paperWidthMm: number): Buffer {
  const buffers: Buffer[] = [];
  const maxChars = paperWidthMm <= 58 ? 32 : 48;

  buffers.push(Buffer.from([ESC, 0x40]));

  for (const line of lines) {
    const trimmed = line.replace(/\s+$/, "");
    if (isDivider(trimmed)) {
      buffers.push(Buffer.from([ESC, 0x45, 0x00]));
      buffers.push(Buffer.from("-".repeat(maxChars) + "\n", "ascii"));
      continue;
    }

    if (isCenterCandidate(trimmed)) {
      buffers.push(Buffer.from([ESC, 0x61, 0x01]));
      buffers.push(Buffer.from(trimmed.slice(0, maxChars) + "\n", "ascii"));
      buffers.push(Buffer.from([ESC, 0x61, 0x00]));
      continue;
    }

    buffers.push(Buffer.from([ESC, 0x61, 0x00]));
    buffers.push(Buffer.from(trimmed.slice(0, maxChars) + "\n", "ascii"));
  }

  buffers.push(Buffer.from([ESC, 0x64, 0x03]));
  buffers.push(Buffer.from([GS, 0x56, 0x00]));

  return Buffer.concat(buffers);
}

function isDivider(line: string): boolean {
  return line.length > 10 && /^[=-]+$/.test(line);
}

function isCenterCandidate(line: string): boolean {
  if (line.length === 0) return false;
  const upper = line.toUpperCase();
  return (
    upper.includes("AGRADECEMOS") ||
    upper.includes("CUPOM DE TESTE") ||
    (line.length < 32 && /^[A-Z0-9 ./-]+$/.test(line) && !line.includes(":"))
  );
}
