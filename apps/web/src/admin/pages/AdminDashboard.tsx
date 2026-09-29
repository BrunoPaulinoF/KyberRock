import {
  Bot,
  Building2,
  Download,
  LayoutDashboard,
  MapPin,
  MonitorSmartphone,
  Truck,
  Users,
  Wallet
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminSessionExpiredError, callAdminFunction } from "../lib/admin-api";
import { SUPABASE_URL } from "../../lib/supabase-env";
import { useAdminLogout } from "../lib/admin-session";
import type { DeviceHealthLevel } from "../lib/device-health";
import { DEVICE_NAME_MAX_LENGTH, parseDeviceName } from "../lib/device-name";
import { deviceHealth, isOnline, sinceLabel } from "../lib/overview";
import { matchesSearch, rankBySearch } from "../lib/search-ranking";
import { AiAssistantSettings } from "./AiAssistantSettings";
import { DesktopUpdates } from "./DesktopUpdates";
import { FinancialBackoffice } from "./FinancialBackoffice";
import { Overview, type OverviewTarget } from "./Overview";
import {
  AdminShell,
  Badge,
  Button,
  ButtonGroup,
  ConfirmDialog,
  CopyButton,
  DataTable,
  Field,
  Fieldset,
  Modal,
  Note,
  PageHead,
  Panel,
  RowMenu
} from "../components";
import type { Column, MenuItem, NavSection, Tone } from "../components";

/**
 * Cor de cada estado de saude da balanca.
 *
 * "Sem dados" fica em cinza de proposito: e a balanca que nao reportou, e
 * pinta-la de verde seria o painel afirmando o que ninguem apurou.
 */
const HEALTH_TONES: Record<DeviceHealthLevel, Tone> = {
  unknown: "neutral",
  ok: "ok",
  warn: "warn",
  down: "danger"
};

/**
 * De quanto em quanto tempo a aba Balancas se atualiza sozinha.
 *
 * A aba deixou de ser so cadastro: com a coluna de saude ela vira o monitor da
 * frota, e monitor que so mostra o estado do momento em que a pagina foi aberta
 * e pior que nenhum — quem esta com a tela aberta pararia de ver justamente a
 * balanca que travou depois disso. As demais abas continuam carregando uma vez.
 */
const DEVICES_REFRESH_INTERVAL_MS = 60_000;

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

/**
 * Perfil de acesso (`user_profiles.role`, migracoes `202609240001` e `202609260001`). O
 * carregador ve so a fila da unidade; os outros cinco sao perfis do KyberRock Web. As telas de
 * cada um estao em `apps/web/src/lib/permissions.ts`; o que cada um grava, em
 * `supabase/functions/_shared/web-session.ts`.
 */
export type UserRole =
  | "loader"
  | "monitoramento"
  | "comercial"
  | "gestor"
  | "operacao"
  | "administrador";

/** Perfis do site, na ordem do seletor, com o que cada um pode. */
export const SITE_ROLE_OPTIONS: ReadonlyArray<{ value: UserRole; label: string; hint: string }> = [
  {
    value: "monitoramento",
    label: "Monitoramento",
    hint: "Só a tela de vendas em tempo real. Sem configurações."
  },
  {
    value: "comercial",
    label: "Comercial",
    hint: "Insights, conferência de faturamento, relatórios, controle de caminhões, relatório por cliente e cadastros. Cadastra tudo e muda preço sem senha. Sem configurações."
  },
  {
    value: "gestor",
    label: "Gestor",
    hint: "Tudo. Com configurações."
  },
  {
    value: "operacao",
    label: "Operação",
    hint: "Tudo. Mudar preço sempre pede a senha de preço da pedreira. Com configurações."
  },
  {
    value: "administrador",
    label: "Administrador",
    hint: "Tudo, sem pedir senha, mais os logs de suporte. Com configurações."
  }
];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  loader: "Carregador",
  monitoramento: "Monitoramento",
  comercial: "Comercial",
  gestor: "Gestor",
  operacao: "Operação",
  administrador: "Administrador"
};

/**
 * A senha de preco depende do perfil antes da marca do login: a operacao sempre pede, o
 * administrador e o comercial nunca (`requiresPricePasswordFor` em `_shared/web-session.ts`). So
 * nos outros perfis a marca do painel decide.
 */
export function pricePasswordRule(role: UserRole): "always" | "never" | "flag" {
  if (role === "operacao") return "always";
  if (role === "administrador" || role === "comercial") return "never";
  return "flag";
}

export function parseUserRole(value: unknown): UserRole {
  return typeof value === "string" && Object.hasOwn(USER_ROLE_LABELS, value)
    ? (value as UserRole)
    : "loader";
}

/** O dispositivo virtual do site (`web-<company_id>`) nao e um computador: nao tem login. */
export function isVirtualWebDevice(deviceId: string): boolean {
  return deviceId.startsWith("web-");
}

/** Atalhos de filtro da aba de balancas. */
export type DeviceFilter = "all" | "attention" | "no-login" | "blocked";

export const DEVICE_FILTER_LABELS: Record<DeviceFilter, string> = {
  all: "Todas",
  attention: "Precisam de atenção",
  "no-login": "Sem login do site",
  blocked: "Bloqueadas"
};

/**
 * "Precisam de atencao" e o mesmo recorte da Visao geral e da bolha do menu: balanca ativa com
 * envio parado, sem contato ou com fila atrasada. O dispositivo virtual do site so aparece em
 * "Todas" — ele nao pinga nem tem login.
 */
export function matchesDeviceFilter(
  device: {
    id: string;
    isActive: boolean;
    isPriceMaster: boolean;
    executesWebOperations: boolean;
    companyId: string;
    unitId: string;
    name: string;
    lastSeenAt: string | null;
    healthQueuePending: number | null;
    healthQueueBlocked: number | null;
    healthOldestPendingAt: string | null;
    healthLastError: string | null;
    healthCollectedAt: string | null;
  },
  filter: DeviceFilter,
  hasLogin: boolean,
  now: Date = new Date()
): boolean {
  if (filter === "all") return true;
  if (isVirtualWebDevice(device.id)) return false;
  if (filter === "blocked") return !device.isActive;
  if (filter === "no-login") return device.isActive && !hasLogin;
  if (!device.isActive) return false;
  const level = deviceHealth(device, now).level;
  return level === "down" || level === "warn";
}

