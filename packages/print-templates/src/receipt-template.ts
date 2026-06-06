export interface ReceiptTemplateInput {
  operationNumber: string;
  customerName: string;
  productDescription: string;
  plate: string;
  driverName: string;
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
    `Operacao: ${input.operationNumber}`,
    `Cliente: ${input.customerName}`,
    `Produto: ${input.productDescription}`,
    `Placa: ${input.plate}`,
    `Motorista: ${input.driverName}`,
    `Entrada: ${formatKg(input.entryWeightKg)}`,
    `Saida: ${formatKg(input.exitWeightKg)}`,
    `Liquido: ${formatKg(input.netWeightKg)}`,
    `Produto: ${formatMoney(input.productTotalCents)}`
  ];

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
