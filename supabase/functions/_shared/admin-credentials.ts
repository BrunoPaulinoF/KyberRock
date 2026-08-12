// O que o painel consegue MOSTRAR de cada cadastro, e o que nao consegue.
//
// O botao de olho do console abre isto. A parte que importa nao e a listagem: e
// a separacao entre credencial guardada em texto (da para mostrar) e credencial
// guardada como HASH (nao da, e nenhuma tela vai dar). Sao duas situacoes:
//
//   - `companies` guarda app key, app secret, senha de precos e codigo de
//     ativacao em texto, porque o desktop precisa receber esses valores de
//     volta. O administrador pode ve-los.
//   - a senha do usuario vive no Supabase Auth (bcrypt) e o token do desktop em
//     `device_registrations.token_hash` (SHA-256). Nao ha caminho de volta —
//     nem pelo painel, nem pelo suporte, nem pelo banco.
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

/**
 * Usuario: o e-mail e o que da para mostrar. A senha NAO — o Supabase Auth
 * guarda bcrypt, e bcrypt nao volta. Quem precisa da senha define uma nova.
 */
export function buildUserCredentials(user: UserCredentialSource): CredentialBundle {
  const roleLabel = text(user.role) === "comercial" ? "Comercial" : "Carregador";
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
        value: null,
        unavailable:
          "O Supabase Auth guarda apenas o hash da senha (bcrypt). Nem o painel nem o suporte conseguem recupera-la — use o botao Senha para definir uma nova e repassar ao usuario."
      }
    ]
  };
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
