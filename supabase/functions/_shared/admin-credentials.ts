// O que o painel consegue MOSTRAR de cada cadastro, e o que nao consegue.
//
// O botao de olho do console abre isto. A parte que importa nao e a listagem: e
// de onde cada valor vem, porque sao tres origens diferentes:
//
//   - `companies` guarda app key, app secret, senha de precos e codigo de
//     ativacao em TEXTO, porque o desktop precisa receber esses valores de
//     volta. Aparecem direto.
//   - a senha do usuario vive no Supabase Auth como BCRYPT, que nao volta. Ela
//     so aparece quando foi capturada pelo painel no momento em que foi definida
//     e guardada no cofre cifrado (`user_password_vault` +
//     `credential-cipher.ts`). Senha antiga, ou trocada por fora do painel, nao
//     esta no cofre e continua irrecuperavel.
//   - o token do desktop e SHA-256 em `device_registrations.token_hash`. Esse
//     nao tem cofre: o valor em claro so existe na maquina ativada.
//
// Por isso `value: null` vem sempre acompanhado de `unavailable`: dizer "nao da
// para mostrar" sem dizer POR QUE e o que fazer no lugar faz o administrador
// procurar a senha em outro lugar por meia hora.
//
// Puro (sem Deno, sem Supabase): coberto por `admin-credentials_test.ts` no vitest.

export type CredentialKind = "secret" | "code" | "info";

export interface RevealedCredential {
  label: string;
  kind: CredentialKind;
  /** `null` quando nao ha valor recuperavel. */
  value: string | null;
  hint?: string;
  /** Preenchido quando `value` e null: o motivo e o caminho que resolve. */
  unavailable?: string;
}

export interface CredentialBundle {
  title: string;
  subtitle: string;
  credentials: RevealedCredential[];
}

