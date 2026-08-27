import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "../contexts/AuthContext";
import { AdminSessionExpiredError, callAdminFunction } from "../lib/admin-api";
import { supabaseConfig } from "../config/supabase-config";
import { DEVICE_NAME_MAX_LENGTH, parseDeviceName } from "../lib/device-name";
import { matchesSearch, rankBySearch } from "../lib/search-ranking";
import { AiAssistantSettings } from "./AiAssistantSettings";
import { DesktopUpdates } from "./DesktopUpdates";
import { FinancialBackoffice } from "./FinancialBackoffice";
import {
  AdminShell,
  Badge,
  Button,
  ButtonGroup,
  ConfirmDialog,
  CopyButton,
  DataTable,
  EyeButton,
  Field,
  Fieldset,
  Modal,
  Note,
  PageHead,
  Panel
} from "../components/admin";
import type { Column, NavSection } from "../components/admin";

/**
 * Console administrativo da plataforma.
 *
 * Organizado como console tecnico: uma secao por entidade, cada uma com a sua
 * tabela densa e as acoes na propria linha. O formato anterior — listas em
 * cartao lado a lado com o formulario de criacao — gastava varias vezes mais
 * altura por registro, e com dezenas de pedreiras achar uma exigia rolar a
 * pagina inteira. Criar e editar viraram modal justamente para devolver a
 * largura toda a listagem.
 *
 * Estilo: `admin-ui.css` + primitivos de `components/admin`. Nao acrescente
 * estilo inline aqui — o motivo de o arquivo ter encolhido pela metade e que
 * ele parou de carregar a aparencia de cada elemento.
 */

interface Company {
  id: string;
  name: string;
  legalName: string;
  document: string;
  isActive: boolean;
  createdAt: string;
  omieAppKeyMasked?: string | null;
  omieAppSecretConfigured?: boolean;
  desktopActivationCode?: string;
  desktopActivationCodeRotatedAt?: string;
}

interface Unit {
  id: string;
  companyId: string;
  name: string;
  timezone: string;
  isActive: boolean;
}

interface LoaderUser {
  id: string;
  email: string;
  name: string;
  role: "loader" | "comercial";
  companyId: string;
  unitId: string;
  isActive: boolean;
}

/** Anel de atualizacao: `beta` recebe as versoes em avaliacao antes da frota. */
export type DeviceUpdateChannel = "latest" | "beta";

/**
 * Le o anel que a nuvem informou.
 *
 * So `beta` tira a balanca de producao. Campo ausente (nuvem sem a migracao),
 * null, ou qualquer texto inesperado aparecem como producao — a tela nunca pode
 * sugerir que uma balanca de cliente esta recebendo versao em avaliacao quando
 * nao se sabe se esta.
 */
export function toDeviceUpdateChannel(value: unknown): DeviceUpdateChannel {
  return typeof value === "string" && value.trim().toLowerCase() === "beta" ? "beta" : "latest";
}

interface Device {
  id: string;
  companyId: string;
  unitId: string;
  name: string;
  isActive: boolean;
  updateChannel: DeviceUpdateChannel;
  /**
   * Balanca principal de precos da pedreira: a unica que publica preco padrao, preco
   * especial por cliente, tabela de preco e valor de frete do cadastro. As demais espelham
   * o que vem dela. Sem principal, cada balanca publica o proprio cadastro de preco — o
   * empate que fazia o preco especial existir numa maquina e nao na outra.
   */
  isPriceMaster: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Alvo da exclusao mostrado no modal de confirmacao. */
export interface DeleteTarget {
  type: "company" | "unit" | "user" | "device";
  id: string;
  name: string;
  /** Preenchido quando type === "user": "Carregador" ou "Comercial". */
  roleLabel?: string;
}

/**
 * Texto do modal de confirmacao. A exclusao nao pede mais a senha do administrador (quem esta
 * no dashboard ja passou pelo login), entao a mensagem precisa deixar explicito o efeito em
 * cascata antes do clique final.
 */
export function buildDeleteConfirmationMessage(target: DeleteTarget): string {
  if (target.type === "company") {
    return `Tem certeza que deseja excluir a pedreira "${target.name}"? Todas as unidades, usuarios e dispositivos vinculados serao excluidos tambem.`;
  }
  if (target.type === "unit") {
    return `Tem certeza que deseja excluir a unidade "${target.name}"? Os usuarios e dispositivos vinculados a ela serao excluidos tambem.`;
  }
  if (target.type === "device") {
    return `Tem certeza que deseja excluir o desktop "${target.name}"? A ativacao dele e perdida e a balanca precisara ser ativada de novo com o codigo da pedreira.`;
  }
  const role = target.roleLabel ? `${target.roleLabel.toLowerCase()} ` : "";
  return `Tem certeza que deseja excluir o usuario ${role}"${target.name}"? O acesso dele ao sistema sera removido.`;
}

/** Acao/payload do admin-api correspondente ao alvo. */
export function buildDeleteRequest(target: DeleteTarget): {
  action: string;
  payload: Record<string, string>;
} {
  if (target.type === "company") {
    return { action: "delete_company", payload: { companyId: target.id } };
  }
  if (target.type === "unit") {
    return { action: "delete_unit", payload: { unitId: target.id } };
  }
  if (target.type === "device") {
    return { action: "delete_device", payload: { deviceId: target.id } };
  }
  return { action: "delete_loader", payload: { userId: target.id } };
}

/**
 * Busca dos cadastros: casa quando TODOS os termos digitados aparecem em algum
 * dos campos da linha. Buscar por termo (e nao pela frase inteira) e o que faz
 * "sul joao" achar o carregador Joao da Pedreira Sul — a ordem em que a pessoa
 * lembra dos dois nao pode importar.
 *
 * Delega ao `search-ranking`, que tambem ignora acento e pontuacao — antes "sao" nao
 * achava "São" e o CNPJ digitado com pontos nao achava o gravado sem eles.
 */
export function matchesCadastroSearch(search: string, fields: Array<string | null | undefined>) {
  return matchesSearch(search, fields);
}

/**
 * Filtra e ORDENA uma lista de cadastro pela proximidade com o que foi digitado.
 *
 * A ordem importa em toda tabela do painel: sem ela, procurar "alfa" trazia a Pedreira
 * Alfa depois de "Transportes Beta Alfa Norte" so porque esta foi cadastrada antes.
 */
function rankCadastro<T>(
  items: readonly T[],
  fieldsOf: (item: T) => Array<string | null | undefined>,
  search: string
): T[] {
  return rankBySearch(items, fieldsOf, search);
}

type Section =
  | "companies"
  | "units"
  | "loaders"
  | "comercial"
  | "devices"
  | "updates"
  | "financeiro"
  | "ai";

/** Resposta de `reveal_credentials`. Ver `_shared/admin-credentials.ts`. */
interface RevealedCredential {
  label: string;
  kind: "secret" | "code" | "info";
  value: string | null;
  hint?: string;
  unavailable?: string;
}

interface CredentialBundle {
  title: string;
  subtitle: string;
  credentials: RevealedCredential[];
}

type CredentialTarget = { type: "company" | "user" | "device"; id: string };

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("pt-BR");
}

