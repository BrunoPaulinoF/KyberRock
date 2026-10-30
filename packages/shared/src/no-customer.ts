/**
 * Cadastro "SEM CLIENTE": a opcao para passar caminhao na balanca sem vincular cliente
 * nenhum (transporte interno, caminhao da propria pedreira, pesagem so de conferencia).
 *
 * A pesagem continua igual por fora — placa, motorista, produto, entrada e saida —, mas
 * nao e venda: sai sem preco (R$ 0,00), nao mexe em credito e NAO vai ao OMIE (nem o
 * pedido, nem o cadastro). Quem decide e o cadastro escolhido, nunca a tela.
 *
 * O id e o mesmo em todas as balancas da empresa, derivado do `company_id`: cada maquina
 * que criar o cadastro grava a MESMA linha, e a nuvem casa por id — sem gemeo para
 * unificar depois. E e o id, e nao o nome, que o identifica: o operador pode renomear o
 * cadastro, e um cliente de verdade chamado "Sem cliente" nao pode virar pesagem sem OMIE.
 */

export const NO_CUSTOMER_ID_PREFIX = "sem-cliente-";

/** Nome com que o cadastro nasce (razao social e nome fantasia). */
export const NO_CUSTOMER_NAME = "SEM CLIENTE";

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