/** Aviso de topo do modal: some quando nao ha nenhum segredo de verdade na lista. */
export function hasSensitiveValue(bundle: CredentialBundle): boolean {
  return bundle.credentials.some(
    (credential) => credential.kind !== "info" && credential.value !== null
  );
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

export interface CompanyCredentialSource {
  name?: string | null;
  legal_name?: string | null;
  document?: string | null;
  omie_app_key?: string | null;
  omie_app_secret?: string | null;
  price_change_password?: string | null;
  desktop_activation_code?: string | null;
  desktop_activation_code_rotated_at?: string | null;
}

export function buildCompanyCredentials(company: CompanyCredentialSource): CredentialBundle {
  const appKey = text(company.omie_app_key);
  const appSecret = text(company.omie_app_secret);
  const pricePassword = text(company.price_change_password);
  const activationCode = text(company.desktop_activation_code);

  return {
    title: text(company.name) || "Pedreira",
    subtitle: text(company.legal_name),
    credentials: [
      {
        label: "OMIE — App Key",
        kind: "secret",
        value: appKey || null,
        hint: "Autentica os desktops desta pedreira na API do OMIE.",
        unavailable: appKey ? undefined : "Nao configurado. Preencha em Editar > Integracao OMIE."
      },
      {
        label: "OMIE — App Secret",
        kind: "secret",
        value: appSecret || null,
        unavailable: appSecret
          ? undefined
          : "Nao configurado. Preencha em Editar > Integracao OMIE."
      },
      {
        label: "Senha para alterar precos",
        kind: "secret",
        value: pricePassword || null,
        hint: "Quatro digitos pedidos no desktop para alterar precos padrao.",
        unavailable: pricePassword ? undefined : "Nao definida. Configure em Editar."
      },
      {
        label: "Codigo de ativacao do desktop",
        kind: "code",
        value: activationCode || null,
        hint: "Vale so para a ativacao inicial de uma balanca.",
        unavailable: activationCode
          ? undefined
          : "Nenhum codigo gerado. Gere em Balancas > Codigos de ativacao."
      }
    ]
  };
}

export interface UserCredentialSource {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  is_active?: boolean | null;
}

/** O que o cofre de senhas tinha para este usuario no momento da consulta. */
export interface PasswordVaultState {
  /** Senha decifrada, quando o painel a capturou. */
  password: string | null;
  /** Quando essa senha foi definida pelo painel. */
  savedAt?: string | null;
  /** `false` quando `KYBERROCK_CREDENTIAL_KEY` nao esta configurada. */
  cipherConfigured: boolean;
}

/**
 * Usuario: e-mail sempre; senha, quando o cofre a tem.
 *
 * As tres saidas do campo Senha correspondem a tres situacoes distintas, e cada
 * uma pede uma acao diferente do administrador — juntar todas em "indisponivel"
 * era o que fazia ele procurar a senha onde ela nao existe.
 */
export function buildUserCredentials(
  user: UserCredentialSource,
  vault: PasswordVaultState = { password: null, cipherConfigured: false }
): CredentialBundle {
  const roleLabel = text(user.role) === "comercial" ? "Comercial" : "Carregador";
  const password = text(vault.password);
  const savedAt = text(vault.savedAt);

  return {
    title: text(user.name) || "Usuario",
    subtitle: `${roleLabel}${user.is_active === false ? " · acesso bloqueado" : ""}`,
    credentials: [
      {
        label: "E-mail de acesso",
        kind: "info",
        value: text(user.email) || null,
        unavailable: text(user.email) ? undefined : "Sem e-mail cadastrado."
      },
      {
        label: "Senha",
        kind: "secret",
        value: password || null,
        hint: password
          ? savedAt
            ? `Definida pelo painel em ${formatSavedAt(savedAt)}. Se alguem trocou a senha por fora do painel, este valor fica desatualizado.`
            : "Definida pelo painel."
          : undefined,
        unavailable: password
          ? undefined
          : vault.cipherConfigured
            ? "Esta senha foi definida antes do cofre existir, ou fora do painel. O Supabase Auth guarda so o hash (bcrypt), que nao volta — defina uma nova pelo botao Senha e ela passa a aparecer aqui."
            : "O cofre de senhas nao esta ligado. Defina o secret KYBERROCK_CREDENTIAL_KEY em Supabase > Edge Functions > Secrets; a partir dai, toda senha definida pelo painel fica visivel aqui."
      }
    ]
  };
}

/** "2026-08-12T13:00:00Z" -> "12/08/2026". Data solta e mais legivel que ISO na tela. */
function formatSavedAt(value: string): string {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return value;
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export interface DeviceCredentialSource {
  id?: string | null;
  name?: string | null;
  is_active?: boolean | null;
  last_seen_at?: string | null;
}

/**
 * Desktop: o token de dispositivo e guardado como SHA-256 e o valor em claro so
 * existe na maquina ativada. O que resolve na pratica e o codigo de ativacao da
 * pedreira, entao ele vem junto.
 */
export function buildDeviceCredentials(
  device: DeviceCredentialSource,
  company: CompanyCredentialSource
): CredentialBundle {
  const activationCode = text(company.desktop_activation_code);
  return {
    title: text(device.name) || "Balanca",
    subtitle: text(company.name),
    credentials: [
      {
        label: "ID do dispositivo",
        kind: "info",
        value: text(device.id) || null,
        hint: "Identificador usado nas chamadas do desktop e nos logs."
      },
      {
        label: "Token do dispositivo",
        kind: "secret",
        value: null,
        unavailable:
          "Guardado como hash (SHA-256). O token em claro so existe no desktop ativado. Para reconectar a balanca, gere um novo codigo de ativacao da pedreira e reative."
      },
      {
        label: "Codigo de ativacao da pedreira",
        kind: "code",
        value: activationCode || null,
        hint: "O mesmo codigo usado para ativar qualquer desktop desta pedreira.",
        unavailable: activationCode
          ? undefined
          : "Nenhum codigo gerado. Gere em Balancas > Codigos de ativacao."
      }
    ]
  };
}
