/**
 * Cadastro "SEM CLIENTE": a opcao para passar caminhao na balanca sem vincular cliente
 * nenhum (transporte interno, caminhao da propria pedreira, pesagem so de conferencia).
 *
 * A pesagem continua igual por fora — placa, motorista, produto, entrada e saida —, mas
 * nao e venda: sai sem preco (R$ 0,00), nao mexe em credito e NAO vai ao OMIE (nem o
 * pedido, nem o cadastro). Quem decide e o cadastro escolhido, nunca a tela.
 *
 * O cadastro ja nasce pronto em cada pedreira, na NUVEM (migracao
 * `202610300001_cadastro_sem_cliente`), com o nome "SEM CLIENTE": as balancas o recebem pelo
 * pull de cadastro como qualquer cliente, sem ninguem precisar criar. O id e
 * `sem-cliente-<company_id>`, e e ele — nunca o nome — que o identifica: o operador pode
 * renomear o cadastro, e um cliente de verdade chamado "Sem cliente" nao pode virar pesagem
 * sem OMIE.
 */

export const NO_CUSTOMER_ID_PREFIX = "sem-cliente-";

/**
 * `omie_billing_status` da pesagem fechada com o cadastro SEM CLIENTE: nao ha pedido a
 * enviar, e e esse valor que tira a pesagem da lista de "nao chegou ao OMIE" na balanca e
 * no site — o site le a coluna da nuvem e nao precisa conhecer o id.
 */
export const NO_CUSTOMER_BILLING_STATUS = "no_customer";

export const NO_CUSTOMER_BILLING_MESSAGE = "Pesagem SEM CLIENTE: nao vai ao OMIE (nao e venda).";

export function noCustomerIdFor(companyId: string): string {
  const normalized = companyId.trim();
  if (!normalized) {
    throw new Error("Empresa nao identificada para criar o cadastro SEM CLIENTE.");
  }
  return `${NO_CUSTOMER_ID_PREFIX}${normalized}`;
}

export function isNoCustomerId(customerId: string | null | undefined): boolean {
  return typeof customerId === "string" && customerId.startsWith(NO_CUSTOMER_ID_PREFIX);
}

/**
 * Produto "EXPLOSIVO": registro do explosivo usado na detonacao, pedido da Pedreira Ibiuna
 * em 28/10/2026 ("pesar os caminhoes de explosivos e tirar um ticket com o peso para
 * arquivar com a documentacao quando houver explosao — sem valor, so para registrar o que
 * usou").
 *
 * Nao e produto do OMIE, nem de venda: e um cadastro proprio do KyberRock que, como o SEM
 * CLIENTE, ja nasce na NUVEM (migracao `202611060001_produto_explosivo`, uma linha por
 * empresa) e chega as balancas pelo pull de cadastro. O id e `explosivo-<company_id>` e e
 * ele — nunca o nome — que o identifica.
 *
 * So vale com o cliente SEM CLIENTE: com ele a pesagem sai a R$ 0,00 e nao vai ao OMIE. Com
 * um cliente de verdade nao ha preco a cobrar nem codigo do OMIE para o pedido, entao a
 * balanca recusa a combinacao (na abertura, na troca de produto e na troca de cliente).
 */
export const NO_CUSTOMER_EXPLOSIVE_PRODUCT_ID_PREFIX = "explosivo-";

export const NO_CUSTOMER_ONLY_PRODUCT_MESSAGE =
  "O produto EXPLOSIVO e so para registro: use com o cliente SEM CLIENTE (sai sem valor e nao vai ao OMIE).";

export function noCustomerExplosiveProductIdFor(companyId: string): string {
  const normalized = companyId.trim();
  if (!normalized) {
    throw new Error("Empresa nao identificada para o produto EXPLOSIVO.");
  }
  return `${NO_CUSTOMER_EXPLOSIVE_PRODUCT_ID_PREFIX}${normalized}`;
}

/** Produto que so pode ser pesado com o cliente SEM CLIENTE (hoje, o EXPLOSIVO). */
export function isNoCustomerOnlyProductId(productId: string | null | undefined): boolean {
  return (
    typeof productId === "string" && productId.startsWith(NO_CUSTOMER_EXPLOSIVE_PRODUCT_ID_PREFIX)
  );
}

/** Recusa produto de registro (EXPLOSIVO) com cliente de verdade. */
export function assertProductAllowedForCustomer(
  productId: string | null | undefined,
  customerId: string | null | undefined
): void {
  if (isNoCustomerOnlyProductId(productId) && !isNoCustomerId(customerId)) {
    throw new Error(NO_CUSTOMER_ONLY_PRODUCT_MESSAGE);
  }
}

/**
 * Peso liquido da pesagem, ou `null` quando os dois pesos nao formam uma pesagem valida.
 *
 * Venda: o caminhao entra vazio e sai carregado, entao a saida tem de pesar MAIS que a
 * entrada. SEM CLIENTE tambem aceita o contrario — o caminhao de explosivo chega cheio,
 * descarrega na pedreira e sai vazio —, e ai vale a diferenca entre os dois. Nao ha valor
 * nem pedido nessa pesagem, entao a direcao nao muda nada alem do ticket.
 */
export function weighingNetWeightKg(
  entryWeightKg: number,
  exitWeightKg: number,
  customerId: string | null | undefined
): number | null {
  const difference = exitWeightKg - entryWeightKg;
  if (difference > 0) return difference;
  if (difference < 0 && isNoCustomerId(customerId)) return -difference;
  return null;
}
