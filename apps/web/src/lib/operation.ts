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

/** Peso em kg, so o numero ("15.420"): o cabecalho da coluna ja diz que e peso (desktop). */
export function formatWeightNumber(kg: number | null | undefined): string {
  return (kg ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** "agora mesmo", "ha 12 min", "ha 2 h 05 min", "ha 1 d 3 h" — o mesmo texto do desktop. */
export function formatElapsedSince(
  iso: string | null | undefined,
  now: number = Date.now()
): string {
  if (!iso) return "-";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "-";
  const diffMs = now - then;
  const totalMinutes = Math.floor(diffMs / 60_000);
  if (diffMs < 0 || totalMinutes < 1) return "agora mesmo";
  if (totalMinutes < 60) return `ha ${totalMinutes} min`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return `ha ${totalHours} h ${String(minutes).padStart(2, "0")} min`;
  return `ha ${Math.floor(totalHours / 24)} d ${totalHours % 24} h`;
}

/** Quanto de cada produto esta no patio (os contadores acima da fila do desktop). */
export function countByProduct(
  operations: ReadonlyArray<{ product_description: string | null }>
): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const operation of operations) {
    const label = operation.product_description?.trim() || "Sem produto";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
}

export interface FiscalStatus {
  label: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "neutral";
}

/**
 * A coluna "Fiscal OMIE" das concluidas, com as mesmas regras e textos de
 * `getFiscalBillingStatus` do desktop (menos o botao de reenviar, que e da balanca).
 */
export function fiscalStatus(operation: {
  operation_type: string;
  omie_billing_status: string | null;
  omie_billing_message: string | null;
  omie_sales_order_id: number | null;
  omie_service_order_id: number | null;
  omie_invoice_number: string | null;
}): FiscalStatus {
  const message = operation.omie_billing_message?.trim() || null;
  const pending = (fallback: string) =>
    message ? `${message} — nova tentativa automatica em andamento.` : fallback;
  if (operation.omie_billing_status === "billed") {
    const document = operation.omie_invoice_number ? `NF ${operation.omie_invoice_number}` : null;
    return {
      label: "Faturada",
      detail: document ?? message ?? "Faturado no OMIE.",
      tone: "success"
    };
  }
  if (operation.operation_type !== "invoice") {
    if (operation.omie_service_order_id) {
      return {
        label: "OS enviada",
        detail: `Ordem de servico OMIE ${operation.omie_service_order_id} — fature na etapa "Faturar" do OMIE.`,
        tone: "success"
      };
    }
    if (operation.omie_billing_status === "cadastro_incompleto") {
      return {
        label: "Cadastro incompleto",
        detail:
          message ??
          "Falta o CNPJ/CPF do cliente para cadastra-lo no OMIE e enviar a ordem de servico.",
        tone: "warning"
      };
    }
    if (operation.omie_billing_status === "service_order_failed") {
      return {
        label: "OS falhou",
        detail: message ?? "O OMIE recusou a ordem de servico. Corrija o cadastro e reenvie.",
        tone: "danger"
      };
    }
    return {
      label: "Enviando OS",
      detail: pending("Ordem de servico sera enviada ao OMIE na proxima sincronizacao."),
      tone: "neutral"
    };
  }
  if (operation.omie_sales_order_id) {
    return {
      label: "Enviada ao OMIE",
      detail: `Pedido OMIE ${operation.omie_sales_order_id} — fature na coluna "Faturar" do OMIE.`,
      tone: "success"
    };
  }
  if (operation.omie_billing_status === "cadastro_incompleto") {
    return {
      label: "Cadastro incompleto",
      detail: message ?? "Falta Numero do Endereco e E-mail do cliente para emitir a NF-e.",
      tone: "warning"
    };
  }
  if (operation.omie_billing_status === "failed") {
    return {
      label: "Falhou",
      detail: message ?? "Envio do pedido nao confirmado.",
      tone: "danger"
    };
  }
  return {
    label: "Enviando ao OMIE",
    detail: pending("Pedido sera enviado ao OMIE na proxima sincronizacao."),
    tone: "neutral"
  };
}
