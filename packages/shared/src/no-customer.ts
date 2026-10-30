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
