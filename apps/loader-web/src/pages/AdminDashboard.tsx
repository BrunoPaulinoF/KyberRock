import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  getFirestore,
  collection,
  query,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  setDoc,
  getDoc
} from "firebase/firestore";
import { createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { initializeApp } from "firebase/app";
import { firebaseWebConfig } from "../config/firebase-config";

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
}

interface LoaderUser {
  id: string;
  email: string;
  name: string;
  companyId: string;
  unitId: string;
  isActive: boolean;
}

export function AdminDashboard() {
  const { logout } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [users, setUsers] = useState<LoaderUser[]>([]);
  const [activeTab, setActiveTab] = useState<"companies" | "users">("companies");
  const [isLoading, setIsLoading] = useState(true);

  const app = initializeApp(firebaseWebConfig);
  const db = getFirestore(app);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    try {
      // Load companies
      const companiesSnapshot = await getDocs(query(collection(db, "companies")));
      const companiesData = companiesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Company[];
      setCompanies(companiesData);

      // Load units
      const unitsSnapshot = await getDocs(query(collection(db, "units")));
      const unitsData = unitsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Unit[];
      setUnits(unitsData);

      // Load users
      const usersSnapshot = await getDocs(query(collection(db, "users")));
      const usersData = usersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as LoaderUser[];
      setUsers(usersData);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    try {
      await addDoc(collection(db, "companies"), {
        name: formData.get("name"),
        legalName: formData.get("legalName"),
        document: formData.get("document"),
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      event.currentTarget.reset();
      await loadData();
    } catch (error) {
      console.error("Error creating company:", error);
      alert("Erro ao criar empresa");
    }
  }

  async function handleToggleCompany(companyId: string, currentStatus: boolean) {
    try {
      await updateDoc(doc(db, "companies", companyId), {
        isActive: !currentStatus,
        updatedAt: new Date().toISOString()
      });
      await loadData();
    } catch (error) {
      console.error("Error toggling company:", error);
    }
  }

  async function handleCreateUnit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    try {
      await addDoc(collection(db, "units"), {
        companyId: formData.get("companyId"),
        name: formData.get("name"),
        timezone: "America/Sao_Paulo",
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      event.currentTarget.reset();
      await loadData();
    } catch (error) {
      console.error("Error creating unit:", error);
      alert("Erro ao criar unidade");
    }
  }

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const unitId = formData.get("unitId") as string;
    
    try {
      // Create Firebase Auth user
      const auth = getAuth(app);
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      
      // Get unit info
      const unitDoc = await getDoc(doc(db, "units", unitId));
      const unitData = unitDoc.data();
      
      // Create user document
      await setDoc(doc(db, "users", userCredential.user.uid), {
        email,
        name: formData.get("name"),
        companyId: unitData?.companyId,
        unitId,
        role: "loader",
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      event.currentTarget.reset();
      await loadData();
    } catch (error) {
      console.error("Error creating user:", error);
      alert("Erro ao criar usuário: " + (error instanceof Error ? error.message : "Erro desconhecido"));
    }
  }

  async function handleToggleUser(userId: string, currentStatus: boolean) {
    try {
      await updateDoc(doc(db, "users", userId), {
        isActive: !currentStatus,
        updatedAt: new Date().toISOString()
      });
      await loadData();
    } catch (error) {
      console.error("Error toggling user:", error);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", padding: "32px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "28px" }}>KyberRock Admin</h1>
          <p style={{ color: "#64748b", margin: "4px 0 0 0" }}>Gerenciamento de Pedreiras</p>
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
      </nav>

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
                      </div>
                    </div>
                    <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                      Unidades: {units.filter(u => u.companyId === company.id).length}
                    </p>
                  </div>
                ))}
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
        </>
      )}
    </main>
  );
}