interface LoaderUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string;
  unitId: string;
  isActive: boolean;
  /** Acesso do sistema (computador cadastrado) a que este login pertence, se houver. */
  deviceId: string | null;
  /** Pede a senha de alteracao de preco ao mudar preco de pesagem pelo site. */
  requiresPricePassword: boolean;
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
  /** Executa os pedidos de pesagem do site da unidade (migracao `202609250001`). */
  executesWebOperations: boolean;
  lastSeenAt: string | null;
  /**
   * Saude da fila de envio, reportada pela propria balanca no `desktop-status`.
   *
   * `null` em toda parte e "esta balanca nunca reportou" — instalacao anterior
   * ao relatorio, ou nuvem sem a migracao aplicada. A tela precisa saber
   * distinguir isso de "fila limpa": ver `lib/device-health.ts`.
   */
  healthQueuePending: number | null;
  healthQueueBlocked: number | null;
  healthOldestPendingAt: string | null;
  healthLastError: string | null;
  healthCollectedAt: string | null;
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
    return `Tem certeza que deseja excluir a pedreira "${target.name}"? Todas as unidades, usuários e dispositivos vinculados serão excluídos também.`;
  }
  if (target.type === "unit") {
    return `Tem certeza que deseja excluir a unidade "${target.name}"? Os usuários e dispositivos vinculados a ela serão excluídos também.`;
  }
  if (target.type === "device") {
    return `Tem certeza que deseja excluir o desktop "${target.name}"? A ativação dele é perdida e a balança precisará ser ativada de novo com o código da pedreira.`;
  }
  const role = target.roleLabel ? `${target.roleLabel.toLowerCase()} ` : "";
  return `Tem certeza que deseja excluir o usuário ${role}"${target.name}"? O acesso dele ao sistema será removido.`;
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
  | "overview"
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
    return new URL(SUPABASE_URL).hostname.split(".")[0];
  } catch {
    return "";
  }
}