/** Projeto na barra superior: emitir boleto no projeto errado sai caro. */
function environmentLabel(): string {
  try {
    return new URL(supabaseConfig.url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

export function AdminDashboard() {
  const { logout } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [users, setUsers] = useState<LoaderUser[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [section, setSection] = useState<Section>("companies");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [creating, setCreating] = useState<null | "company" | "unit" | "loader" | "comercial">(
    null
  );
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [renamingDevice, setRenamingDevice] = useState<Device | null>(null);
  const [resettingPasswordUser, setResettingPasswordUser] = useState<LoaderUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [credentials, setCredentials] = useState<CredentialBundle | null>(null);
  const [credentialsLoading, setCredentialsLoading] = useState(false);

  // Sessao expirou no meio do uso: desloga (o guard PrivateAdminRoute redireciona para
  // /admin/login quando isAdmin vira false). Sem isto, callAdminFunction lancava e o dashboard
  // ficava renderizado com todas as listas vazias, sem erro nem redirect ("parece que apagou tudo").
  const handleError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof AdminSessionExpiredError) {
        void logout();
        return;
      }
      setFeedback({ tone: "danger", text: error instanceof Error ? error.message : fallback });
    },
    [logout]
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await callAdminFunction<{
        companies: Array<{
          id: string;
          name: string;
          legal_name: string;
          document: string | null;
          is_active: boolean;
          created_at: string;
          omie_app_key?: string | null;
          omie_app_secret?: string | null;
          desktop_activation_code?: string;
          desktop_activation_code_rotated_at?: string;
        }>;
        units: Array<{
          id: string;
          company_id: string;
          name: string;
          timezone: string;
          is_active: boolean;
        }>;
        users: Array<{
          id: string;
          email: string;
          name: string;
          role?: string;
          company_id: string;
          unit_id: string;
          is_active: boolean;
        }>;
        devices: Array<{
          id: string;
          company_id: string;
          unit_id: string;
          name: string;
          is_active: boolean;
          update_channel?: string | null;
          is_price_master?: boolean | null;
          last_seen_at: string | null;
          created_at: string;
          updated_at: string;
        }>;
      }>("admin-api", { action: "list" });

      setCompanies(
        data.companies.map((company) => ({
          id: company.id,
          name: company.name,
          legalName: company.legal_name,
          document: company.document ?? "",
          isActive: company.is_active,
          createdAt: company.created_at,
          omieAppKeyMasked: company.omie_app_key ?? null,
          omieAppSecretConfigured: Boolean(company.omie_app_secret),
          desktopActivationCode: company.desktop_activation_code,
          desktopActivationCodeRotatedAt: company.desktop_activation_code_rotated_at
        }))
      );
      setUnits(
        data.units.map((unit) => ({
          id: unit.id,
          companyId: unit.company_id,
          name: unit.name,
          timezone: unit.timezone,
          isActive: unit.is_active
        }))
      );
      setUsers(
        data.users.map((user) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role === "comercial" ? "comercial" : "loader",
          companyId: user.company_id,
          unitId: user.unit_id,
          isActive: user.is_active
        }))
      );
      setDevices(
        (data.devices ?? []).map((device) => ({
          id: device.id,
          companyId: device.company_id,
          unitId: device.unit_id,
          name: device.name,
          isActive: device.is_active,
          updateChannel: toDeviceUpdateChannel(device.update_channel),
          isPriceMaster: device.is_price_master === true,
          lastSeenAt: device.last_seen_at,
          createdAt: device.created_at,
          updatedAt: device.updated_at
        }))
      );
    } catch (error) {
      handleError(error, "Nao foi possivel carregar os cadastros.");
    } finally {
      setIsLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /** Executa uma acao do admin-api, mostra o resultado e recarrega a lista. */
  const run = useCallback(
    async (
      action: string,
      payload: Record<string, unknown>,
      successMessage: string
    ): Promise<boolean> => {
      setFeedback(null);
      try {
        await callAdminFunction("admin-api", { action, payload });
        await loadData();
        setFeedback({ tone: "ok", text: successMessage });
        return true;
      } catch (error) {
        handleError(error, "A acao falhou.");
        return false;
      }
    },
    [handleError, loadData]
  );

  const companyName = useCallback(
    (companyId: string) => companies.find((company) => company.id === companyId)?.name ?? "—",
    [companies]
  );
  const unitName = useCallback(
    (unitId: string) => units.find((unit) => unit.id === unitId)?.name ?? "—",
    [units]
  );
  /** Nome da balanca principal de precos da pedreira, para a linha dizer de quem ela espelha. */
  const priceMasterName = useCallback(
    (companyId: string) =>
      devices.find((device) => device.companyId === companyId && device.isPriceMaster)?.name ??
      null,
    [devices]
  );

  const filteredCompanies = useMemo(
    () =>
      rankCadastro(
        companies.filter((company) => !filterCompanyId || company.id === filterCompanyId),
        (company) => [company.name, company.legalName, company.document],
        search
      ),
    [companies, filterCompanyId, search]
  );

  const filteredUnits = useMemo(
    () =>
      rankCadastro(
        units.filter((unit) => !filterCompanyId || unit.companyId === filterCompanyId),
        (unit) => [unit.name, companyName(unit.companyId)],
        search
      ),
    [units, filterCompanyId, search, companyName]
  );

  const filteredDevices = useMemo(
    () =>
      rankCadastro(
        devices.filter((device) => !filterCompanyId || device.companyId === filterCompanyId),
        (device) => [
          device.name,
          device.id,
          companyName(device.companyId),
          unitName(device.unitId)
        ],
        search
      ),
    [devices, filterCompanyId, search, companyName, unitName]
  );

  const usersByRole = useCallback(
    (role: "loader" | "comercial") =>
      rankCadastro(
        users.filter(
          (user) => user.role === role && (!filterCompanyId || user.companyId === filterCompanyId)
        ),
        (user) => [user.name, user.email, companyName(user.companyId)],
        search
      ),
    [users, filterCompanyId, search, companyName]
  );

  const sections: NavSection[] = [
    { id: "companies", label: "Pedreiras", group: "Cadastros", count: companies.length },
    { id: "units", label: "Unidades", group: "Cadastros", count: units.length },
    {
      id: "loaders",
      label: "Carregadores",
      group: "Acessos",
      count: users.filter((user) => user.role === "loader").length
    },
    {
      id: "comercial",
      label: "Comercial",
      group: "Acessos",
      count: users.filter((user) => user.role === "comercial").length
    },
    { id: "devices", label: "Balancas", group: "Acessos", count: devices.length },
    { id: "updates", label: "Atualizacoes", group: "Plataforma" },
    { id: "financeiro", label: "Financeiro", group: "Plataforma" },
    { id: "ai", label: "Assistente de IA", group: "Plataforma" }
  ];

  const filterToolbar = (
    <>
      <select
        className="adm-select adm-toolbar-grow"
        aria-label="Filtrar por pedreira"
        value={filterCompanyId}
        onChange={(event) => setFilterCompanyId(event.target.value)}
      >
        <option value="">Todas as pedreiras</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
      <input
        className="adm-input adm-toolbar-grow"
        aria-label="Buscar nos cadastros"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Buscar por nome, e-mail ou documento"
      />
      {(filterCompanyId || search) && (
        <Button
          size="sm"
          onClick={() => {
            setFilterCompanyId("");
            setSearch("");
          }}
        >
          Limpar
        </Button>
      )}
    </>
  );

  // -------------------------------------------------------------------------
  // Colunas
  // -------------------------------------------------------------------------

  const companyColumns: Array<Column<Company>> = [
    {
      key: "name",
      header: "Pedreira",
      render: (company) => (
        <>
          <span className="adm-cell-primary">{company.name}</span>
          <p className="adm-cell-sub">{company.legalName}</p>
        </>
      )
    },
    {
      key: "document",
      header: "CNPJ",
      render: (company) => <span className="adm-mono">{company.document || "—"}</span>
    },
    {
      key: "units",
      header: "Unidades",
      numeric: true,
      render: (company) => units.filter((unit) => unit.companyId === company.id).length
    },
    {
      key: "omie",
      header: "OMIE",
      render: (company) =>
        company.omieAppKeyMasked ? (
          <Badge tone="ok" dot>
            Conectado
          </Badge>
        ) : (
          <Badge tone="warn" dot>
            Sem token
          </Badge>
        )
    },
    {
      key: "status",
      header: "Situacao",
      render: (company) =>
        company.isActive ? (
          <Badge tone="ok" dot>
            Ativa
          </Badge>
        ) : (
          <Badge tone="danger" dot>
            Inativa
          </Badge>
        )
    },
    {
      key: "created",
      header: "Criada em",
      render: (company) => <span className="adm-mono">{formatDate(company.createdAt)}</span>
    },
    {
      key: "actions",
      header: "",
      actions: true,
      render: (company) => (
        <ButtonGroup>
          <EyeButton
            title={`Ver credenciais de ${company.name}`}
            onClick={() => void handleRevealCredentials({ type: "company", id: company.id })}
          />
          <Button size="sm" onClick={() => setEditingCompany(company)}>
            Editar
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void run(
                "toggle_company",
                { companyId: company.id, isActive: !company.isActive },
                company.isActive
                  ? "Pedreira desativada. Os desktops dela perdem o acesso."
                  : "Pedreira ativada."
              )
            }
          >
            {company.isActive ? "Desativar" : "Ativar"}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              setConfirmDelete({ type: "company", id: company.id, name: company.name })
            }
          >
            Excluir
          </Button>
        </ButtonGroup>
      )
    }
  ];

  const unitColumns: Array<Column<Unit>> = [
    {
      key: "name",
      header: "Unidade",
      render: (unit) => <span className="adm-cell-primary">{unit.name}</span>
    },
    { key: "company", header: "Pedreira", render: (unit) => companyName(unit.companyId) },
    {
      key: "devices",
      header: "Balancas",
      numeric: true,
      render: (unit) => devices.filter((device) => device.unitId === unit.id).length
    },
    {
      key: "users",
      header: "Usuarios",
      numeric: true,
      render: (unit) => users.filter((user) => user.unitId === unit.id).length
    },
    {
      key: "status",
      header: "Situacao",
      render: (unit) =>
        unit.isActive ? (
          <Badge tone="ok" dot>
            Ativa
          </Badge>
        ) : (
          <Badge tone="danger" dot>
            Inativa
          </Badge>
        )
    },
    {
      key: "actions",
      header: "",
      actions: true,
      render: (unit) => (
        <ButtonGroup>
          <EyeButton
            title={`Ver credenciais da pedreira de ${unit.name}`}
            onClick={() => void handleRevealCredentials({ type: "company", id: unit.companyId })}
          />
          <Button size="sm" onClick={() => setEditingUnit(unit)}>
            Editar
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void run(
                "toggle_unit",
                { unitId: unit.id, isActive: !unit.isActive },
                unit.isActive ? "Unidade desativada." : "Unidade ativada."
              )
            }
          >
            {unit.isActive ? "Desativar" : "Ativar"}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setConfirmDelete({ type: "unit", id: unit.id, name: unit.name })}
          >
            Excluir
          </Button>
        </ButtonGroup>
      )
    }
  ];

  function userColumns(role: "loader" | "comercial"): Array<Column<LoaderUser>> {
    const roleLabel = role === "comercial" ? "Comercial" : "Carregador";
    return [
      {
        key: "name",
        header: "Usuario",
        render: (user) => (
          <>
            <span className="adm-cell-primary">{user.name}</span>
            <p className="adm-cell-sub">{user.email}</p>
          </>
        )
      },
      {
        key: "unit",
        header: "Unidade",
        render: (user) => (
          <select
            className="adm-select"
            aria-label={`Unidade de ${user.name}`}
            value={user.unitId}
            onChange={(event) =>
              void run(
                "update_loader_unit",
                { userId: user.id, unitId: event.target.value },
                "Usuario movido de unidade."
              )
            }
          >
            {!units.some((unit) => unit.id === user.unitId) && (
              <option value={user.unitId}>Unidade removida</option>
            )}
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} — {companyName(unit.companyId)}
              </option>
            ))}
          </select>
        )
      },
      { key: "company", header: "Pedreira", render: (user) => companyName(user.companyId) },
      {
        key: "status",
        header: "Situacao",
        render: (user) =>
          user.isActive ? (
            <Badge tone="ok" dot>
              Ativo
            </Badge>
          ) : (
            <Badge tone="danger" dot>
              Bloqueado
            </Badge>
          )
      },
      {
        key: "actions",
        header: "",
        actions: true,
        render: (user) => (
          <ButtonGroup>
            <EyeButton
              title={`Ver credenciais de ${user.name}`}
              onClick={() => void handleRevealCredentials({ type: "user", id: user.id })}
            />
            <Button size="sm" onClick={() => setResettingPasswordUser(user)}>
              Senha
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void run(
                  "toggle_loader",
                  { userId: user.id, isActive: !user.isActive },
                  user.isActive ? "Acesso bloqueado." : "Acesso liberado."
                )
              }
            >
              {user.isActive ? "Bloquear" : "Liberar"}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                setConfirmDelete({ type: "user", id: user.id, name: user.name, roleLabel })
              }
            >
              Excluir
            </Button>
          </ButtonGroup>
        )
      }
    ];
  }

  const deviceColumns: Array<Column<Device>> = [
    {
      key: "name",
      header: "Balanca",
      render: (device) => (
        <>
          <span className="adm-cell-primary">{device.name}</span>
          <p className="adm-cell-sub adm-mono">{device.id.slice(0, 12)}…</p>
        </>
      )
    },
    { key: "company", header: "Pedreira", render: (device) => companyName(device.companyId) },
    {
      key: "unit",
      header: "Unidade",
      render: (device) => (
        <select
          className="adm-select"
          aria-label={`Unidade da balanca ${device.name}`}
          value={device.unitId}
          onChange={(event) =>
            void run(
              "update_device_unit",
              { deviceId: device.id, unitId: event.target.value },
              "Balanca movida de unidade."
            )
          }
        >
          {units
            .filter((unit) => unit.companyId === device.companyId)
            .map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
        </select>
      )
    },
    {
      key: "channel",
      header: "Atualizacao",
      render: (device) => (
        <select
          className="adm-select"
          aria-label={`Anel de atualizacao da balanca ${device.name}`}
          title={
            device.updateChannel === "beta"
              ? "Recebe as versoes em avaliacao antes da frota."
              : "So recebe versao ja liberada para producao."
          }
          value={device.updateChannel}
          onChange={(event) =>
            void run(
              "update_device_channel",
              { deviceId: device.id, updateChannel: event.target.value },
              event.target.value === "beta"
                ? "Balanca passou para o anel de teste."
                : "Balanca voltou para producao."
            )
          }
        >
          <option value="latest">Producao</option>
          <option value="beta">Teste</option>
        </select>
      )
    },
    {
      // Dono do cadastro de preco da pedreira. Uma balanca por empresa: promover outra
      // rebaixa a atual (o `update_device_price_master` limpa antes de marcar), e voltar
      // para "Espelha a principal" na propria principal deixa a pedreira sem principal —
      // ai cada maquina volta a publicar o proprio cadastro de preco.
      key: "priceMaster",
      header: "Precos",
      render: (device) => (
        <select
          className="adm-select"
          aria-label={`Cadastro de precos da balanca ${device.name}`}
          title={
            device.isPriceMaster
              ? "Esta balanca define os precos da pedreira; as demais espelham o que ela publica."
              : priceMasterName(device.companyId)
                ? `Espelha os precos de ${priceMasterName(device.companyId)}.`
                : "Nenhuma balanca principal definida: cada uma publica o proprio cadastro de preco."
          }
          value={device.isPriceMaster ? "master" : "follower"}
          onChange={(event) =>
            void run(
              "update_device_price_master",
              { deviceId: device.id, isPriceMaster: event.target.value === "master" },
              event.target.value === "master"
                ? `${device.name} passou a definir os precos da pedreira.`
                : "Pedreira ficou sem balanca principal de precos."
            )
          }
        >
          <option value="master">Principal</option>
          <option value="follower">
            {priceMasterName(device.companyId) && !device.isPriceMaster
              ? `Espelha ${priceMasterName(device.companyId)}`
              : "Espelha a principal"}
          </option>
        </select>
      )
    },
    {
      key: "lastSeen",
      header: "Ultimo contato",
      render: (device) => <span className="adm-mono">{formatDateTime(device.lastSeenAt)}</span>
    },
    {
      key: "status",
      header: "Situacao",
      render: (device) =>
        device.isActive ? (
          <Badge tone="ok" dot>
            Ativa
          </Badge>
        ) : (
          <Badge tone="danger" dot>
            Bloqueada
          </Badge>
        )
    },
    {
      key: "actions",
      header: "",
      actions: true,
      render: (device) => (
        <ButtonGroup>
          <EyeButton
            title={`Ver credenciais de ${device.name}`}
            onClick={() => void handleRevealCredentials({ type: "device", id: device.id })}
          />
          <Button size="sm" onClick={() => setRenamingDevice(device)}>
            Renomear
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void run(
                "toggle_device",
                { deviceId: device.id, isActive: !device.isActive },
                device.isActive ? "Balanca bloqueada." : "Balanca liberada."
              )
            }
          >
            {device.isActive ? "Bloquear" : "Liberar"}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setConfirmDelete({ type: "device", id: device.id, name: device.name })}
          >
            Excluir
          </Button>
        </ButtonGroup>
      )
    }
  ];

  const activationColumns: Array<Column<Company>> = [
    {
      key: "company",
      header: "Pedreira",
      render: (company) => <span className="adm-cell-primary">{company.name}</span>
    },
    {
      key: "code",
      header: "Codigo ativo",
      render: (company) =>
        company.desktopActivationCode ? (
          <span className="adm-mono adm-activation-code">{company.desktopActivationCode}</span>
        ) : (
          <Badge tone="warn">Nenhum gerado</Badge>
        )
    },
    {
      key: "rotated",
      header: "Gerado em",
      render: (company) => (
        <span className="adm-mono">{formatDate(company.desktopActivationCodeRotatedAt)}</span>
      )
    },
    {
      key: "actions",
      header: "",
      actions: true,
      render: (company) => {
        const hasActiveUnit = units.some((unit) => unit.companyId === company.id && unit.isActive);
        return (
          <ButtonGroup>
            {company.desktopActivationCode && (
              <CopyButton value={company.desktopActivationCode} label="Copiar" />
            )}
            <Button
              size="sm"
              disabled={!hasActiveUnit}
              title={hasActiveUnit ? undefined : "Cadastre uma unidade ativa antes de gerar"}
              onClick={() => void handleGenerateCode(company.id)}
            >
              Gerar novo
            </Button>
          </ButtonGroup>
        );
      }
    }
  ];

  async function handleGenerateCode(companyId: string): Promise<void> {
    try {
      const result = await callAdminFunction<{ code: string }>("admin-api", {
        action: "generate_desktop_activation_code",
        payload: { companyId }
      });
      setGeneratedCode(result.code);
      await loadData();
    } catch (error) {
      handleError(error, "Nao foi possivel gerar o codigo de ativacao.");
    }
  }

  /**
   * Abre as credenciais de um cadastro. A consulta e sob demanda de proposito:
   * segredo que viaja no carregamento da lista fica em cache de navegador e em
   * log de proxy, mesmo quando ninguem pediu para ver.
   */
  async function handleRevealCredentials(target: CredentialTarget): Promise<void> {
    setCredentialsLoading(true);
    setFeedback(null);
    try {
      const response = await callAdminFunction<{ bundle: CredentialBundle }>("admin-api", {
        action: "reveal_credentials",
        payload: target
      });
      setCredentials(response.bundle);
    } catch (error) {
      handleError(error, "Nao foi possivel carregar as credenciais.");
    } finally {
      setCredentialsLoading(false);
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!confirmDelete || isDeleting) return;
    setIsDeleting(true);
    const { action, payload } = buildDeleteRequest(confirmDelete);
    const ok = await run(action, payload, "Registro excluido.");
    setIsDeleting(false);
    if (ok) setConfirmDelete(null);
  }

  const inactiveRow = (item: { isActive: boolean }) =>
    item.isActive ? undefined : "adm-row-muted";

  // -------------------------------------------------------------------------

  return (
    <AdminShell
      sections={sections}
      activeSection={section}
      onSelectSection={(id) => setSection(id as Section)}
      environmentLabel={environmentLabel()}
      headerActions={
        <Button size="sm" onClick={() => void logout()}>
          Sair
        </Button>
      }
    >
      {feedback && <Note tone={feedback.tone === "ok" ? "ok" : "danger"}>{feedback.text}</Note>}

      {isLoading && companies.length === 0 ? (
        <Panel>
          <p className="adm-empty">Carregando cadastros...</p>
        </Panel>
      ) : (
        <>
          {section === "companies" && (
            <>
              <PageHead
                title="Pedreiras"
                description="Empresas clientes da plataforma. Desativar uma pedreira bloqueia o acesso de todos os desktops dela."
                actions={
                  <Button variant="primary" onClick={() => setCreating("company")}>
                    Nova pedreira
                  </Button>
                }
              />
              <Panel flush toolbar={filterToolbar}>
                <DataTable
                  columns={companyColumns}
                  rows={filteredCompanies}
                  rowKey={(company) => company.id}
                  rowClassName={inactiveRow}
                  empty={
                    companies.length === 0
                      ? "Nenhuma pedreira cadastrada."
                      : "Nenhuma pedreira encontrada com os filtros atuais."
                  }
                />
              </Panel>
            </>
          )}

          {section === "units" && (
            <>
              <PageHead
                title="Unidades"
                description="Cada pedreira pode ter mais de uma unidade. A fila do carregador e por unidade."
                actions={
                  <Button variant="primary" onClick={() => setCreating("unit")}>
                    Nova unidade
                  </Button>
                }
              />
              <Panel flush toolbar={filterToolbar}>
                <DataTable
                  columns={unitColumns}
                  rows={filteredUnits}
                  rowKey={(unit) => unit.id}
                  rowClassName={inactiveRow}
                  empty={
                    units.length === 0
                      ? "Nenhuma unidade cadastrada."
                      : "Nenhuma unidade encontrada com os filtros atuais."
                  }
                />
              </Panel>
            </>
          )}

          {(section === "loaders" || section === "comercial") && (
            <>
              <PageHead
                title={section === "comercial" ? "Usuarios comerciais" : "Carregadores"}
                description={
                  section === "comercial"
                    ? "Acessam os relatorios de venda da pedreira inteira."
                    : "Acessam a fila de carregamento da unidade a que pertencem."
                }
                actions={
                  <Button
                    variant="primary"
                    onClick={() => setCreating(section === "comercial" ? "comercial" : "loader")}
                  >
                    {section === "comercial" ? "Novo comercial" : "Novo carregador"}
                  </Button>
                }
              />
              <Panel flush toolbar={filterToolbar}>
                <DataTable
                  columns={userColumns(section === "comercial" ? "comercial" : "loader")}
                  rows={usersByRole(section === "comercial" ? "comercial" : "loader")}
                  rowKey={(user) => user.id}
                  rowClassName={inactiveRow}
                  empty="Nenhum usuario encontrado."
                />
              </Panel>
            </>
          )}

          {section === "devices" && (
            <>
              <PageHead
                title="Balancas e licencas"
                description="Desktops ativados e o codigo de ativacao de cada pedreira. Em Precos, escolha a balanca que define os precos da pedreira — as demais passam a espelhar o cadastro dela."
              />
              {generatedCode && (
                <Note tone="ok">
                  Codigo gerado: <strong className="adm-mono">{generatedCode}</strong>. Envie ao
                  operador do desktop — ele vale apenas para a ativacao inicial.{" "}
                  <Button size="sm" onClick={() => setGeneratedCode(null)}>
                    Fechar
                  </Button>
                </Note>
              )}
              <Panel title="Desktops ativados" flush toolbar={filterToolbar}>
                <DataTable
                  columns={deviceColumns}
                  rows={filteredDevices}
                  rowKey={(device) => device.id}
                  rowClassName={inactiveRow}
                  empty={
                    devices.length === 0
                      ? "Nenhum desktop ativado ainda."
                      : "Nenhum desktop encontrado com os filtros atuais."
                  }
                />
              </Panel>
              <Panel
                title="Codigos de ativacao"
                description="Um codigo por pedreira. Gerar um novo invalida o anterior."
                flush
              >
                <DataTable
                  columns={activationColumns}
                  rows={filteredCompanies}
                  rowKey={(company) => company.id}
                  empty="Nenhuma pedreira cadastrada."
                />
              </Panel>
            </>
          )}

          {section === "updates" && <DesktopUpdates onSessionExpired={() => void logout()} />}

          {section === "financeiro" && (
            <FinancialBackoffice onSessionExpired={() => void logout()} />
          )}

          {section === "ai" && <AiAssistantSettings onSessionExpired={() => void logout()} />}
        </>
      )}

      {creating === "company" && (
        <CompanyFormModal
          title="Nova pedreira"
          onClose={() => setCreating(null)}
          onSubmit={async (payload) => {
            const ok = await run("create_company", payload, "Pedreira criada.");
            if (ok) setCreating(null);
          }}
        />
      )}

      {editingCompany && (
        <CompanyFormModal
          title={`Editar ${editingCompany.name}`}
          company={editingCompany}
          onClose={() => setEditingCompany(null)}
          onSubmit={async (payload, priceChangePassword) => {
            const ok = await run(
              "update_company",
              { companyId: editingCompany.id, ...payload },
              "Pedreira atualizada."
            );
            if (!ok) return;
            if (priceChangePassword) {
              await run(
                "update_company_price_password",
                { companyId: editingCompany.id, priceChangePassword },
                "Pedreira e senha de precos atualizadas."
              );
            }
            setEditingCompany(null);
          }}
        />
      )}

      {creating === "unit" && (
        <UnitFormModal
          companies={companies}
          defaultCompanyId={filterCompanyId}
          onClose={() => setCreating(null)}
          onSubmit={async (payload) => {
            const ok = await run("create_unit", payload, "Unidade criada.");
            if (ok) setCreating(null);
          }}
        />
      )}

      {editingUnit && (
        <UnitFormModal
          unit={editingUnit}
          companies={companies}
          onClose={() => setEditingUnit(null)}
          onSubmit={async (payload) => {
            const ok = await run(
              "update_unit",
              { unitId: editingUnit.id, name: payload.name },
              "Unidade atualizada."
            );
            if (ok) setEditingUnit(null);
          }}
        />
      )}

      {renamingDevice && (
        <DeviceNameModal
          device={renamingDevice}
          unitLabel={unitName(renamingDevice.unitId)}
          onClose={() => setRenamingDevice(null)}
          onSubmit={async (name) => {
            const ok = await run(
              "update_device_name",
              { deviceId: renamingDevice.id, name },
              `Balanca renomeada para "${name}". Os computadores da pedreira ja estao exibindo o novo nome.`
            );
            if (ok) setRenamingDevice(null);
          }}
        />
      )}

      {(creating === "loader" || creating === "comercial") && (
        <UserFormModal
          role={creating}
          units={units}
          companies={companies}
          onClose={() => setCreating(null)}
          onSubmit={async (payload) => {
            const ok = await run("create_loader", payload, "Usuario criado.");
            if (ok) setCreating(null);
          }}
        />
      )}

      {resettingPasswordUser && (
        <PasswordModal
          user={resettingPasswordUser}
          onClose={() => setResettingPasswordUser(null)}
          onSubmit={async (password) => {
            const ok = await run(
              "update_loader_password",
              { userId: resettingPasswordUser.id, password },
              "Senha atualizada."
            );
            if (ok) setResettingPasswordUser(null);
          }}
        />
      )}

      {credentials && (
        <CredentialsModal bundle={credentials} onClose={() => setCredentials(null)} />
      )}

      {credentialsLoading && !credentials && (
        <Modal title="Credenciais" onClose={() => setCredentialsLoading(false)} size="sm">
          <p className="adm-empty">Carregando...</p>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Confirmar exclusao"
          message={buildDeleteConfirmationMessage(confirmDelete)}
          confirmLabel="Excluir"
          busy={isDeleting}
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// Modais de cadastro
// ---------------------------------------------------------------------------

/**
 * Credenciais de um cadastro.
 *
 * Mostra o valor de quem guarda em texto e, para quem guarda hash (senha do
 * usuario, token do desktop), mostra o MOTIVO e o caminho que resolve. Dizer so
 * "indisponivel" faria o administrador procurar a senha em outro lugar por meia
 * hora — ela nao existe em lugar nenhum.
 */
function CredentialsModal({ bundle, onClose }: { bundle: CredentialBundle; onClose: () => void }) {
  const hasSecret = bundle.credentials.some(
    (credential) => credential.kind !== "info" && credential.value !== null
  );

  return (
    <Modal
      title={bundle.title}
      description={bundle.subtitle}
      onClose={onClose}
      footer={<Button onClick={onClose}>Fechar</Button>}
    >
      {hasSecret && (
        <Note tone="warn">
          Credenciais em texto. Confira quem esta olhando a tela antes de continuar.
        </Note>
      )}
      <div style={{ marginTop: hasSecret ? "16px" : 0 }}>
        {bundle.credentials.map((credential) => (
          <div key={credential.label} className="adm-cred">
            <div className="adm-cred-head">
              <span className="adm-cred-label">{credential.label}</span>
              {credential.value && <CopyButton value={credential.value} />}
            </div>
            {credential.value ? (
              <p className="adm-cred-value">{credential.value}</p>
            ) : (
              <p className="adm-cred-unavailable">{credential.unavailable}</p>
            )}
            {credential.value && credential.hint && (
              <p className="adm-cred-hint">{credential.hint}</p>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Campo de senha visivel por padrao. O admin cadastra a senha do carregador e
 * precisa conferir o que digitou antes de repassar — mascarar so gerava senha
 * errada e usuario sem acesso. O botao esconde quando ha alguem olhando.
 *
 * Vale para senha NOVA: o Auth guarda apenas o hash, entao a senha de um
 * usuario ja cadastrado nao pode ser exibida em lugar nenhum.
 */
function PasswordInput({
  name,
  required = false,
  minLength,
  maxLength,
  autoFocus = false
}: {
  name: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(true);
  return (
    <div className="adm-input-row">
      <input
        className="adm-input adm-input-mono"
        name={name}
        type={visible ? "text" : "password"}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        autoFocus={autoFocus}
        autoComplete="off"
      />
      <Button size="sm" onClick={() => setVisible((value) => !value)}>
        {visible ? "Ocultar" : "Mostrar"}
      </Button>
    </div>
  );
}

function CompanyFormModal({
  title,
  company,
  onClose,
  onSubmit
}: {
  title: string;
  company?: Company;
  onClose: () => void;
  onSubmit: (
    payload: Record<string, unknown>,
    priceChangePassword?: string
  ) => void | Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const formId = "company-form";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const priceChangePassword = String(form.get("priceChangePassword") ?? "").trim();
    if (priceChangePassword && !/^\d{4}$/.test(priceChangePassword)) {
      setError("A senha para alterar precos deve ter exatamente 4 digitos.");
      return;
    }
    setError(null);

    const payload: Record<string, unknown> = {
      name: form.get("name"),
      legalName: form.get("legalName"),
      document: form.get("document")
    };
    const omieAppKey = String(form.get("omieAppKey") ?? "").trim();
    const omieAppSecret = String(form.get("omieAppSecret") ?? "").trim();
    if (company) {
      // Na edicao, campo vazio significa "mantenha o que esta gravado" — o
      // segredo nunca volta do servidor, entao um submit sem redigitar nao pode
      // apagar a integracao.
      if (omieAppKey) payload.omieAppKey = omieAppKey;
      if (omieAppSecret) payload.omieAppSecret = omieAppSecret;
    } else {
      payload.omieAppKey = omieAppKey || null;
      payload.omieAppSecret = omieAppSecret || null;
    }

    void onSubmit(payload, priceChangePassword || undefined);
  }

  return (
    <Modal
      title={title}
      description="Valor acertado, datas do ciclo e dados do boleto ficam na secao Financeiro."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" form={formId}>
            Salvar
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-form" onSubmit={handleSubmit}>
        <Fieldset legend="Identificacao">
          <div className="adm-grid">
            <Field label="Nome fantasia">
              <input className="adm-input" name="name" defaultValue={company?.name} required />
            </Field>
            <Field label="Razao social">
              <input
                className="adm-input"
                name="legalName"
                defaultValue={company?.legalName}
                required
              />
            </Field>
            <Field
              label="CNPJ"
              hint="Serve de padrao para o boleto quando o cadastro de cobranca nao tiver documento proprio."
            >
              <input
                className="adm-input adm-input-mono"
                name="document"
                defaultValue={company?.document}
              />
            </Field>
          </div>
        </Fieldset>

        <Fieldset legend="Integracao OMIE">
          {company && (
            <p className="adm-field-hint">
              {company.omieAppKeyMasked
                ? `Configurado (App Key ${company.omieAppKeyMasked}). Deixe vazio para manter.`
                : "Nao configurado. Os desktops desta pedreira nao conectam ao OMIE."}
            </p>
          )}
          <div className="adm-grid">
            <Field label="App Key">
              <input className="adm-input adm-input-mono" name="omieAppKey" autoComplete="off" />
            </Field>
            <Field
              label="App Secret"
              hint={company ? "Vazio mantem; salve os dois vazios para limpar." : undefined}
            >
              <input
                className="adm-input"
                name="omieAppSecret"
                type="password"
                autoComplete="off"
              />
            </Field>
          </div>
        </Fieldset>

        <Fieldset legend="Senha para alterar precos">
          <Field
            label="Senha de 4 digitos"
            hint="Pedida no desktop para alterar precos padrao. Vazio mantem a atual."
            error={error}
          >
            <PasswordInput name="priceChangePassword" maxLength={4} />
          </Field>
        </Fieldset>
      </form>
    </Modal>
  );
}

/**
 * Renomeia uma balanca ja ativada.
 *
 * O nome nao vale so para esta lista: e o rotulo que TODAS as maquinas da
 * pedreira exibem para aquele computador — a legenda de cores da tela de
 * Operacoes e o campo "Computador" do detalhe da operacao saem do espelho local
 * `devices`, que cada desktop reescreve com o que vem da nuvem. Dai o aviso no
 * formulario: quem renomeia precisa saber que a troca aparece em todo mundo, e
 * que nao e preciso reativar nada para isso.
 *
 * Validacao controlada (e nao `required` do HTML) porque o botao Salvar fica
 * desabilitado ate o nome ficar valido: nome em branco na nuvem viraria o
 * generico "Computador" em todas as maquinas, sem erro nenhum na tela.
 */
function DeviceNameModal({
  device,
  unitLabel,
  onClose,
  onSubmit
}: {
  device: Device;
  unitLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
}) {
  const formId = "device-name-form";
  const [name, setName] = useState(device.name);
  const parsed = parseDeviceName(name);

  return (
    <Modal
      title={`Renomear ${device.name}`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" form={formId} disabled={!parsed.ok}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="adm-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!parsed.ok) return;
          void onSubmit(parsed.name);
        }}
      >
        <Field
          label="Nome do computador"
          hint={`Como esta balanca aparece para todos. Ate ${DEVICE_NAME_MAX_LENGTH} caracteres.`}
          error={parsed.ok ? null : parsed.error}
        >
          <input
            className="adm-input"
            value={name}
            maxLength={DEVICE_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </Field>
        <Note tone="info">
          Ao salvar, os computadores da unidade {unitLabel} passam a exibir o novo nome em segundos
          — na legenda de cores e no responsavel de cada operacao. Nenhuma balanca precisa ser
          reativada, e as operacoes ja registradas continuam as mesmas.
        </Note>
      </form>
    </Modal>
  );
}

function UnitFormModal({
  unit,
  companies,
  defaultCompanyId,
  onClose,
  onSubmit
}: {
  unit?: Unit;
  companies: Company[];
  defaultCompanyId?: string;
  onClose: () => void;
  onSubmit: (payload: { companyId?: string; name: string }) => void | Promise<void>;
}) {
  const formId = "unit-form";
  return (
    <Modal
      title={unit ? `Editar ${unit.name}` : "Nova unidade"}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" form={formId}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="adm-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void onSubmit({
            companyId: unit ? undefined : String(form.get("companyId") ?? ""),
            name: String(form.get("name") ?? "")
          });
        }}
      >
        {!unit && (
          <Field label="Pedreira">
            <select
              className="adm-select"
              name="companyId"
              defaultValue={defaultCompanyId}
              required
            >
              <option value="">Selecione</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Nome da unidade">
          <input className="adm-input" name="name" defaultValue={unit?.name} required autoFocus />
        </Field>
      </form>
    </Modal>
  );
}

function UserFormModal({
  role,
  units,
  companies,
  onClose,
  onSubmit
}: {
  role: "loader" | "comercial";
  units: Unit[];
  companies: Company[];
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const formId = "user-form";
  return (
    <Modal
      title={role === "comercial" ? "Novo usuario comercial" : "Novo carregador"}
      description={
        role === "comercial"
          ? "Acessa os relatorios de venda da pedreira."
          : "Acessa a fila de carregamento da unidade."
      }
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" form={formId}>
            Criar
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="adm-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void onSubmit({
            email: form.get("email"),
            password: form.get("password"),
            name: form.get("name"),
            unitId: form.get("unitId"),
            role
          });
        }}
      >
        <Field label="Nome completo">
          <input className="adm-input" name="name" required autoFocus />
        </Field>
        <Field label="E-mail">
          <input className="adm-input" name="email" type="email" required />
        </Field>
        <Field label="Senha" hint="Minimo de 6 caracteres. Anote antes de repassar ao usuario.">
          <PasswordInput name="password" required minLength={6} />
        </Field>
        <Field label="Unidade">
          <select className="adm-select" name="unitId" required>
            <option value="">Selecione</option>
            {units
              .filter((unit) => unit.isActive)
              .map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name} — {companies.find((c) => c.id === unit.companyId)?.name ?? ""}
                </option>
              ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

function PasswordModal({
  user,
  onClose,
  onSubmit
}: {
  user: LoaderUser;
  onClose: () => void;
  onSubmit: (password: string) => void | Promise<void>;
}) {
  const formId = "password-form";
  return (
    <Modal
      title={`Senha de ${user.name}`}
      description={user.email}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" form={formId}>
            Salvar senha
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="adm-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void onSubmit(String(form.get("password") ?? ""));
        }}
      >
        <Note>
          A senha atual nao pode ser exibida — o Supabase Auth guarda apenas o hash dela. Defina uma
          nova aqui e repasse ao usuario.
        </Note>
        <Field label="Nova senha">
          <PasswordInput name="password" required minLength={6} autoFocus />
        </Field>
      </form>
    </Modal>
  );
}
