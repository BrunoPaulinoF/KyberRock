/**
 * Regras de TELA da pesagem pelo site. Quem registra, calcula e imprime e a balanca executora
 * (o site pede — `operation_requests`, ver `docs/web-api.md`). O que vive aqui e so o que a
 * tela precisa decidir sozinha: previa do fechamento, o que mudou numa alteracao, textos.
 */

/** Status da pesagem aberta na nuvem: a balanca projeta todas as fases em andamento como `open`. */
export const OPEN_STATUS = "open";

export type RequestKind = "entry" | "exit" | "update" | "cancel" | "reprint";
export type RequestStatus = "pending" | "processing" | "done" | "failed";

/** Linha de `operation_requests` (migracao `202609250001`), como o site le. */
export interface OperationRequest {
  id: string;
  kind: RequestKind;
  operation_id: string;
  status: RequestStatus;
  requested_by_name: string | null;
  requested_at: string;
  processed_at: string | null;
  result_message: string | null;
  result: Record<string, unknown> | null;
  print_status: "printed" | "failed" | "skipped" | null;
  print_message: string | null;
}

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  entry: "Entrada",
  exit: "Fechamento",
  update: "Alteracao",
  cancel: "Cancelamento",
  reprint: "Reimpressao"
};

/** O texto que muda sozinho enquanto a balanca trabalha. */
export function requestStatusText(request: Pick<OperationRequest, "status">): string {
  switch (request.status) {
    case "pending":
      return "Enviando para a balanca...";
    case "processing":
      return "Balanca registrando...";
    case "done":
      return "Pronto";
    case "failed":
      return "Nao registrado";
  }
}

/** Aviso do cupom: so aparece quando ele nao saiu. */
export function printWarning(
  request: Pick<OperationRequest, "print_status" | "print_message">
): string | null {
  if (request.print_status !== "failed") return null;
  const detail = request.print_message?.trim();
  return `Pesagem registrada, mas o cupom nao imprimiu${detail ? `: ${detail}` : "."}`;
}

export function isFinished(request: Pick<OperationRequest, "status">): boolean {
  return request.status === "done" || request.status === "failed";
}

/** Peso digitado ("42.380", "42380", "42 380") em kg inteiro, ou `null`. */
export function parseWeight(text: string): number | null {
  const cleaned = text
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  const kg = Math.round(value);
  return kg > 0 ? kg : null;
}

export interface CloseEstimate {
  netKg: number;
  productTotalCents: number | null;
}

/**
 * Previa do fechamento: liquido e valor do produto. E ESTIMATIVA — frete, credito e
 * adiantamento a balanca calcula no fechamento de verdade, e o numero final volta no resultado.
 */
export function estimateClose(
  entryKg: number | null,
  exitKg: number | null,
  unitPriceCents: number | null
): CloseEstimate | null {
  if (!entryKg || !exitKg) return null;
  const netKg = Math.abs(exitKg - entryKg);
  return {
    netKg,
    productTotalCents: unitPriceCents === null ? null : Math.round((netKg / 1000) * unitPriceCents)
  };
}

/** Minutos desde a entrada do caminhao. */
export function minutesSince(iso: string, now: number = Date.now()): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.floor((now - at) / 60_000));
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Campos que uma alteracao pode mandar (os nomes do pedido, nao das colunas). */
export interface EditableFields {
  customerId: string;
  productId: string;
  vehicleId: string;
  driverId: string;
  carrierId: string;
  paymentMethodId: string;
  paymentTermId: string;
  operationType: string;
  unitPriceCents: number | null;
}

/** Na pesagem concluida so estes mudam (os "Alterar" da lista de concluidas do desktop). */
export const CLOSED_EDITABLE: ReadonlyArray<keyof EditableFields> = [
  "customerId",
  "productId",
  "carrierId"
];

/**
 * So o que MUDOU vai no pedido: mandar tudo faria a balanca regravar campos que ninguem tocou
 * (e o preco, que pede senha, pediria senha sem ter mudado). Vazio em transportadora, forma e
 * condicao significa "tirar" (`null`).
 */
export function changedFields(
  original: EditableFields,
  edited: EditableFields,
  allowed?: ReadonlyArray<keyof EditableFields>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = (allowed ?? (Object.keys(edited) as Array<keyof EditableFields>)).filter(
    (key) => edited[key] !== original[key]
  );
  for (const key of keys) {
    const value = edited[key];
    if (key === "unitPriceCents") {
      if (typeof value === "number" && value > 0) out[key] = value;
      continue;
    }
    if (key === "carrierId" || key === "paymentMethodId" || key === "paymentTermId") {
      out[key] = value ? value : null;
      continue;
    }
    if (value) out[key] = value;
  }
  return out;
}

/** "R$ 65,00" digitado -> 6500 centavos; vazio ou invalido -> null. */
export function parsePriceCents(text: string): number | null {
  const cleaned = text.trim().replace(/\s|R\$/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/** Busca sem acento e sem caixa, por qualquer pedaco do texto (e placa sem traco). */
export function matchesSearch(text: string, search: string): boolean {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[\s.\-/]/g, "");
  const needle = normalize(search);
  return needle.length === 0 || normalize(text).includes(needle);
}
