// Segredos do financeiro: valor SEMPRE do secret do Supabase, nome fixo no codigo.
//
// Regra da casa: nenhuma credencial de plataforma entra no banco, no
// repositorio ou no navegador. O nome de cada variavel e constante aqui e o
// valor e lido pela Edge Function com `Deno.env.get()`. A tela do painel so
// EXIBE a situacao — nao ha campo para digitar nem nome nem valor, porque
// qualquer campo editavel seria um lugar a mais onde um token pode acabar
// gravado por engano.
//
// Trocar uma credencial e trocar o secret no Supabase: sem deploy, sem SQL.
//
// Puro de proposito: o leitor de ambiente e injetado, entao
// `billing-secrets_test.ts` exercita tudo no vitest sem depender do Deno.

export type BillingSecretKey =
  | "mercadoPagoAccessToken"
  | "mercadoPagoWebhookSecret"
  | "whatsappInstanceToken";

export interface BillingSecretDefinition {
  key: BillingSecretKey;
  /** Nome do secret do Supabase. Fixo: a tela nao edita. */
  envVar: string;
  label: string;
  /** Para que serve — exibido na tela ao lado do nome. */
  purpose: string;
  /** O que para de funcionar sem ele. */
  missingHint: string;
  /** `false` quando a ausencia degrada mas nao impede a cobranca. */
  required: boolean;
}

export const BILLING_SECRETS: BillingSecretDefinition[] = [
  {
    key: "mercadoPagoAccessToken",
    envVar: "MERCADO_PAGO_ACCESS_TOKEN",
    label: "Access token do Mercado Pago",
    purpose: "Conta que emite os boletos.",
    missingHint: "Sem ele nenhum boleto e emitido.",
    required: true
  },
  {
    key: "mercadoPagoWebhookSecret",
    envVar: "MERCADO_PAGO_WEBHOOK_SECRET",
    label: "Segredo da assinatura do webhook",
    purpose: "Confere a assinatura das notificacoes de pagamento.",
    missingHint:
      "Opcional: sem ele a baixa continua sendo confirmada por consulta a API do Mercado Pago.",
    required: false
  },
  {
    key: "whatsappInstanceToken",
    envVar: "UAZAPI_INSTANCE_TOKEN",
    label: "Token da instancia de WhatsApp",
    purpose: "Instancia UAZAPI que envia fatura e boleto.",
    missingHint: "Sem ele a fatura e gerada mas nao enviada.",
    required: true
  }
];

/** Le uma variavel de ambiente. Injetavel para o teste rodar sem Deno. */
export type EnvReader = (name: string) => string | undefined;

export interface ResolvedBillingSecret {
  key: BillingSecretKey;
  label: string;
  purpose: string;
  missingHint: string;
  required: boolean;
  /** Variavel de onde o valor e lido. */
  envVar: string;
  /** O secret existe e nao esta vazio. */
  configured: boolean;
  /** Quatro ultimos caracteres — o bastante para reconhecer qual credencial esta ativa. */
  preview: string;
}

/** Mascara de exibicao. O valor inteiro nunca sai da Edge Function. */
export function maskSecretValue(value: string): string {
  return value.length >= 4 ? `••••${value.slice(-4)}` : "";
}

export function resolveBillingSecret(input: {
  definition: BillingSecretDefinition;
  readEnv: EnvReader;
}): ResolvedBillingSecret & { value: string } {
  const value = (input.readEnv(input.definition.envVar) ?? "").trim();
  return {
    key: input.definition.key,
    label: input.definition.label,
    purpose: input.definition.purpose,
    missingHint: input.definition.missingHint,
    required: input.definition.required,
    envVar: input.definition.envVar,
    configured: value.length > 0,
    preview: maskSecretValue(value),
    value
  };
}

/**
 * Resolve os tres segredos. Devolve os valores (para o motor usar) separados do
 * resumo (para a tela ver) — assim o caminho que chega ao navegador nunca
 * carrega o valor por acidente.
 */
export function resolveAllBillingSecrets(input: { readEnv: EnvReader }): {
  values: Record<BillingSecretKey, string>;
  status: ResolvedBillingSecret[];
} {
  const values = {} as Record<BillingSecretKey, string>;
  const status: ResolvedBillingSecret[] = [];

  for (const definition of BILLING_SECRETS) {
    const { value, ...visible } = resolveBillingSecret({ definition, readEnv: input.readEnv });
    values[definition.key] = value;
    status.push(visible);
  }

  return { values, status };
}
