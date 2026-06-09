import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { callAdminFunction } from "../lib/admin-api";

interface Company {
  id: string;
  name: string;
  legalName: string;
  document: string;
  isActive: boolean;
  createdAt: string;
}

interface Unit {
  id: string;
  companyId: string;
  name: string;
  timezone: string;
  isActive: boolean;
  desktopActivationCodeRotatedAt?: string;
}

interface LoaderUser {
  id: string;
  email: string;
  name: string;
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

export function AdminDashboard() {
  const { logout } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [users, setUsers] = useState<LoaderUser[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [activeTab, setActiveTab] = useState<"companies" | "users" | "devices">("companies");
  const [isLoading, setIsLoading] = useState(true);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "company" | "unit"; id: string; name: string } | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    try {
      const data = await callAdminFunction<{
        companies: Array<{ id: string; name: string; legal_name: string; document: string | null; is_active: boolean; created_at: string }>;
        units: Array<{ id: string; company_id: string; name: string; timezone: string; is_active: boolean; desktop_activation_code_rotated_at?: string }>;
        users: Array<{ id: string; email: string; name: string; company_id: string; unit_id: string; is_active: boolean }>;
        devices: Array<{ id: string; company_id: string; unit_id: string; name: string; is_active: boolean; last_seen_at: string | null; created_at: string; updated_at: string }>;
      }>("admin-api", { action: "list" });

      setCompanies(data.companies.map((company) => ({
        id: company.id,
        name: company.name,
        legalName: company.legal_name,
        document: company.document ?? "",
        isActive: company.is_active,
        createdAt: company.created_at
      })));
      setUnits(data.units.map((unit) => ({
        id: unit.id,
        companyId: unit.company_id,
        name: unit.name,
        timezone: unit.timezone,
        isActive: unit.is_active,
        desktopActivationCodeRotatedAt: unit.desktop_activation_code_rotated_at
      })));
      setUsers(data.users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        companyId: user.company_id,
        unitId: user.unit_id,
        isActive: user.is_active
      })));
      setDevices((data.devices ?? []).map((device) => ({
        id: device.id,
        companyId: device.company_id,
        unitId: device.unit_id,
        name: device.name,
        isActive: device.is_active,
        lastSeenAt: device.last_seen_at,
        createdAt: device.created_at,
        updatedAt: device.updated_at
      })));
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    
    try {
      await callAdminFunction("admin-api", {
        action: "create_company",
        payload: {
          name: formData.get("name"),
          legalName: formData.get("legalName"),
          document: formData.get("document")
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

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
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
          unitId: formData.get("unitId")
        }
      });
      
      form.reset();
      await loadData();
    } catch (error) {
      console.error("Error creating user:", error);
      alert("Erro ao criar usuário: " + (error instanceof Error ? error.message : "Erro desconhecido"));
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

  async function handleGenerateActivationCode(unitId: string): Promise<void> {
    try {
      const result = await callAdminFunction<{ code: string }>("admin-api", {
        action: "generate_desktop_activation_code",
        payload: { unitId }
      });
      setGeneratedCode(result.code);
      await loadData();
    } catch (error) {
      console.error("Error generating code:", error);
      alert("Erro ao gerar codigo de ativacao");
    }
  }

  async function handleToggleUnit(unitId: string, currentStatus: boolean): Promise<void> {
    try {
      await callAdminFunction("admin-api", {
        action: "toggle_unit",
        payload: { unitId, isActive: !currentStatus }
      });
      await loadData();
    } catch (error) {
      console.error("Error toggling unit:", error);
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

  async function handleDeleteUnit(unit: Unit) {
    setConfirmDelete({ type: "unit", id: unit.id, name: unit.name });
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
    try {
      await callAdminFunction("admin-api", {
        action: "update_company",
        payload: {
          companyId: editingCompany.id,
          name: formData.get("name"),
          legalName: formData.get("legalName"),
          document: formData.get("document")
        }
      });
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

  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", padding: "32px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <img src="/kyberrocklogo.png" alt="KyberRock" style={{ width: "48px", height: "48px", objectFit: "contain" }} />
          <div>
            <h1 style={{ margin: 0, fontSize: "28px" }}>KyberRock Admin</h1>
            <p style={{ color: "#64748b", margin: "4px 0 0 0" }}>Gerenciamento de Pedreiras</p>
          </div>
        </div>
        <button
          onClick={logout}
          style={{ padding: "10px 20px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontWeight: 700 }}
        >
          Sair
        </button>
      </header>

      <nav style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        <button
          onClick={() => setActiveTab("companies")}
          style={{
            padding: "10px 20px",
            borderRadius: "10px",
            border: "none",
            background: activeTab === "companies" ? "#0f172a" : "#e2e8f0",
            color: activeTab === "companies" ? "#fff" : "#0f172a",
            cursor: "pointer",
            fontWeight: 700
          }}
        >
          Empresas e Unidades
        </button>
        <button
          onClick={() => setActiveTab("users")}
          style={{
            padding: "10px 20px",
            borderRadius: "10px",
            border: "none",
            background: activeTab === "users" ? "#0f172a" : "#e2e8f0",
            color: activeTab === "users" ? "#fff" : "#0f172a",
            cursor: "pointer",
            fontWeight: 700
          }}
        >
          Usuarios Carregadores
        </button>
        <button
          onClick={() => setActiveTab("devices")}
          style={{
            padding: "10px 20px",
            borderRadius: "10px",
            border: "none",
            background: activeTab === "devices" ? "#0f172a" : "#e2e8f0",
            color: activeTab === "devices" ? "#fff" : "#0f172a",
            cursor: "pointer",
            fontWeight: 700
          }}
        >
          Dispositivos e Licencas
        </button>
      </nav>

      {confirmDelete && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2000
        }}>
          <div style={{ background: "#fff", padding: "24px", borderRadius: "16px", width: "100%", maxWidth: "400px" }}>
            <h3 style={{ margin: "0 0 12px 0", color: "#dc2626" }}>Confirmar exclusao</h3>
            <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#64748b" }}>
              {confirmDelete.type === "company"
                ? `Tem certeza que deseja excluir a empresa "${confirmDelete.name}"? Todas as unidades vinculadas serao excluidas tambem.`
                : `Tem certeza que deseja excluir a unidade "${confirmDelete.name}"?`}
            </p>
            <form onSubmit={handleConfirmDelete} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <input
                type="password"
                placeholder="Senha do administrador"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button type="submit" style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "none", background: "#dc2626", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
                  Confirmar exclusao
                </button>
                <button type="button" onClick={() => { setConfirmDelete(null); setConfirmPassword(""); }} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>
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
            <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
              {/* Companies List */}
              <article style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
                <h2 style={{ margin: "0 0 16px 0" }}>Empresas</h2>
                {companies.length === 0 && <p style={{ color: "#64748b" }}>Nenhuma empresa cadastrada.</p>}
                {companies.map(company => (
                  <div key={company.id} style={{ padding: "12px 0", borderBottom: "1px solid #e2e8f0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <strong>{company.name}</strong>
                        <p style={{ margin: "2px 0 0 0", fontSize: "14px", color: "#64748b" }}>{company.legalName}</p>
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <span style={{
                          padding: "4px 8px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          background: company.isActive ? "#dcfce7" : "#fee2e2",
                          color: company.isActive ? "#166534" : "#991b1b"
                        }}>
                          {company.isActive ? "Ativa" : "Inativa"}
                        </span>
                        <button
                          onClick={() => handleToggleCompany(company.id, company.isActive)}
                          style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontSize: "12px" }}
                        >
                          {company.isActive ? "Desativar" : "Ativar"}
                        </button>
                        <button
                          onClick={() => setEditingCompany(company)}
                          style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #e2e8f0", background: "#f8fafc", cursor: "pointer", fontSize: "12px" }}
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleDeleteCompany(company)}
                          style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #fecaca", background: "#fef2f2", cursor: "pointer", fontSize: "12px", color: "#dc2626" }}
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                    <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                      Unidades: {units.filter(u => u.companyId === company.id).length}
                    </p>
                  </div>
                ))}

                {/* Edit Company Modal */}
                {editingCompany && (
                  <div style={{
                    position: "fixed",
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(0,0,0,0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000
                  }}>
                    <div style={{ background: "#fff", padding: "24px", borderRadius: "16px", width: "100%", maxWidth: "400px" }}>
                      <h3 style={{ margin: "0 0 16px 0" }}>Editar Empresa</h3>
                      <form onSubmit={handleUpdateCompany} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        <input name="name" defaultValue={editingCompany.name} placeholder="Nome fantasia" required style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                        <input name="legalName" defaultValue={editingCompany.legalName} placeholder="Razao social" required style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                        <input name="document" defaultValue={editingCompany.document} placeholder="CNPJ" style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                          <button type="submit" style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "none", background: "#0f172a", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
                            Salvar
                          </button>
                          <button type="button" onClick={() => setEditingCompany(null)} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>
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
                  <form onSubmit={handleCreateCompany} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <input name="name" placeholder="Nome fantasia" required style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                    <input name="legalName" placeholder="Razao social" required style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                    <input name="document" placeholder="CNPJ" style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                    <button type="submit" style={{ padding: "10px", borderRadius: "8px", border: "none", background: "#0f172a", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
                      Criar Empresa
                    </button>
                  </form>
                </article>

                <article style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
                  <h2 style={{ margin: "0 0 16px 0" }}>Nova Unidade</h2>
                  <form onSubmit={handleCreateUnit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <select name="companyId" required style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}>
                      <option value="">Selecione a empresa</option>
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <input name="name" placeholder="Nome da unidade" required style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                    <button type="submit" style={{ padding: "10px", borderRadius: "8px", border: "none", background: "#0f172a", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
                      Criar Unidade
                    </button>
                  </form>
                </article>
              </div>
            </section>
          )}

          {activeTab === "users" && (
            <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
              <article style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
                <h2 style={{ margin: "0 0 16px 0" }}>Usuarios Carregadores</h2>
                {users.length === 0 && <p style={{ color: "#64748b" }}>Nenhum usuario cadastrado.</p>}
                {users.map(user => (
                  <div key={user.id} style={{ padding: "12px 0", borderBottom: "1px solid #e2e8f0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <strong>{user.name}</strong>
                        <p style={{ margin: "2px 0 0 0", fontSize: "14px", color: "#64748b" }}>{user.email}</p>
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <span style={{
                          padding: "4px 8px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          background: user.isActive ? "#dcfce7" : "#fee2e2",
                          color: user.isActive ? "#166534" : "#991b1b"
                        }}>
                          {user.isActive ? "Ativo" : "Inativo"}
                        </span>
                        <button
                          onClick={() => handleToggleUser(user.id, user.isActive)}
                          style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontSize: "12px" }}
                        >
                          {user.isActive ? "Bloquear" : "Liberar"}
                        </button>
                      </div>
                    </div>
                    <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                      Unidade: {units.find(u => u.id === user.unitId)?.name || "N/A"}
                    </p>
                  </div>
                ))}
              </article>

              <article style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
                <h2 style={{ margin: "0 0 16px 0" }}>Novo Usuario</h2>
                <form onSubmit={handleCreateUser} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <input name="name" placeholder="Nome completo" required style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                  <input name="email" type="email" placeholder="E-mail" required style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                  <input name="password" type="password" placeholder="Senha" required minLength={6} style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                  <select name="unitId" required style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}>
                    <option value="">Selecione a unidade</option>
                    {units.filter(u => u.isActive).map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                  <button type="submit" style={{ padding: "10px", borderRadius: "8px", border: "none", background: "#0f172a", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
                    Criar Usuario
                  </button>
                </form>
              </article>
            </section>
          )}

          {activeTab === "devices" && (
            <section style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {generatedCode !== null ? (
                <article style={{ background: "#dcfce7", padding: "24px", borderRadius: "16px", border: "2px solid #15803d" }}>
                  <h2 style={{ margin: "0 0 12px 0", color: "#15803d" }}>Codigo Gerado</h2>
                  <p style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "8px", fontFamily: "monospace", margin: "12px 0" }}>
                    {generatedCode}
                  </p>
                  <p style={{ color: "#166534", fontSize: "14px" }}>
                    Copie este codigo e envie para o operador do desktop. Ele sera usado apenas como ativacao inicial.
                  </p>
                  <button
                    onClick={() => setGeneratedCode(null)}
                    style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #15803d", background: "#fff", color: "#15803d", cursor: "pointer", fontWeight: 700, fontSize: "14px" }}
                  >
                    Fechar
                  </button>
                </article>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                <article style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
                  <h2 style={{ margin: "0 0 16px 0" }}>Desktops Ativados</h2>
                  {devices.length === 0 ? (
                    <p style={{ color: "#64748b" }}>Nenhum desktop ativado ainda.</p>
                  ) : (
                    devices.map(device => {
                      const unit = units.find(u => u.id === device.unitId);
                      const company = companies.find(c => c.id === device.companyId);
                      return (
                        <div key={device.id} style={{ padding: "12px 0", borderBottom: "1px solid #e2e8f0" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div>
                              <strong>{device.name}</strong>
                              <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: "#64748b" }}>
                                {company?.name} / {unit?.name}
                              </p>
                              <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#94a3b8" }}>
                                ID: {device.id.slice(0, 8)}... | Ativado em {new Date(device.createdAt).toLocaleDateString("pt-BR")}
                              </p>
                              {device.lastSeenAt ? (
                                <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#94a3b8" }}>
                                  Ultimo visto: {new Date(device.lastSeenAt).toLocaleString("pt-BR")}
                                </p>
                              ) : null}
                            </div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                              <span style={{
                                padding: "4px 8px",
                                borderRadius: "6px",
                                fontSize: "12px",
                                background: device.isActive ? "#dcfce7" : "#fee2e2",
                                color: device.isActive ? "#166534" : "#991b1b"
                              }}>
                                {device.isActive ? "Ativo" : "Bloqueado"}
                              </span>
                              <button
                                onClick={() => handleToggleDevice(device.id, device.isActive)}
                                style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontSize: "12px" }}
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
                  <h2 style={{ margin: "0 0 16px 0" }}>Gerar Codigo de Ativacao</h2>
                  <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "8px" }}>
                    Selecione a pedreira/unidade para gerar um novo codigo de 6 digitos.
                  </p>
                  <p style={{ color: "#94a3b8", fontSize: "13px", marginBottom: "16px" }}>
                    O codigo e exibido apenas uma vez. Ao gerar um novo, o anterior e invalidado.
                  </p>
                  {units.filter(u => u.isActive).length === 0 ? (
                    <p style={{ color: "#b91c1c" }}>Nenhuma unidade ativa disponivel.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {units.filter(u => u.isActive).map(unit => {
                        const company = companies.find(c => c.id === unit.companyId);
                        return (
                          <div key={unit.id} style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "12px",
                            borderRadius: "10px",
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0"
                          }}>
                            <div>
                              <strong style={{ fontSize: "14px" }}>{unit.name}</strong>
                              <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#94a3b8" }}>
                                {company?.name} | {unit.desktopActivationCodeRotatedAt
                                  ? `Ultimo codigo: ${new Date(unit.desktopActivationCodeRotatedAt).toLocaleDateString("pt-BR")}`
                                  : "Nenhum codigo gerado"}
                              </p>
                            </div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                              <button
                                onClick={() => handleGenerateActivationCode(unit.id)}
                                style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: "#0f172a", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: "13px" }}
                              >
                                Gerar codigo
                              </button>
                              <button
                                onClick={() => handleToggleUnit(unit.id, unit.isActive)}
                                style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontSize: "13px" }}
                              >
                                {unit.isActive ? "Desativar" : "Ativar"}
                              </button>
                              <button
                                onClick={() => setEditingUnit(unit)}
                                style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid #e2e8f0", background: "#f8fafc", cursor: "pointer", fontSize: "13px" }}
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => handleDeleteUnit(unit)}
                                style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid #fecaca", background: "#fef2f2", cursor: "pointer", fontSize: "13px", color: "#dc2626" }}
                              >
                                Excluir
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Edit Unit Modal */}
                      {editingUnit && (
                        <div style={{
                          position: "fixed",
                          top: 0, left: 0, right: 0, bottom: 0,
                          background: "rgba(0,0,0,0.5)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          zIndex: 1000
                        }}>
                          <div style={{ background: "#fff", padding: "24px", borderRadius: "16px", width: "100%", maxWidth: "400px" }}>
                            <h3 style={{ margin: "0 0 16px 0" }}>Editar Unidade</h3>
                            <form onSubmit={handleUpdateUnit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                              <input name="name" defaultValue={editingUnit.name} placeholder="Nome da unidade" required style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                                <button type="submit" style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "none", background: "#0f172a", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
                                  Salvar
                                </button>
                                <button type="button" onClick={() => setEditingUnit(null)} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>
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
