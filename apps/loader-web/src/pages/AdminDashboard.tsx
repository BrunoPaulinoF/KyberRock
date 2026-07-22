import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { AdminSessionExpiredError, callAdminFunction } from "../lib/admin-api";

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

interface Device {
  id: string;
  companyId: string;
  unitId: string;
  name: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const TWO_COLUMN_GRID = "repeat(auto-fit, minmax(min(100%, 320px), 1fr))";
const COMPACT_GRID = "repeat(auto-fit, minmax(min(100%, 240px), 1fr))";
const MODAL_Z_INDEX = 1200;

/**
 * Copia o codigo de ativacao com feedback fiel. navigator.clipboard e undefined em contexto nao
 * seguro (HTTP puro, plausivel atras de proxy interno) e a escrita e assincrona: a versao antiga
 * podia lancar TypeError e sempre mostrava "Codigo copiado!" mesmo quando a copia falhava. Aqui
 * so confirmamos apos o sucesso e caimos para copia manual (prompt) quando a API nao esta disponivel.
 */
async function copyActivationCode(code: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
      alert("Codigo copiado!");
      return;
    }
  } catch {
    // cai para a copia manual abaixo
  }
  window.prompt("Copie o codigo de ativacao:", code);
}

export function AdminDashboard() {
  const { logout } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [users, setUsers] = useState<LoaderUser[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [activeTab, setActiveTab] = useState<"companies" | "loaders" | "comercial" | "devices">(
    "companies"
  );
  // Filtro por pedreira (empresa) aplicado as listagens de todas as abas. "" = todas.
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    type: "company" | "unit";
    id: string;
    name: string;
  } | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  // Sessao expirou no meio do uso: desloga (o guard PrivateAdminRoute redireciona para
  // /admin/login quando isAdmin vira false). Sem isto, callAdminFunction lancava e o dashboard
  // ficava renderizado com todas as listas vazias, sem erro nem redirect ("parece que apagou tudo").
  function handleAdminError(error: unknown): boolean {
    if (error instanceof AdminSessionExpiredError) {
      void logout();
      return true;
    }
    return false;
  }

  async function loadData() {
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
          lastSeenAt: device.last_seen_at,
          createdAt: device.created_at,
          updatedAt: device.updated_at
        }))
      );
    } catch (error) {
      if (!handleAdminError(error)) {
        console.error("Error loading data:", error);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const omieAppKey = String(formData.get("omieAppKey") ?? "").trim();
    const omieAppSecret = String(formData.get("omieAppSecret") ?? "").trim();

    try {
      await callAdminFunction("admin-api", {
        action: "create_company",
        payload: {
          name: formData.get("name"),
          legalName: formData.get("legalName"),
          document: formData.get("document"),
          omieAppKey: omieAppKey || null,
          omieAppSecret: omieAppSecret || null
        }
      });
      form.reset();
      await loadData();
    } catch (error) {
      console.error("Error creating company:", error);
      alert("Erro ao criar empresa");
    }
  }

  async function handleToggleCompany(companyId: string, currentStatus: boolean) {
    try {
      await callAdminFunction("admin-api", {
        action: "toggle_company",
        payload: { companyId, isActive: !currentStatus }
      });
      await loadData();
    } catch (error) {
      console.error("Error toggling company:", error);
    }
  }

  async function handleCreateUnit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      await callAdminFunction("admin-api", {
        action: "create_unit",
        payload: {
          companyId: formData.get("companyId"),
          name: formData.get("name")
        }
      });
      form.reset();
      await loadData();
    } catch (error) {
      console.error("Error creating unit:", error);
      alert("Erro ao criar unidade");
    }
  }

  async function handleCreateUser(
    event: React.FormEvent<HTMLFormElement>,
    role: "loader" | "comercial"
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
      await callAdminFunction("admin-api", {
        action: "create_loader",
        payload: {
          email,
          password,
          name: formData.get("name"),
          unitId: formData.get("unitId"),
          role
        }
      });

      form.reset();
      await loadData();
    } catch (error) {
      console.error("Error creating user:", error);
      alert(
        "Erro ao criar usuário: " + (error instanceof Error ? error.message : "Erro desconhecido")
      );
    }
  }

  async function handleToggleUser(userId: string, currentStatus: boolean) {
    try {
      await callAdminFunction("admin-api", {
        action: "toggle_loader",
        payload: { userId, isActive: !currentStatus }
      });
      await loadData();
    } catch (error) {
      console.error("Error toggling user:", error);
    }
  }

  async function handleGenerateActivationCode(companyId: string): Promise<void> {
    try {
      const result = await callAdminFunction<{ code: string }>("admin-api", {
        action: "generate_desktop_activation_code",
        payload: { companyId }
      });
      setGeneratedCode(result.code);
      await loadData();
    } catch (error) {
      console.error("Error generating code:", error);
      alert("Erro ao gerar codigo de ativacao");
    }
  }

  async function handleToggleDevice(deviceId: string, currentStatus: boolean): Promise<void> {
    try {
      await callAdminFunction("admin-api", {
        action: "toggle_device",
        payload: { deviceId, isActive: !currentStatus }
      });
      await loadData();
    } catch (error) {
      console.error("Error toggling device:", error);
    }
  }

  async function handleDeleteCompany(company: Company) {
    setConfirmDelete({ type: "company", id: company.id, name: company.name });
    setConfirmPassword("");
  }

  async function handleConfirmDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmDelete) return;
    try {
      if (confirmDelete.type === "company") {
        await callAdminFunction("admin-api", {
          action: "delete_company",
          payload: { companyId: confirmDelete.id, adminPassword: confirmPassword }
        });
      } else {
        await callAdminFunction("admin-api", {
          action: "delete_unit",
          payload: { unitId: confirmDelete.id, adminPassword: confirmPassword }
        });
      }
      setConfirmDelete(null);
      setConfirmPassword("");
      await loadData();
    } catch (error) {
      console.error("Error deleting:", error);
      alert("Erro ao excluir: " + (error instanceof Error ? error.message : "Erro desconhecido"));
    }
  }

  async function handleUpdateCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCompany) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const omieAppKey = String(formData.get("omieAppKey") ?? "").trim();
    const omieAppSecret = String(formData.get("omieAppSecret") ?? "").trim();
    const priceChangePassword = String(formData.get("priceChangePassword") ?? "").trim();
    const payload: Record<string, unknown> = {
      companyId: editingCompany.id,
      name: formData.get("name"),
      legalName: formData.get("legalName"),
      document: formData.get("document")
    };
    if (omieAppKey) payload.omieAppKey = omieAppKey;
    if (omieAppSecret) payload.omieAppSecret = omieAppSecret;
    try {
      await callAdminFunction("admin-api", { action: "update_company", payload });
      if (priceChangePassword) {
        if (!/^\d{4}$/.test(priceChangePassword)) {
          alert("A senha para alterar precos deve ter exatamente 4 digitos");
          return;
        }
        await callAdminFunction("admin-api", {
          action: "update_company_price_password",
          payload: { companyId: editingCompany.id, priceChangePassword }
        });
      }
      setEditingCompany(null);
      await loadData();
    } catch (error) {
      console.error("Error updating company:", error);
      alert("Erro ao atualizar empresa");
    }
  }

  async function handleUpdateUnit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUnit) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      await callAdminFunction("admin-api", {
        action: "update_unit",
        payload: {
          unitId: editingUnit.id,
          name: formData.get("name")
        }
      });
      setEditingUnit(null);
      await loadData();
    } catch (error) {
      console.error("Error updating unit:", error);
      alert("Erro ao atualizar unidade");
    }
  }

  const filteredCompanies = filterCompanyId
    ? companies.filter((company) => company.id === filterCompanyId)
    : companies;
  const filteredUnits = filterCompanyId
    ? units.filter((unit) => unit.companyId === filterCompanyId)
    : units;
  const filteredDevices = filterCompanyId
    ? devices.filter((device) => device.companyId === filterCompanyId)
    : devices;

  function filteredUsersByRole(role: "loader" | "comercial"): LoaderUser[] {
    return users.filter(
      (user) => user.role === role && (!filterCompanyId || user.companyId === filterCompanyId)
    );
  }

  function renderUsersTab(role: "loader" | "comercial") {
    const roleLabel = role === "comercial" ? "Comercial" : "Carregador";
    const roleUsers = filteredUsersByRole(role);
    return (
      <section style={{ display: "grid", gridTemplateColumns: TWO_COLUMN_GRID, gap: "24px" }}>
        <article style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
          <h2 style={{ margin: "0 0 16px 0" }}>
            {role === "comercial" ? "Usuarios Comerciais" : "Usuarios Carregadores"}
          </h2>
          {roleUsers.length === 0 && (
            <p style={{ color: "#64748b" }}>
              {filterCompanyId
                ? `Nenhum usuario ${roleLabel.toLowerCase()} nesta pedreira.`
                : `Nenhum usuario ${roleLabel.toLowerCase()} cadastrado.`}
            </p>
          )}
          {roleUsers.map((user) => (
            <div key={user.id} style={{ padding: "12px 0", borderBottom: "1px solid #e2e8f0" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <div>
                  <strong>{user.name}</strong>
                  <p style={{ margin: "2px 0 0 0", fontSize: "14px", color: "#64748b" }}>
                    {user.email}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      background: user.isActive ? "#dcfce7" : "#fee2e2",
                      color: user.isActive ? "#166534" : "#991b1b"
                    }}
                  >
                    {user.isActive ? "Ativo" : "Inativo"}
                  </span>
                  <button
                    onClick={() => handleToggleUser(user.id, user.isActive)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      background: "#fff",
                      cursor: "pointer",
                      fontSize: "12px"
                    }}
                  >
                    {user.isActive ? "Bloquear" : "Liberar"}
                  </button>
                </div>
              </div>
              <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                Pedreira: {companies.find((c) => c.id === user.companyId)?.name || "N/A"} | Unidade:{" "}
                {units.find((u) => u.id === user.unitId)?.name || "N/A"}
              </p>
            </div>
          ))}
        </article>

        <article style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
          <h2 style={{ margin: "0 0 16px 0" }}>
            {role === "comercial" ? "Novo Usuario Comercial" : "Novo Carregador"}
          </h2>
          <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#64748b" }}>
            {role === "comercial"
              ? "Acessa os relatorios de venda da pedreira."
              : "Acessa a fila de carregamento da unidade."}
          </p>
          <form
            onSubmit={(event) => handleCreateUser(event, role)}
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <input
              name="name"
              placeholder="Nome completo"
              required
              style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
            />
            <input
              name="email"
              type="email"
              placeholder="E-mail"
              required
              style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
            />
            <input
              name="password"
              type="password"
              placeholder="Senha"
              required
              minLength={6}
              style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
            />
            <select
              name="unitId"
              required
              style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
            >
              <option value="">Selecione a unidade</option>
              {filteredUnits
                .filter((u) => u.isActive)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {filterCompanyId
                      ? ""
                      : ` — ${companies.find((c) => c.id === u.companyId)?.name ?? ""}`}
                  </option>
                ))}
            </select>
            <button
              type="submit"
              style={{
                padding: "10px",
                borderRadius: "8px",
                border: "none",
                background: "#0f172a",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 700
              }}
            >
              {role === "comercial" ? "Criar Usuario Comercial" : "Criar Carregador"}
            </button>
          </form>
        </article>
      </section>
    );
  }

  return (
    <main className="admin-page">
      <header className="admin-shell-header">
        <div className="admin-brand">
          <img className="admin-logo" src="/kyberrocklogo.png" alt="KyberRock" />
          <div>
            <h1 className="admin-title">KyberRock Admin</h1>
            <p className="admin-subtitle">Gerenciamento de pedreiras, unidades e acessos</p>
          </div>
        </div>
        <button onClick={logout} className="secondary-action">
          Sair
        </button>
      </header>

      <nav className="admin-tabs" aria-label="Secoes administrativas">
        <button
          onClick={() => setActiveTab("companies")}
          className={`admin-tab ${activeTab === "companies" ? "admin-tab-active" : ""}`}
        >
          Empresas e Unidades
        </button>
        <button
          onClick={() => setActiveTab("loaders")}
          className={`admin-tab ${activeTab === "loaders" ? "admin-tab-active" : ""}`}
        >
          Carregadores
        </button>
        <button
          onClick={() => setActiveTab("comercial")}
          className={`admin-tab ${activeTab === "comercial" ? "admin-tab-active" : ""}`}
        >
          Comercial
        </button>
        <button
          onClick={() => setActiveTab("devices")}
          className={`admin-tab ${activeTab === "devices" ? "admin-tab-active" : ""}`}
        >
          Dispositivos e Licencas
        </button>
      </nav>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          margin: "0 0 24px 0"
        }}
      >
        <label
          htmlFor="admin-company-filter"
          style={{ fontSize: "14px", fontWeight: 700, color: "#334155" }}
        >
          Filtrar por pedreira
        </label>
        <select
          id="admin-company-filter"
          value={filterCompanyId}
          onChange={(e) => setFilterCompanyId(e.target.value)}
          style={{
            padding: "8px 12px",
            borderRadius: "8px",
            border: "1px solid #cbd5e1",
            background: "#fff",
            minWidth: "220px"
          }}
        >
          <option value="">Todas as pedreiras</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        {filterCompanyId && (
          <button
            type="button"
            onClick={() => setFilterCompanyId("")}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              background: "#fff",
              cursor: "pointer",
              fontSize: "13px"
            }}
          >
            Limpar filtro
          </button>
        )}
      </div>

      {confirmDelete && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: MODAL_Z_INDEX
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: "24px",
              borderRadius: "16px",
              width: "100%",
              maxWidth: "400px"
            }}
          >
            <h3 style={{ margin: "0 0 12px 0", color: "#dc2626" }}>Confirmar exclusao</h3>
            <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#64748b" }}>
              {confirmDelete.type === "company"
                ? `Tem certeza que deseja excluir a empresa "${confirmDelete.name}"? Todas as unidades vinculadas serao excluidas tambem.`
                : `Tem certeza que deseja excluir a unidade "${confirmDelete.name}"?`}
            </p>
            <form
              onSubmit={handleConfirmDelete}
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <input
                type="password"
                placeholder="Senha do administrador"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button
                  type="submit"
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#dc2626",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 700
                  }}
                >
                  Confirmar exclusao
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(null);
                    setConfirmPassword("");
                  }}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    cursor: "pointer"
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isLoading ? (
        <p>Carregando...</p>
      ) : (
        <>
          {activeTab === "companies" && (
            <section style={{ display: "grid", gridTemplateColumns: TWO_COLUMN_GRID, gap: "24px" }}>
              {/* Companies List */}
              <article style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
                <h2 style={{ margin: "0 0 16px 0" }}>Empresas</h2>
                {filteredCompanies.length === 0 && (
                  <p style={{ color: "#64748b" }}>Nenhuma empresa cadastrada.</p>
                )}
                {filteredCompanies.map((company) => (
                  <div
                    key={company.id}
                    style={{ padding: "12px 0", borderBottom: "1px solid #e2e8f0" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}
                    >
                      <div>
                        <strong>{company.name}</strong>
                        <p style={{ margin: "2px 0 0 0", fontSize: "14px", color: "#64748b" }}>
                          {company.legalName}
                        </p>
                        <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#b91c1c" }}>
                          {company.isActive
                            ? "Desativar a empresa bloqueia o acesso de todos os desktops."
                            : "Ativar a empresa libera o acesso de todos os desktops."}
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <span
                          style={{
                            padding: "4px 8px",
                            borderRadius: "6px",
                            fontSize: "12px",
                            background: company.isActive ? "#dcfce7" : "#fee2e2",
                            color: company.isActive ? "#166534" : "#991b1b"
                          }}
                        >
                          {company.isActive ? "Ativa" : "Inativa"}
                        </span>
                        <button
                          onClick={() => handleToggleCompany(company.id, company.isActive)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            cursor: "pointer",
                            fontSize: "12px"
                          }}
                        >
                          {company.isActive ? "Desativar" : "Ativar"}
                        </button>
                        <button
                          onClick={() => setEditingCompany(company)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "6px",
                            border: "1px solid #e2e8f0",
                            background: "#f8fafc",
                            cursor: "pointer",
                            fontSize: "12px"
                          }}
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleDeleteCompany(company)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "6px",
                            border: "1px solid #fecaca",
                            background: "#fef2f2",
                            cursor: "pointer",
                            fontSize: "12px",
                            color: "#dc2626"
                          }}
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                    <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                      Unidades: {units.filter((u) => u.companyId === company.id).length}
                    </p>
                  </div>
                ))}

                {/* Edit Company Modal */}
                {editingCompany && (
                  <div
                    style={{
                      position: "fixed",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: "rgba(0,0,0,0.5)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: MODAL_Z_INDEX
                    }}
                  >
                    <div
                      style={{
                        background: "#fff",
                        padding: "24px",
                        borderRadius: "16px",
                        width: "100%",
                        maxWidth: "500px"
                      }}
                    >
                      <h3 style={{ margin: "0 0 16px 0" }}>Editar Empresa</h3>
                      <form
                        onSubmit={handleUpdateCompany}
                        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
                      >
                        <input
                          name="name"
                          defaultValue={editingCompany.name}
                          placeholder="Nome fantasia"
                          required
                          style={{
                            padding: "10px",
                            borderRadius: "8px",
                            border: "1px solid #cbd5e1"
                          }}
                        />
                        <input
                          name="legalName"
                          defaultValue={editingCompany.legalName}
                          placeholder="Razao social"
                          required
                          style={{
                            padding: "10px",
                            borderRadius: "8px",
                            border: "1px solid #cbd5e1"
                          }}
                        />
                        <input
                          name="document"
                          defaultValue={editingCompany.document}
                          placeholder="CNPJ"
                          style={{
                            padding: "10px",
                            borderRadius: "8px",
                            border: "1px solid #cbd5e1"
                          }}
                        />
                        <div
                          style={{
                            borderTop: "1px solid #e2e8f0",
                            paddingTop: "12px",
                            marginTop: "4px"
                          }}
                        >
                          <strong style={{ fontSize: "13px", color: "#475569" }}>Token OMIE</strong>
                          {editingCompany.omieAppKeyMasked ? (
                            <p style={{ margin: "4px 0", fontSize: "12px", color: "#16a34a" }}>
                              Configurado (App Key: {editingCompany.omieAppKeyMasked})
                            </p>
                          ) : (
                            <p style={{ margin: "4px 0", fontSize: "12px", color: "#d97706" }}>
                              Nao configurado. Os desktops nao conectam ao OMIE.
                            </p>
                          )}
                          <input
                            name="omieAppKey"
                            placeholder="Novo App Key (deixe vazio para manter)"
                            style={{
                              padding: "10px",
                              borderRadius: "8px",
                              border: "1px solid #cbd5e1",
                              marginTop: "8px"
                            }}
                          />
                          <input
                            name="omieAppSecret"
                            type="password"
                            placeholder="Novo App Secret (deixe vazio para manter)"
                            style={{
                              padding: "10px",
                              borderRadius: "8px",
                              border: "1px solid #cbd5e1",
                              marginTop: "8px"
                            }}
                          />
                          <small style={{ color: "#64748b" }}>
                            Ao preencher, o app key/secret e atualizado. Para limpar, salve com
                            campos vazios.
                          </small>
                        </div>
                        <div
                          style={{
                            borderTop: "1px solid #e2e8f0",
                            paddingTop: "12px",
                            marginTop: "4px"
                          }}
                        >
                          <strong style={{ fontSize: "13px", color: "#475569" }}>
                            Senha para alterar precos
                          </strong>
                          <p style={{ margin: "4px 0", fontSize: "12px", color: "#64748b" }}>
                            Senha de 4 digitos que o operador deve informar no desktop para alterar
                            precos padrao.
                          </p>
                          <input
                            name="priceChangePassword"
                            type="password"
                            maxLength={4}
                            placeholder="0000 (deixe vazio para manter)"
                            style={{
                              padding: "10px",
                              borderRadius: "8px",
                              border: "1px solid #cbd5e1",
                              marginTop: "8px",
                              width: "100%"
                            }}
                          />
                        </div>
                        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                          <button
                            type="submit"
                            style={{
                              flex: 1,
                              padding: "10px",
                              borderRadius: "8px",
                              border: "none",
                              background: "#0f172a",
                              color: "#fff",
                              cursor: "pointer",
                              fontWeight: 700
                            }}
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingCompany(null)}
                            style={{
                              flex: 1,
                              padding: "10px",
                              borderRadius: "8px",
                              border: "1px solid #cbd5e1",
                              background: "#fff",
                              cursor: "pointer"
                            }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </article>

              {/* Create Forms */}
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <article style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
                  <h2 style={{ margin: "0 0 16px 0" }}>Nova Empresa</h2>
                  <form
                    onSubmit={handleCreateCompany}
                    style={{ display: "flex", flexDirection: "column", gap: "12px" }}
                  >
                    <input
                      name="name"
                      placeholder="Nome fantasia"
                      required
                      style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                    />
                    <input
                      name="legalName"
                      placeholder="Razao social"
                      required
                      style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                    />
                    <input
                      name="document"
                      placeholder="CNPJ"
                      style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                    />
                    <details style={{ marginTop: "4px" }}>
                      <summary style={{ cursor: "pointer", color: "#475569", fontSize: "14px" }}>
                        Token OMIE (opcional)
                      </summary>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          marginTop: "8px"
                        }}
                      >
                        <input
                          name="omieAppKey"
                          placeholder="App Key OMIE"
                          style={{
                            padding: "10px",
                            borderRadius: "8px",
                            border: "1px solid #cbd5e1"
                          }}
                        />
                        <input
                          name="omieAppSecret"
                          type="password"
                          placeholder="App Secret OMIE"
                          style={{
                            padding: "10px",
                            borderRadius: "8px",
                            border: "1px solid #cbd5e1"
                          }}
                        />
                        <small style={{ color: "#64748b" }}>
                          Quando preenchido, os desktops desta empresa ja conectam ao OMIE
                          automaticamente.
                        </small>
                      </div>
                    </details>
                    <button
                      type="submit"
                      style={{
                        padding: "10px",
                        borderRadius: "8px",
                        border: "none",
                        background: "#0f172a",
                        color: "#fff",
                        cursor: "pointer",
                        fontWeight: 700
                      }}
                    >
                      Criar Empresa
                    </button>
                  </form>
                </article>

                <article style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
                  <h2 style={{ margin: "0 0 16px 0" }}>Nova Unidade</h2>
                  <form
                    onSubmit={handleCreateUnit}
                    style={{ display: "flex", flexDirection: "column", gap: "12px" }}
                  >
                    <select
                      name="companyId"
                      required
                      style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                    >
                      <option value="">Selecione a empresa</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <input
                      name="name"
                      placeholder="Nome da unidade"
                      required
                      style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                    />
                    <button
                      type="submit"
                      style={{
                        padding: "10px",
                        borderRadius: "8px",
                        border: "none",
                        background: "#0f172a",
                        color: "#fff",
                        cursor: "pointer",
                        fontWeight: 700
                      }}
                    >
                      Criar Unidade
                    </button>
                  </form>
                </article>
              </div>
            </section>
          )}

          {activeTab === "loaders" && renderUsersTab("loader")}

          {activeTab === "comercial" && renderUsersTab("comercial")}

          {activeTab === "devices" && (
            <section style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {generatedCode !== null ? (
                <article
                  style={{
                    background: "#dcfce7",
                    padding: "24px",
                    borderRadius: "16px",
                    border: "2px solid #15803d"
                  }}
                >
                  <h2 style={{ margin: "0 0 12px 0", color: "#15803d" }}>Codigo Gerado</h2>
                  <p
                    style={{
                      fontSize: "32px",
                      fontWeight: 700,
                      letterSpacing: "8px",
                      fontFamily: "monospace",
                      margin: "12px 0"
                    }}
                  >
                    {generatedCode}
                  </p>
                  <p style={{ color: "#166534", fontSize: "14px" }}>
                    Copie este codigo e envie para o operador do desktop. Ele sera usado apenas como
                    ativacao inicial.
                  </p>
                  <button
                    onClick={() => setGeneratedCode(null)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "8px",
                      border: "1px solid #15803d",
                      background: "#fff",
                      color: "#15803d",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "14px"
                    }}
                  >
                    Fechar
                  </button>
                </article>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: TWO_COLUMN_GRID, gap: "24px" }}>
                <article style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
                  <h2 style={{ margin: "0 0 16px 0" }}>Desktops Ativados</h2>
                  {filteredDevices.length === 0 ? (
                    <p style={{ color: "#64748b" }}>Nenhum desktop ativado ainda.</p>
                  ) : (
                    filteredDevices.map((device) => {
                      const unit = units.find((u) => u.id === device.unitId);
                      const company = companies.find((c) => c.id === device.companyId);
                      return (
                        <div
                          key={device.id}
                          style={{ padding: "12px 0", borderBottom: "1px solid #e2e8f0" }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start"
                            }}
                          >
                            <div>
                              <strong>{device.name}</strong>
                              <p
                                style={{ margin: "2px 0 0 0", fontSize: "13px", color: "#64748b" }}
                              >
                                {company?.name} / {unit?.name}
                              </p>
                              <p
                                style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#94a3b8" }}
                              >
                                ID: {device.id.slice(0, 8)}... | Ativado em{" "}
                                {new Date(device.createdAt).toLocaleDateString("pt-BR")}
                              </p>
                              {device.lastSeenAt ? (
                                <p
                                  style={{
                                    margin: "2px 0 0 0",
                                    fontSize: "12px",
                                    color: "#94a3b8"
                                  }}
                                >
                                  Ultimo visto:{" "}
                                  {new Date(device.lastSeenAt).toLocaleString("pt-BR")}
                                </p>
                              ) : null}
                            </div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                              <span
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  background: device.isActive ? "#dcfce7" : "#fee2e2",
                                  color: device.isActive ? "#166534" : "#991b1b"
                                }}
                              >
                                {device.isActive ? "Ativo" : "Bloqueado"}
                              </span>
                              <button
                                onClick={() => handleToggleDevice(device.id, device.isActive)}
                                style={{
                                  padding: "6px 12px",
                                  borderRadius: "6px",
                                  border: "1px solid #cbd5e1",
                                  background: "#fff",
                                  cursor: "pointer",
                                  fontSize: "12px"
                                }}
                              >
                                {device.isActive ? "Bloquear" : "Liberar"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </article>

                <article style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
                  <h2 style={{ margin: "0 0 16px 0" }}>Codigos de Ativacao</h2>
                  <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "16px" }}>
                    Cada pedreira possui um unico codigo de ativacao para o desktop da balanca. Ao
                    gerar um novo, o anterior e invalidado. Usuarios carregadores continuam por
                    unidade.
                  </p>
                  {filteredCompanies.length === 0 ? (
                    <p style={{ color: "#b91c1c" }}>Nenhuma pedreira cadastrada.</p>
                  ) : (
                    <div
                      style={{ display: "grid", gridTemplateColumns: COMPACT_GRID, gap: "16px" }}
                    >
                      {filteredCompanies.map((company) => {
                        const companyUnits = units.filter((unit) => unit.companyId === company.id);
                        const hasActiveUnit = companyUnits.some((unit) => unit.isActive);
                        return (
                          <div
                            key={company.id}
                            style={{
                              padding: "20px",
                              borderRadius: "12px",
                              background: "#f8fafc",
                              border: "1px solid #e2e8f0",
                              display: "flex",
                              flexDirection: "column",
                              gap: "12px"
                            }}
                          >
                            <div>
                              <strong style={{ fontSize: "16px", color: "#0f172a" }}>
                                {company.name}
                              </strong>
                              <p
                                style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#64748b" }}
                              >
                                {companyUnits.length} unidade(s) cadastrada(s). Desktop unico por pedreira.
                              </p>
                            </div>

                            {company.desktopActivationCode ? (
                              <div
                                style={{
                                  padding: "12px",
                                  borderRadius: "10px",
                                  background: "#dcfce7",
                                  border: "1px solid #15803d",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "8px"
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center"
                                  }}
                                >
                                  <span
                                    style={{ fontSize: "11px", color: "#166534", fontWeight: 700 }}
                                  >
                                    CODIGO ATIVO
                                  </span>
                                  <span style={{ fontSize: "11px", color: "#166534" }}>
                                    {company.desktopActivationCodeRotatedAt
                                      ? new Date(
                                          company.desktopActivationCodeRotatedAt
                                        ).toLocaleDateString("pt-BR")
                                      : ""}
                                  </span>
                                </div>
                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: "22px",
                                    fontWeight: 700,
                                    letterSpacing: "6px",
                                    fontFamily: "monospace",
                                    color: "#15803d",
                                    textAlign: "center"
                                  }}
                                >
                                  {company.desktopActivationCode}
                                </p>
                                <button
                                  onClick={() => void copyActivationCode(company.desktopActivationCode!)}
                                  style={{
                                    padding: "6px 12px",
                                    borderRadius: "6px",
                                    border: "1px solid #15803d",
                                    background: "#fff",
                                    color: "#15803d",
                                    cursor: "pointer",
                                    fontWeight: 700,
                                    fontSize: "12px",
                                    alignSelf: "center"
                                  }}
                                >
                                  Copiar codigo
                                </button>
                              </div>
                            ) : (
                              <div
                                style={{
                                  padding: "12px",
                                  borderRadius: "10px",
                                  background: "#fef2f2",
                                  border: "1px solid #fecaca",
                                  textAlign: "center"
                                }}
                              >
                                <p style={{ margin: 0, fontSize: "13px", color: "#b91c1c" }}>
                                  Nenhum codigo gerado
                                </p>
                              </div>
                            )}

                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                              <button
                                onClick={() => handleGenerateActivationCode(company.id)}
                                disabled={!hasActiveUnit}
                                style={{
                                  flex: 1,
                                  padding: "8px 12px",
                                  borderRadius: "8px",
                                  border: "none",
                                  background: hasActiveUnit ? "#0f172a" : "#94a3b8",
                                  color: "#fff",
                                  cursor: hasActiveUnit ? "pointer" : "not-allowed",
                                  fontWeight: 700,
                                  fontSize: "12px"
                                }}
                                title={hasActiveUnit ? undefined : "Cadastre uma unidade ativa antes de gerar o codigo"}
                              >
                                Gerar novo
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Edit Unit Modal */}
                      {editingUnit && (
                        <div
                          style={{
                            position: "fixed",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: "rgba(0,0,0,0.5)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            zIndex: MODAL_Z_INDEX
                          }}
                        >
                          <div
                            style={{
                              background: "#fff",
                              padding: "24px",
                              borderRadius: "16px",
                              width: "100%",
                              maxWidth: "400px"
                            }}
                          >
                            <h3 style={{ margin: "0 0 16px 0" }}>Editar Unidade</h3>
                            <form
                              onSubmit={handleUpdateUnit}
                              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
                            >
                              <input
                                name="name"
                                defaultValue={editingUnit.name}
                                placeholder="Nome da unidade"
                                required
                                style={{
                                  padding: "10px",
                                  borderRadius: "8px",
                                  border: "1px solid #cbd5e1"
                                }}
                              />
                              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                                <button
                                  type="submit"
                                  style={{
                                    flex: 1,
                                    padding: "10px",
                                    borderRadius: "8px",
                                    border: "none",
                                    background: "#0f172a",
                                    color: "#fff",
                                    cursor: "pointer",
                                    fontWeight: 700
                                  }}
                                >
                                  Salvar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingUnit(null)}
                                  style={{
                                    flex: 1,
                                    padding: "10px",
                                    borderRadius: "8px",
                                    border: "1px solid #cbd5e1",
                                    background: "#fff",
                                    cursor: "pointer"
                                  }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </form>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
