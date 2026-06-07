export interface ReceiptTemplateInput {
  unitName: string;
  receiptNumber: number;
  copyNumber: number;
  printedAt: string;
  operationId: string;
  operationType: "invoice" | "internal";
  customerName: string;
  productDescription: string;
  plate: string;
  driverName: string;
  paymentTermName: string | null;
  entryWeightKg: number;
  exitWeightKg: number;
  netWeightKg: number;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
}

export function buildReceiptLines(input: ReceiptTemplateInput): string[] {
  const lines = [
    "KYBERROCK",
    input.unitName,
    `Cupom: ${input.receiptNumber}`,
    `Via: ${input.copyNumber}`,
    `Emitido: ${formatDateTime(input.printedAt)}`,
    `Operacao: ${input.operationId}`,
    `Tipo: ${input.operationType === "invoice" ? "Com nota" : "Interna"}`,
    `Cliente: ${input.customerName}`,
    `Produto: ${input.productDescription}`,
    `Placa: ${input.plate}`,
    `Motorista: ${input.driverName}`,
    `Condicao: ${input.paymentTermName ?? "nao informada"}`,
    `Entrada: ${formatKg(input.entryWeightKg)}`,
    `Saida: ${formatKg(input.exitWeightKg)}`,
    `Liquido: ${formatKg(input.netWeightKg)}`,
    `Produto: ${formatMoney(input.productTotalCents)}`
  ];

  if (input.copyNumber > 1) {
    lines.splice(2, 0, "SEGUNDA VIA");
  }

  if (input.freightTotalCents > 0) {
    lines.push(`Frete: ${formatMoney(input.freightTotalCents)}`);
  }

  lines.push(
    `Total: ${formatMoney(input.totalCents)}`,
    "",
    "Assinatura:",
    "____________________________"
  );

  return lines;
}

function formatKg(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`;
}

function formatMoney(valueCents: number): string {
  return (valueCents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}