export function AdminDashboard() {
  const logout = useAdminLogout();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [users, setUsers] = useState<LoaderUser[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [section, setSection] = useState<Section>("overview");
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
  const [configuringDevice, setConfiguringDevice] = useState<Device | null>(null);
  const [editingUser, setEditingUser] = useState<LoaderUser | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>("all");
  const [creatingLoginFor, setCreatingLoginFor] = useState<Device | null>(null);
  const [resettingPasswordUser, setResettingPasswordUser] = useState<LoaderUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [credentials, setCredentials] = useState<CredentialBundle | null>(null);
  const [credentialsLoading, setCredentialsLoading] = useState(false);

  // Sessao expirou no meio do uso: desloga e volta para /admin/login. Sem isto,
  // callAdminFunction lancava e o dashboard ficava renderizado com todas as listas vazias, sem
  // erro nem redirect ("parece que apagou tudo").
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

  /**
   * `silent` e a releitura de fundo da aba Balancas: nao acende "carregando" e
   * nao acusa erro na tela. Uma oscilacao de rede num ciclo automatico nao pode
   * piscar a tabela nem plantar um aviso vermelho que ninguem pediu — a proxima
   * passada resolve, e ate la vale o ultimo estado conhecido.
   */
  const loadData = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) setIsLoading(true);
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
            device_id?: string | null;
            requires_price_password?: boolean | null;
          }>;
          devices: Array<{
            id: string;
            company_id: string;
            unit_id: string;
            name: string;
            is_active: boolean;
            update_channel?: string | null;
            is_price_master?: boolean | null;
            executes_web_operations?: boolean | null;
            last_seen_at: string | null;
            // Ausentes enquanto a migracao da saude nao for aplicada: a funcao cai
            // no select sem elas para a lista inteira nao deixar de carregar.
            health_queue_pending?: number | null;
            health_queue_blocked?: number | null;
            health_oldest_pending_at?: string | null;
            health_last_error?: string | null;
            health_collected_at?: string | null;
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
            role: parseUserRole(user.role),
            companyId: user.company_id,
            unitId: user.unit_id,
            isActive: user.is_active,
            deviceId: user.device_id ?? null,
            requiresPricePassword: user.requires_price_password === true
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
            executesWebOperations: device.executes_web_operations === true,
            lastSeenAt: device.last_seen_at,
            // `?? null` e nao `?? 0`: coluna ausente (migracao pendente) e campo
            // nulo (balanca que nunca reportou) tem que continuar sendo "nao sei"
            // ate a tela. Virar zero aqui faria a coluna pintar de verde a frota
            // inteira no dia do deploy.
            healthQueuePending: device.health_queue_pending ?? null,
            healthQueueBlocked: device.health_queue_blocked ?? null,
            healthOldestPendingAt: device.health_oldest_pending_at ?? null,
            healthLastError: device.health_last_error ?? null,
            healthCollectedAt: device.health_collected_at ?? null,
            createdAt: device.created_at,
            updatedAt: device.updated_at
          }))
        );
      } catch (error) {
        if (!options.silent) handleError(error, "Não foi possível carregar os cadastros.");
      } finally {
        if (!options.silent) setIsLoading(false);
      }
    },
    [handleError]
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Enquanto a aba Balancas estiver aberta ela se atualiza sozinha: a saude da
  // fila muda sem ninguem clicar, e uma balanca que trava depois de a pagina
  // abrir precisa aparecer. Sai de cena junto com a aba — as outras nao
  // ganharam trafego nenhum com isto.
  useEffect(() => {
    if (section !== "devices" && section !== "overview") return;
    const intervalId = window.setInterval(
      () => void loadData({ silent: true }),
      DEVICES_REFRESH_INTERVAL_MS
    );
    return () => window.clearInterval(intervalId);
  }, [section, loadData]);

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
        handleError(error, "A ação falhou.");
        return false;
      }
    },
    [handleError, loadData]
  );

  /**
   * Varias alteracoes de um mesmo formulario (a janela Configurar da balanca, a de Editar do
   * login), uma acao do `admin-api` por campo que mudou, na ordem, e UMA releitura no fim.
   * Parou no primeiro erro: o que ja foi gravado fica, e a lista relida mostra o estado real.
   */
  const runBatch = useCallback(
    async (
      steps: Array<{ action: string; payload: Record<string, unknown> }>,
      successMessage: string
    ): Promise<boolean> => {
      setFeedback(null);
      if (steps.length === 0) return true;
      try {
        for (const step of steps) {
          await callAdminFunction("admin-api", step);
        }
        await loadData();
        setFeedback({ tone: "ok", text: successMessage });
        return true;
      } catch (error) {
        handleError(error, "A alteração falhou.");
        await loadData({ silent: true });
        return false;
      }
    },
    [handleError, loadData]
  );

  /** Da Visao geral para a aba que resolve, ja filtrada pela pedreira quando ha uma. */
  const navigateTo = useCallback(
    (target: OverviewTarget, companyId?: string, filter: DeviceFilter = "all") => {
      setFilterCompanyId(companyId ?? "");
      setSearch("");
      setDeviceFilter(filter);
      setSection(target);
    },
    []
  );

  const companyName = useCallback(
    (companyId: string) => companies.find((company) => company.id === companyId)?.name ?? "—",
    [companies]
  );
  const unitName = useCallback(
    (unitId: string) => units.find((unit) => unit.id === unitId)?.name ?? "—",
    [units]
  );
  /** Nomes das balancas principais de precos da pedreira, para a linha dizer de quem espelha. */
  const priceMasterNames = useCallback(
    (companyId: string) =>
      devices
        .filter((device) => device.companyId === companyId && device.isPriceMaster)
        .map((device) => device.name),
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
        devices.filter(
          (device) =>
            (!filterCompanyId || device.companyId === filterCompanyId) &&
            matchesDeviceFilter(
              device,
              deviceFilter,
              users.some((user) => user.deviceId === device.id)
            )
        ),
        (device) => [
          device.name,
          device.id,
          companyName(device.companyId),
          unitName(device.unitId)
        ],
        search
      ),
    [devices, users, filterCompanyId, deviceFilter, search, companyName, unitName]
  );

  // A secao "Comercial" lista comercial E gestor: sao os dois perfis do site.
  const usersByRole = useCallback(
    (role: "loader" | "comercial") =>
      rankCadastro(
        users.filter(
          (user) =>
            (role === "comercial" ? user.role !== "loader" : user.role === "loader") &&
            (!filterCompanyId || user.companyId === filterCompanyId)
        ),
        (user) => [user.name, user.email, companyName(user.companyId)],
        search
      ),
    [users, filterCompanyId, search, companyName]
  );

  // Balancas ativas com problema: a bolha vermelha no menu, visivel de qualquer aba.
  const devicesNeedingAttention = devices.filter((device) => {
    if (isVirtualWebDevice(device.id) || !device.isActive) return false;
    const level = deviceHealth(device).level;
    return level === "down" || level === "warn";
  }).length;

  const sections: NavSection[] = [
    {
      id: "overview",
      label: "Visão geral",
      group: "Início",
      icon: <LayoutDashboard size={16} />
    },
    {
      id: "companies",
      label: "Pedreiras",
      group: "Cadastros",
      count: companies.length,
      icon: <Building2 size={16} />
    },
    {
      id: "units",
      label: "Unidades",
      group: "Cadastros",
      count: units.length,
      icon: <MapPin size={16} />
    },
    {
      id: "devices",
      label: "Balanças",
      group: "Acessos",
      count: devices.filter((device) => !isVirtualWebDevice(device.id)).length,
      alert: devicesNeedingAttention,
      icon: <MonitorSmartphone size={16} />
    },
    {
      id: "comercial",
      label: "Usuários do site",
      group: "Acessos",
      count: users.filter((user) => user.role !== "loader").length,
      icon: <Users size={16} />
    },
    {
      id: "loaders",
      label: "Carregadores",
      group: "Acessos",
      count: users.filter((user) => user.role === "loader").length,
      icon: <Truck size={16} />
    },
    {
      id: "updates",
      label: "Atualizações",
      group: "Plataforma",
      icon: <Download size={16} />
    },
    { id: "financeiro", label: "Financeiro", group: "Plataforma", icon: <Wallet size={16} /> },
    { id: "ai", label: "Assistente de IA", group: "Plataforma", icon: <Bot size={16} /> }
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
      key: "fleet",
      header: "Estrutura",
      render: (company) => {
        const companyUnits = units.filter((unit) => unit.companyId === company.id).length;
        const companyDevices = devices.filter(
          (device) =>
            device.companyId === company.id && device.isActive && !isVirtualWebDevice(device.id)
        );
        const online = companyDevices.filter((device) => isOnline(device.lastSeenAt)).length;
        return (
          <>
            <span>
              {companyUnits} unidade{companyUnits === 1 ? "" : "s"}
            </span>
            <p className="adm-cell-sub">
              {companyDevices.length === 0
                ? "Nenhuma balança ativada"
                : `${online} de ${companyDevices.length} balança${companyDevices.length === 1 ? "" : "s"} online`}
            </p>
          </>
        );
      }
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
            Sem chave
          </Badge>
        )
    },
    {
      key: "status",
      header: "Situação",
      render: (company) => (
        <>
          {company.isActive ? (
            <Badge tone="ok" dot>
              Ativa
            </Badge>
          ) : (
            <Badge tone="danger" dot>
              Inativa
            </Badge>
          )}
          <p className="adm-cell-sub">desde {formatDate(company.createdAt)}</p>
        </>
      )
    },
    {
      key: "actions",
      header: "",
      actions: true,
      render: (company) => (
        <ButtonGroup>
          <Button size="sm" onClick={() => setEditingCompany(company)}>
            Editar
          </Button>
          <RowMenu
            label={`Mais ações de ${company.name}`}
            items={[
              { label: "Ver balanças", onClick: () => navigateTo("devices", company.id) },
              {
                label: "Ver credenciais",
                onClick: () => void handleRevealCredentials({ type: "company", id: company.id })
              },
              {
                label: company.isActive ? "Desativar pedreira" : "Ativar pedreira",
                onClick: () =>
                  void run(
                    "toggle_company",
                    { companyId: company.id, isActive: !company.isActive },
                    company.isActive
                      ? "Pedreira desativada. Os desktops dela perdem o acesso."
                      : "Pedreira ativada."
                  )
              },
              {
                label: "Excluir pedreira",
                tone: "danger",
                onClick: () =>
                  setConfirmDelete({ type: "company", id: company.id, name: company.name })
              }
            ]}
          />
        </ButtonGroup>
      )
    }
  ];

  const unitColumns: Array<Column<Unit>> = [
    {
      key: "name",
      header: "Unidade",
      render: (unit) => (
        <>
          <span className="adm-cell-primary">{unit.name}</span>
          <p className="adm-cell-sub">{companyName(unit.companyId)}</p>
        </>
      )
    },
    {
      key: "devices",
      header: "Balanças",
      numeric: true,
      render: (unit) =>
        devices.filter((device) => device.unitId === unit.id && !isVirtualWebDevice(device.id))
          .length
    },
    {
      key: "users",
      header: "Logins",
      numeric: true,
      render: (unit) => users.filter((user) => user.unitId === unit.id).length
    },
    {
      key: "status",
      header: "Situação",
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
          <Button size="sm" onClick={() => setEditingUnit(unit)}>
            Editar
          </Button>
          <RowMenu
            label={`Mais ações de ${unit.name}`}
            items={[
              {
                label: "Ver credenciais da pedreira",
                onClick: () => void handleRevealCredentials({ type: "company", id: unit.companyId })
              },
              {
                label: unit.isActive ? "Desativar unidade" : "Ativar unidade",
                onClick: () =>
                  void run(
                    "toggle_unit",
                    { unitId: unit.id, isActive: !unit.isActive },
                    unit.isActive ? "Unidade desativada." : "Unidade ativada."
                  )
              },
              {
                label: "Excluir unidade",
                tone: "danger",
                onClick: () => setConfirmDelete({ type: "unit", id: unit.id, name: unit.name })
              }
            ]}
          />
        </ButtonGroup>
      )
    }
  ];

  /** Menu "⋯" de um login: o que nao e do dia a dia. */
  function userMenuItems(user: LoaderUser, roleLabel: string): MenuItem[] {
    return [
      { label: "Trocar senha", onClick: () => setResettingPasswordUser(user) },
      {
        label: "Ver credenciais",
        onClick: () => void handleRevealCredentials({ type: "user", id: user.id })
      },
      {
        label: user.isActive ? "Bloquear acesso" : "Liberar acesso",
        onClick: () =>
          void run(
            "toggle_loader",
            { userId: user.id, isActive: !user.isActive },
            user.isActive ? "Acesso bloqueado." : "Acesso liberado."
          )
      },
      {
        label: "Excluir login",
        tone: "danger",
        onClick: () => setConfirmDelete({ type: "user", id: user.id, name: user.name, roleLabel })
      }
    ];
  }

  function userColumns(role: "loader" | "comercial"): Array<Column<LoaderUser>> {
    const roleLabel = role === "comercial" ? "Comercial" : "Carregador";
    return [
      {
        key: "name",
        header: "Usuário",
        render: (user) => (
          <>
            <span className="adm-cell-primary">{user.name}</span>
            <p className="adm-cell-sub">{user.email}</p>
          </>
        )
      },
      ...(role === "comercial"
        ? [
            {
              key: "role",
              header: "Perfil",
              render: (user: LoaderUser) => {
                const rule = pricePasswordRule(user.role);
                const asksPrice =
                  rule === "always" || (rule === "flag" && user.requiresPricePassword);
                return (
                  <>
                    <Badge tone="info">{USER_ROLE_LABELS[user.role]}</Badge>
                    <p className="adm-cell-sub">
                      {asksPrice ? "Pede senha de preço" : "Muda preço sem senha"}
                    </p>
                  </>
                );
              }
            }
          ]
        : []),
      {
        key: "unit",
        header: "Pedreira",
        render: (user) => {
          const device = user.deviceId
            ? devices.find((candidate) => candidate.id === user.deviceId)
            : undefined;
          return (
            <>
              <span>{companyName(user.companyId)}</span>
              <p className="adm-cell-sub">
                {unitName(user.unitId)}
                {user.deviceId ? ` · computador ${device?.name ?? "removido"}` : ""}
              </p>
            </>
          );
        }
      },
      {
        key: "status",
        header: "Situação",
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
            <Button size="sm" onClick={() => setEditingUser(user)}>
              Editar
            </Button>
            <RowMenu label={`Mais ações de ${user.name}`} items={userMenuItems(user, roleLabel)} />
          </ButtonGroup>
        )
      }
    ];
  }

  const deviceColumns: Array<Column<Device>> = [
    {
      key: "name",
      header: "Balança",
      render: (device) => {
        const virtual = isVirtualWebDevice(device.id);
        return (
          <>
            <span className="adm-cell-primary">
              {virtual ? "Site (KyberRock Web)" : device.name}
            </span>
            <p className="adm-cell-sub">
              {companyName(device.companyId)} · {unitName(device.unitId)}
            </p>
            <div className="adm-tags">
              {virtual && <span className="adm-tag">Dispositivo virtual do site</span>}
              {!virtual && device.isPriceMaster && (
                <span className="adm-tag adm-tag-accent" title="Define os preços da pedreira">
                  Principal de preços
                </span>
              )}
              {!virtual && device.executesWebOperations && (
                <span className="adm-tag" title="Registra as pesagens pedidas pelo site">
                  Pesagens do site
                </span>
              )}
              {!virtual && device.updateChannel === "beta" && (
                <span className="adm-tag adm-tag-warn" title="Recebe versões em avaliação">
                  Anel de teste
                </span>
              )}
            </div>
          </>
        );
      }
    },
    {
      key: "health",
      header: "Saúde",
      /**
       * O que esta balanca esta ENTREGANDO — a pergunta que "ultimo contato" e "versao" nunca
       * responderam. A classificacao inteira vive em `lib/device-health.ts`, pura e testada.
       */
      render: (device) => {
        if (isVirtualWebDevice(device.id)) return <span className="adm-cell-sub">—</span>;
        if (!device.isActive) {
          return (
            <Badge tone="danger" dot>
              Bloqueada
            </Badge>
          );
        }
        const health = deviceHealth(device);
        return (
          <div className="adm-health" title={health.detail}>
            <Badge tone={HEALTH_TONES[health.level]} dot={health.level !== "unknown"}>
              {health.label}
            </Badge>
            {health.level !== "ok" && <p className="adm-cell-sub adm-clamp">{health.detail}</p>}
          </div>
        );
      }
    },
    {
      key: "lastSeen",
      header: "Contato",
      render: (device) =>
        isVirtualWebDevice(device.id) ? (
          <span className="adm-cell-sub">—</span>
        ) : (
          <>
            <span className={isOnline(device.lastSeenAt) ? "adm-online" : undefined}>
              {isOnline(device.lastSeenAt) ? "Online" : sinceLabel(device.lastSeenAt)}
            </span>
            <p className="adm-cell-sub adm-mono">{formatDateTime(device.lastSeenAt)}</p>
          </>
        )
    },
    {
      // Login do KyberRock Web deste acesso: e com ele que a pessoa daquele computador entra
      // no site — inclusive depois que o desktop dela for desligado na virada.
      key: "login",
      header: "Login do site",
      render: (device) => {
        if (isVirtualWebDevice(device.id)) return <span className="adm-cell-sub">—</span>;
        const login = users.find((user) => user.deviceId === device.id);
        if (!login) {
          return (
            <Button size="sm" onClick={() => setCreatingLoginFor(device)}>
              Criar login
            </Button>
          );
        }
        return (
          <>
            <span className="adm-truncate" title={login.email}>
              {login.email}
            </span>
            <p className="adm-cell-sub">
              {USER_ROLE_LABELS[login.role]}
              {!login.isActive && " · bloqueado"}
            </p>
          </>
        );
      }
    },
    {
      key: "actions",
      header: "",
      actions: true,
      render: (device) => {
        const virtual = isVirtualWebDevice(device.id);
        const login = users.find((user) => user.deviceId === device.id);
        const items: MenuItem[] = [
          ...(virtual ? [] : [{ label: "Renomear", onClick: () => setRenamingDevice(device) }]),
          ...(login
            ? [{ label: "Trocar senha do login", onClick: () => setResettingPasswordUser(login) }]
            : []),
          {
            label: "Ver credenciais",
            onClick: () => void handleRevealCredentials({ type: "device", id: device.id })
          },
          {
            label: device.isActive ? "Bloquear balança" : "Liberar balança",
            onClick: () =>
              void run(
                "toggle_device",
                { deviceId: device.id, isActive: !device.isActive },
                device.isActive ? "Balança bloqueada." : "Balança liberada."
              )
          },
          {
            label: "Excluir",
            tone: "danger",
            onClick: () => setConfirmDelete({ type: "device", id: device.id, name: device.name })
          }
        ];
        return (
          <ButtonGroup>
            {!virtual && (
              <Button size="sm" onClick={() => setConfiguringDevice(device)}>
                Configurar
              </Button>
            )}
            <RowMenu label={`Mais ações de ${device.name}`} items={items} />
          </ButtonGroup>
        );
      }
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
      header: "Código ativo",
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
      handleError(error, "Não foi possível gerar o código de ativação.");
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
      handleError(error, "Não foi possível carregar as credenciais.");
    } finally {
      setCredentialsLoading(false);
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!confirmDelete || isDeleting) return;
    setIsDeleting(true);
    const { action, payload } = buildDeleteRequest(confirmDelete);
    const ok = await run(action, payload, "Registro excluído.");
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
          {section === "overview" && (
            <Overview
              companies={companies}
              units={units}
              users={users}
              devices={devices}
              isRefreshing={isLoading}
              onRefresh={() => void loadData()}
              onNavigate={navigateTo}
              onCreateCompany={() => setCreating("company")}
              onSessionExpired={() => void logout()}
            />
          )}

          {section === "companies" && (
            <>
              <PageHead
                title="Pedreiras"
                description="Empresas clientes da plataforma. Desativar uma pedreira bloqueia todos os desktops dela."
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
                description="Cada pedreira pode ter mais de uma unidade. A fila do carregador é por unidade."
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
                title={section === "comercial" ? "Usuários do site" : "Carregadores"}
                description={
                  section === "comercial"
                    ? "Logins do KyberRock Web e o perfil de cada um. Em Editar você troca perfil, unidade e senha de preço."
                    : "Entram no KyberRock Web e veem só a fila de carregamento da unidade deles."
                }
                actions={
                  <Button
                    variant="primary"
                    onClick={() => setCreating(section === "comercial" ? "comercial" : "loader")}
                  >
                    {section === "comercial" ? "Novo usuário do site" : "Novo carregador"}
                  </Button>
                }
              />
              <Panel flush toolbar={filterToolbar}>
                <DataTable
                  columns={userColumns(section === "comercial" ? "comercial" : "loader")}
                  rows={usersByRole(section === "comercial" ? "comercial" : "loader")}
                  rowKey={(user) => user.id}
                  rowClassName={inactiveRow}
                  empty="Nenhum usuário encontrado."
                />
              </Panel>
            </>
          )}

          {section === "devices" && (
            <>
              <PageHead
                title="Balanças e acessos"
                description="Os computadores das pedreiras, a saúde de cada um e o login do site de quem usa. Em Configurar ficam unidade, preços, atualização e pesagens do site."
              />
              {generatedCode && (
                <Note tone="ok">
                  Código gerado: <strong className="adm-mono">{generatedCode}</strong>. Envie ao
                  operador do desktop — ele vale apenas para a ativação inicial.{" "}
                  <Button size="sm" onClick={() => setGeneratedCode(null)}>
                    Fechar
                  </Button>
                </Note>
              )}
              <Panel
                title="Computadores cadastrados"
                flush
                toolbar={
                  <>
                    <div className="adm-chips" role="group" aria-label="Filtrar balanças">
                      {(Object.keys(DEVICE_FILTER_LABELS) as DeviceFilter[]).map((key) => (
                        <button
                          key={key}
                          type="button"
                          className="adm-chip"
                          aria-pressed={deviceFilter === key}
                          onClick={() => setDeviceFilter(key)}
                        >
                          {DEVICE_FILTER_LABELS[key]}
                          {key === "attention" && devicesNeedingAttention > 0 && (
                            <span className="adm-chip-count">{devicesNeedingAttention}</span>
                          )}
                        </button>
                      ))}
                    </div>
                    {filterToolbar}
                  </>
                }
              >
                <DataTable
                  columns={deviceColumns}
                  rows={filteredDevices}
                  rowKey={(device) => device.id}
                  rowClassName={inactiveRow}
                  empty={
                    devices.length === 0
                      ? "Nenhum desktop ativado ainda."
                      : deviceFilter === "attention"
                        ? "Nenhuma balança precisando de atenção."
                        : "Nenhum desktop encontrado com os filtros atuais."
                  }
                />
              </Panel>
              <Panel
                title="Códigos de ativação"
                description="Um código por pedreira, para ativar um computador novo. Gerar outro invalida o anterior."
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
          onSubmit={async (payload) => {
            const ok = await run(
              "update_company",
              { companyId: editingCompany.id, ...payload },
              "Pedreira atualizada."
            );
            if (!ok) return;
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

      {configuringDevice && (
        <DeviceSettingsModal
          device={configuringDevice}
          companyLabel={companyName(configuringDevice.companyId)}
          units={units.filter((unit) => unit.companyId === configuringDevice.companyId)}
          login={users.find((user) => user.deviceId === configuringDevice.id) ?? null}
          otherPriceMasters={priceMasterNames(configuringDevice.companyId).filter(
            (name) => name !== configuringDevice.name
          )}
          onClose={() => setConfiguringDevice(null)}
          onSave={async (steps) => {
            const ok = await runBatch(steps, `${configuringDevice.name} atualizada.`);
            if (ok) setConfiguringDevice(null);
          }}
          onCreateLogin={() => {
            setCreatingLoginFor(configuringDevice);
            setConfiguringDevice(null);
          }}
          onChangePassword={(login) => {
            setResettingPasswordUser(login);
            setConfiguringDevice(null);
          }}
        />
      )}

      {editingUser && (
        <UserEditModal
          user={editingUser}
          units={units}
          companyName={companyName}
          deviceName={
            editingUser.deviceId
              ? (devices.find((device) => device.id === editingUser.deviceId)?.name ?? "removido")
              : null
          }
          onClose={() => setEditingUser(null)}
          onSave={async (steps) => {
            const ok = await runBatch(steps, `${editingUser.name} atualizado.`);
            if (ok) setEditingUser(null);
          }}
          onChangePassword={() => {
            setResettingPasswordUser(editingUser);
            setEditingUser(null);
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
              `Balança renomeada para "${name}". Os computadores da pedreira já estão exibindo o novo nome.`
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
            const ok = await run("create_loader", payload, "Usuário criado.");
            if (ok) setCreating(null);
          }}
        />
      )}

      {creatingLoginFor && (
        <DeviceLoginModal
          device={creatingLoginFor}
          onClose={() => setCreatingLoginFor(null)}
          onSubmit={async (payload) => {
            const ok = await run(
              "create_loader",
              { ...payload, deviceId: creatingLoginFor.id },
              `Login do site criado para ${creatingLoginFor.name}.`
            );
            if (ok) setCreatingLoginFor(null);
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
          title="Confirmar exclusão"
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
          Credenciais em texto. Confira quem está olhando a tela antes de continuar.
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
  onSubmit: (payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const formId = "company-form";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

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

    void onSubmit(payload);
  }

  return (
    <Modal
      title={title}
      description="Valor acertado, datas do ciclo e dados do boleto ficam na seção Financeiro."
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
        <Fieldset legend="Identificação">
          <div className="adm-grid">
            <Field label="Nome fantasia">
              <input className="adm-input" name="name" defaultValue={company?.name} required />
            </Field>
            <Field label="Razão social">
              <input
                className="adm-input"
                name="legalName"
                defaultValue={company?.legalName}
                required
              />
            </Field>
            <Field
              label="CNPJ"
              hint="Serve de padrão para o boleto quando o cadastro de cobrança não tiver documento próprio."
            >
              <input
                className="adm-input adm-input-mono"
                name="document"
                defaultValue={company?.document}
              />
            </Field>
          </div>
        </Fieldset>

        <Fieldset legend="Integração OMIE">
          {company && (
            <p className="adm-field-hint">
              {company.omieAppKeyMasked
                ? `Configurado (App Key ${company.omieAppKeyMasked}). Deixe vazio para manter.`
                : "Não configurado. Os desktops desta pedreira não conectam ao OMIE."}
            </p>
          )}
          <div className="adm-grid">
            <Field label="App Key">
              <input className="adm-input adm-input-mono" name="omieAppKey" autoComplete="off" />
            </Field>
            <Field
              label="App Secret"
              hint={company ? "Vazio mantém; salve os dois vazios para limpar." : undefined}
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
          hint={`Como esta balança aparece para todos. Até ${DEVICE_NAME_MAX_LENGTH} caracteres.`}
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
          — na legenda de cores e no responsável de cada operação. Nenhuma balança precisa ser
          reativada, e as operações já registradas continuam as mesmas.
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
      title={role === "comercial" ? "Novo usuário do site" : "Novo carregador"}
      description={
        role === "comercial"
          ? "Acessa os relatórios de venda da pedreira."
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
            role: role === "comercial" ? (form.get("role") ?? "comercial") : role
          });
        }}
      >
        <Field label="Nome completo">
          <input className="adm-input" name="name" required autoFocus />
        </Field>
        {role === "comercial" && <RoleField defaultValue="comercial" />}
        <Field label="E-mail">
          <input className="adm-input" name="email" type="email" required />
        </Field>
        <Field label="Senha" hint="Mínimo de 6 caracteres. Anote antes de repassar ao usuário.">
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

/** Seletor de perfil do site com o que cada um pode, logo abaixo. */
function RoleField({ defaultValue }: { defaultValue: UserRole }) {
  const [value, setValue] = useState<UserRole>(defaultValue);
  const hint = SITE_ROLE_OPTIONS.find((option) => option.value === value)?.hint;
  return (
    <Field label="Perfil" hint={hint}>
      <select
        className="adm-select"
        name="role"
        value={value}
        onChange={(event) => setValue(parseUserRole(event.target.value))}
      >
        {SITE_ROLE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

type AdminStep = { action: string; payload: Record<string, unknown> };

/**
 * "Pede senha para mudar preco": quem estiver marcado digita a senha de alteracao de preco da
 * pedreira (a mesma da balanca) para mudar preco pelo site — da pesagem e do cadastro. Na
 * operacao e no administrador quem decide e o perfil, e a caixa so mostra a regra.
 */
function PricePasswordCheck({
  role,
  checked,
  onChange
}: {
  role: UserRole;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const rule = pricePasswordRule(role);
  return (
    <label className="adm-check">
      <input
        type="checkbox"
        checked={rule === "flag" ? checked : rule === "always"}
        disabled={rule !== "flag"}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {rule === "always"
          ? "Sempre pede a senha de preço (regra do perfil Operação)"
          : rule === "never"
            ? "Muda preço sem senha (regra do perfil)"
            : "Pede a senha de preço para mudar preço"}
      </span>
    </label>
  );
}

/** Perfil do site, com o que cada um pode logo abaixo. O carregador so aparece para quem ja e. */
function RolePicker({
  value,
  allowLoader,
  onChange
}: {
  value: UserRole;
  allowLoader: boolean;
  onChange: (role: UserRole) => void;
}) {
  const hint =
    value === "loader"
      ? "Só a fila de carregamento da unidade."
      : SITE_ROLE_OPTIONS.find((option) => option.value === value)?.hint;
  return (
    <Field label="Perfil" hint={hint}>
      <select
        className="adm-select"
        value={value}
        onChange={(event) => onChange(parseUserRole(event.target.value))}
      >
        {allowLoader && <option value="loader">Carregador</option>}
        {SITE_ROLE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Uma linha de configuracao: o que e, por que importa, e o controle ao lado. */
function SettingRow({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="adm-setting">
      <div className="adm-setting-text">
        <p className="adm-setting-title">{title}</p>
        <p className="adm-setting-desc">{description}</p>
      </div>
      <div className="adm-setting-control">{children}</div>
    </div>
  );
}

/**
 * Tudo o que se ajusta numa balanca, num lugar so. Antes eram quatro caixas de selecao na
 * propria linha da tabela, cada uma gravando no ato; aqui a pessoa le o que cada escolha faz,
 * muda o que quiser e salva uma vez. Cada campo alterado vira a MESMA acao do `admin-api` de
 * sempre (`update_device_unit`, `update_device_web_executor`, `update_device_channel`,
 * `update_device_price_master`, `update_user_role`, `update_user_price_password`).
 */
function DeviceSettingsModal({
  device,
  companyLabel,
  units,
  login,
  otherPriceMasters,
  onClose,
  onSave,
  onCreateLogin,
  onChangePassword
}: {
  device: Device;
  companyLabel: string;
  units: Unit[];
  login: LoaderUser | null;
  otherPriceMasters: string[];
  onClose: () => void;
  onSave: (steps: AdminStep[]) => Promise<void>;
  onCreateLogin: () => void;
  onChangePassword: (login: LoaderUser) => void;
}) {
  const [unitId, setUnitId] = useState(device.unitId);
  const [executes, setExecutes] = useState(device.executesWebOperations);
  const [channel, setChannel] = useState<DeviceUpdateChannel>(device.updateChannel);
  const [isMaster, setIsMaster] = useState(device.isPriceMaster);
  const [role, setRole] = useState<UserRole>(login?.role ?? "monitoramento");
  const [asksPrice, setAsksPrice] = useState(login?.requiresPricePassword ?? false);
  const [saving, setSaving] = useState(false);

  const steps: AdminStep[] = [];
  if (unitId !== device.unitId) {
    steps.push({ action: "update_device_unit", payload: { deviceId: device.id, unitId } });
  }
  if (executes !== device.executesWebOperations) {
    steps.push({
      action: "update_device_web_executor",
      payload: { deviceId: device.id, executes }
    });
  }
  if (channel !== device.updateChannel) {
    steps.push({
      action: "update_device_channel",
      payload: { deviceId: device.id, updateChannel: channel }
    });
  }
  if (isMaster !== device.isPriceMaster) {
    steps.push({
      action: "update_device_price_master",
      payload: { deviceId: device.id, isPriceMaster: isMaster }
    });
  }
  if (login && role !== login.role) {
    steps.push({ action: "update_user_role", payload: { userId: login.id, role } });
  }
  if (login && pricePasswordRule(role) === "flag" && asksPrice !== login.requiresPricePassword) {
    steps.push({
      action: "update_user_price_password",
      payload: { userId: login.id, requiresPricePassword: asksPrice }
    });
  }

  const masterHint = isMaster
    ? otherPriceMasters.length > 0
      ? `Define os preços junto com ${otherPriceMasters.join(", ")}.`
      : "Só esta balança define os preços; as outras da pedreira espelham."
    : otherPriceMasters.length > 0
      ? `Espelha os preços de ${otherPriceMasters.join(", ")}.`
      : "Nenhuma balança principal: cada uma publica o próprio cadastro de preço.";

  return (
    <Modal
      title={`Configurar ${device.name}`}
      description={companyLabel}
      onClose={onClose}
      footer={
        <>
          <span className="adm-modal-foot-note">
            {steps.length === 0
              ? "Nenhuma alteração"
              : `${steps.length} ${steps.length > 1 ? "alterações" : "alteração"} para salvar`}
          </span>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={steps.length === 0 || saving}
            onClick={() => {
              setSaving(true);
              void onSave(steps).finally(() => setSaving(false));
            }}
          >
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </>
      }
    >
      <div className="adm-settings">
        <SettingRow
          title="Unidade"
          description="Onde esta balança opera. A fila do carregador e os relatórios são por unidade."
        >
          <select
            className="adm-select"
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
          >
            {!units.some((unit) => unit.id === device.unitId) && (
              <option value={device.unitId}>Unidade removida</option>
            )}
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow title="Preços" description={masterHint}>
          <div className="adm-segment" role="radiogroup" aria-label="Preços">
            <button
              type="button"
              role="radio"
              aria-checked={isMaster}
              onClick={() => setIsMaster(true)}
            >
              Define os preços
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!isMaster}
              onClick={() => setIsMaster(false)}
            >
              Espelha
            </button>
          </div>
        </SettingRow>

        <SettingRow
          title="Pesagens pedidas pelo site"
          description="A balança executora registra as pesagens pedidas pelo KyberRock Web e imprime o cupom. Uma por unidade: marcar esta desmarca a anterior."
        >
          <label className="adm-switch">
            <input
              type="checkbox"
              checked={executes}
              onChange={(event) => setExecutes(event.target.checked)}
            />
            <span>{executes ? "Executa" : "Não executa"}</span>
          </label>
        </SettingRow>

        <SettingRow
          title="Atualização do desktop"
          description={
            channel === "beta"
              ? "Recebe as versões em avaliação antes da frota."
              : "Só recebe versão já liberada para produção."
          }
        >
          <div className="adm-segment" role="radiogroup" aria-label="Atualização">
            <button
              type="button"
              role="radio"
              aria-checked={channel === "latest"}
              onClick={() => setChannel("latest")}
            >
              Produção
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={channel === "beta"}
              onClick={() => setChannel("beta")}
            >
              Teste
            </button>
          </div>
        </SettingRow>
      </div>

      <div className="adm-settings-group">
        <p className="adm-settings-group-title">Login do site de quem usa este computador</p>
        {login ? (
          <div className="adm-form">
            <div className="adm-login-summary">
              <div>
                <p className="adm-cell-primary">{login.email}</p>
                <p className="adm-cell-sub">
                  {login.name}
                  {!login.isActive && " · acesso bloqueado"}
                </p>
              </div>
              <Button size="sm" onClick={() => onChangePassword(login)}>
                Trocar senha
              </Button>
            </div>
            <RolePicker value={role} allowLoader={login.role === "loader"} onChange={setRole} />
            <PricePasswordCheck role={role} checked={asksPrice} onChange={setAsksPrice} />
          </div>
        ) : (
          <div className="adm-login-summary">
            <p className="adm-cell-sub">
              Este computador ainda não tem login. Com ele, a pessoa entra no KyberRock Web.
            </p>
            <Button size="sm" variant="primary" onClick={onCreateLogin}>
              Criar login
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Editar um login: perfil, unidade e senha de preco, salvos de uma vez. */
function UserEditModal({
  user,
  units,
  companyName,
  deviceName,
  onClose,
  onSave,
  onChangePassword
}: {
  user: LoaderUser;
  units: Unit[];
  companyName: (companyId: string) => string;
  deviceName: string | null;
  onClose: () => void;
  onSave: (steps: AdminStep[]) => Promise<void>;
  onChangePassword: () => void;
}) {
  const [role, setRole] = useState<UserRole>(user.role);
  const [unitId, setUnitId] = useState(user.unitId);
  const [asksPrice, setAsksPrice] = useState(user.requiresPricePassword);
  const [saving, setSaving] = useState(false);

  const steps: AdminStep[] = [];
  if (role !== user.role) {
    steps.push({ action: "update_user_role", payload: { userId: user.id, role } });
  }
  if (unitId !== user.unitId) {
    steps.push({ action: "update_loader_unit", payload: { userId: user.id, unitId } });
  }
  if (pricePasswordRule(role) === "flag" && asksPrice !== user.requiresPricePassword) {
    steps.push({
      action: "update_user_price_password",
      payload: { userId: user.id, requiresPricePassword: asksPrice }
    });
  }

  return (
    <Modal
      title={`Editar ${user.name}`}
      description={user.email}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={steps.length === 0 || saving}
            onClick={() => {
              setSaving(true);
              void onSave(steps).finally(() => setSaving(false));
            }}
          >
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </>
      }
    >
      <div className="adm-form">
        <RolePicker value={role} allowLoader={user.role === "loader"} onChange={setRole} />
        <Field label="Unidade" hint={deviceName ? `Login do computador ${deviceName}.` : undefined}>
          <select
            className="adm-select"
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
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
        </Field>
        {role !== "loader" && (
          <PricePasswordCheck role={role} checked={asksPrice} onChange={setAsksPrice} />
        )}
        <div className="adm-login-summary">
          <p className="adm-cell-sub">A senha atual não pode ser exibida, só trocada.</p>
          <Button size="sm" onClick={onChangePassword}>
            Trocar senha
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Cria o login do site de um acesso do sistema. A unidade e a pedreira vem do proprio
 * computador cadastrado; o nome ja vem preenchido com o dele.
 */
function DeviceLoginModal({
  device,
  onClose,
  onSubmit
}: {
  device: Device;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const formId = "device-login-form";
  return (
    <Modal
      title={`Login do site — ${device.name}`}
      description="É com este e-mail e senha que a pessoa deste computador entra no KyberRock Web."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" form={formId}>
            Criar login
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
            name: form.get("name"),
            email: form.get("email"),
            password: form.get("password"),
            role: form.get("role")
          });
        }}
      >
        <Field label="Nome" hint="Quem usa este computador. Aparece no rodapé do site.">
          <input className="adm-input" name="name" required defaultValue={device.name} />
        </Field>
        <RoleField defaultValue="monitoramento" />
        <Field label="E-mail">
          <input className="adm-input" name="email" type="email" required autoFocus />
        </Field>
        <Field label="Senha" hint="Mínimo de 6 caracteres. Anote antes de repassar.">
          <PasswordInput name="password" required minLength={6} />
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
          A senha atual não pode ser exibida — o Supabase Auth guarda apenas o hash dela. Defina uma
          nova aqui e repasse ao usuário.
        </Note>
        <Field label="Nova senha">
          <PasswordInput name="password" required minLength={6} autoFocus />
        </Field>
      </form>
    </Modal>
  );
}
