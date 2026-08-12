// Segredos do financeiro: a tela guarda o NOME da variavel, o valor mora no
// secret do Supabase.
//
// Regra da casa: nenhuma credencial de plataforma entra no banco, no
// repositorio ou no navegador. `billing_settings` guarda so o nome da variavel
// de ambiente; quem le o valor e a Edge Function, com `Deno.env.get()`. Trocar
// a credencial vira "trocar o secret no Supabase" — sem deploy, sem SQL e sem
// nenhum ponto onde o token possa vazar por descuido.
//
// Puro de proposito: o leitor de ambiente e injetado, entao `billing-secrets_test.ts`
// exercita tudo no vitest sem depender do Deno.

export type BillingSecretKey =
  | "mercadoPagoAccessToken"
  | "mercadoPagoWebhookSecret"
  | "whatsappInstanceToken";

export interface BillingSecretDefinition {
  key: BillingSecretKey;
  /** Coluna de `billing_settings` com o nome da variavel escolhido. */
  column: string;
  /** Nome usado quando a tela nao escolheu outro. */
  defaultEnvVar: string;
  label: string;
  /** O que para de funcionar sem ele — texto exibido na tela. */
  missingHint: string;
}

export const BILLING_SECRETS: BillingSecretDefinition[] = [
  {
    key: "mercadoPagoAccessToken",
    column: "mercado_pago_access_token_env",
    defaultEnvVar: "MERCADO_PAGO_ACCESS_TOKEN",
    label: "Access token do Mercado Pago",
    missingHint: "Sem ele nenhum boleto e emitido."
  },
  {
    key: "mercadoPagoWebhookSecret",
    column: "mercado_pago_webhook_secret_env",
    defaultEnvVar: "MERCADO_PAGO_WEBHOOK_SECRET",
    label: "Segredo da assinatura do webhook",
    missingHint:
      "Opcional: sem ele a baixa do pagamento continua sendo confirmada consultando a API do Mercado Pago."
  },
  {
    key: "whatsappInstanceToken",
    column: "whatsapp_instance_token_env",
    defaultEnvVar: "UAZAPI_INSTANCE_TOKEN",
    label: "Token da instancia de WhatsApp",
    missingHint: "Sem ele a fatura e gerada mas nao enviada."
  }
];

/** Le uma variavel de ambiente. Injetavel para o teste rodar sem Deno. */
export type EnvReader = (name: string) => string | undefined;

/** Convencao POSIX de nome de variavel: maiuscula, digito e sublinhado. */
const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export function isValidEnvVarName(name: string): boolean {
  return name.length > 0 && name.length <= 64 && ENV_VAR_NAME_PATTERN.test(name);
}

/**
 * Recusa o que foi digitado no campo de NOME da variavel, com o motivo. O caso
 * que mais importa e o operador colar o proprio token no campo: `APP_USR-...`
 * tem hifen e minuscula, entao a validacao pega — mas a mensagem generica
 * ("nome invalido") faria a pessoa tentar de novo em vez de entender que ali vai
 * o nome, e que o valor vai no painel do Supabase.
 */
export function describeEnvVarNameError(name: string): string | null {
  const value = name.trim();
  if (value.length === 0) return null;
  if (isValidEnvVarName(value)) return null;
  if (looksLikeSecretValue(value)) {
    return "Aqui vai o NOME da variavel (ex.: MERCADO_PAGO_ACCESS_TOKEN), nao o valor. Grave o valor em Supabase > Edge Functions > Secrets.";
  }
  return "Nome de variavel invalido. Use apenas letras maiusculas, numeros e sublinhado (ex.: MERCADO_PAGO_ACCESS_TOKEN).";
}

/** Heuristica de "isso e um token, nao um nome de variavel". */
export function looksLikeSecretValue(value: string): boolean {
  return /[a-z]/.test(value) || value.includes("-") || value.length > 64;
}

export function resolveEnvVarName(
  configuredName: string | null | undefined,
  defaultEnvVar: string
): string {
  const name = (configuredName ?? "").trim();
  return isValidEnvVarName(name) ? name : defaultEnvVar;
}

export interface ResolvedBillingSecret {
  key: BillingSecretKey;
  label: string;
  missingHint: string;
  /** Variavel de onde o valor foi lido. */
  envVar: string;
  /** A tela escolheu esse nome (`true`) ou caiu no padrao (`false`). */
  isCustomEnvVar: boolean;
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
  configuredName: string | null | undefined;
  readEnv: EnvReader;
}): ResolvedBillingSecret & { value: string } {
  const envVar = resolveEnvVarName(input.configuredName, input.definition.defaultEnvVar);
  const value = (input.readEnv(envVar) ?? "").trim();
  return {
    key: input.definition.key,
    label: input.definition.label,
    missingHint: input.definition.missingHint,
    envVar,
    isCustomEnvVar: envVar !== input.definition.defaultEnvVar,
    configured: value.length > 0,
    preview: maskSecretValue(value),
    value
  };
}

/**
 * Resolve os tres segredos de uma vez a partir da linha de `billing_settings`.
 * Devolve os valores (para o motor usar) separados do resumo (para a tela ver) —
 * assim o caminho que chega ao navegador nunca carrega o valor por acidente.
 */
export function resolveAllBillingSecrets(input: {
  settingsRow: Record<string, unknown>;
  readEnv: EnvReader;
}): {
  values: Record<BillingSecretKey, string>;
  status: ResolvedBillingSecret[];
} {
  const values = {} as Record<BillingSecretKey, string>;
  const status: ResolvedBillingSecret[] = [];

  for (const definition of BILLING_SECRETS) {
    const configuredName = input.settingsRow[definition.column];
    const resolved = resolveBillingSecret({
      definition,
      configuredName: typeof configuredName === "string" ? configuredName : null,
      readEnv: input.readEnv
    });
    const { value, ...visible } = resolved;
    values[definition.key] = value;
    status.push(visible);
  }

  return { values, status };
}
