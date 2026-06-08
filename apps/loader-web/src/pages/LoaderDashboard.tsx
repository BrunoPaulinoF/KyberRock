import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

interface WeighingOperation {
  id: string;
  plate: string;
  customerName: string;
  driverName: string;
  productDescription: string;
  entryWeightKg: number;
  status: string;
  createdAt: string;
}

export function LoaderDashboard() {
  const { user, logout } = useAuth();
  const [operations, setOperations] = useState<WeighingOperation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadOperations();
  }, [user?.unitId]);

  async function loadOperations() {
    if (!user?.unitId) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("loading_requests")
        .select("id,plate,customer_name,driver_name,product_description,entry_weight_kg,status,created_at")
        .eq("unit_id", user.unitId)
        .eq("status", "open")
        .order("created_at", { ascending: true });

      if (error) throw error;
      const ops = (data ?? []).map((row) => ({
        id: row.id,
        plate: row.plate,
        customerName: row.customer_name,
        driverName: row.driver_name,
        productDescription: row.product_description,
        entryWeightKg: Number(row.entry_weight_kg ?? 0),
        status: row.status,
        createdAt: row.created_at
      })) as WeighingOperation[];

      setOperations(ops);
    } catch (error) {
      console.error("Error loading operations:", error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", padding: "32px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "28px" }}>KyberRock</h1>
          <p style={{ color: "#64748b", margin: "4px 0 0 0" }}>Painel do Carregador</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ color: "#64748b" }}>{user?.name}</span>
          <button
            onClick={logout}
            style={{ padding: "10px 20px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontWeight: 700 }}
          >
            Sair
          </button>
        </div>
      </header>

      <section style={{ background: "#fff", padding: "24px", borderRadius: "16px" }}>
        <h2 style={{ margin: "0 0 16px 0" }}>Carregamentos em Aberto</h2>

        {isLoading ? (
          <p>Carregando...</p>
        ) : operations.length === 0 ? (
          <p style={{ color: "#64748b" }}>Nenhum carregamento em aberto.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {operations.map(op => (
              <article key={op.id} style={{ padding: "16px", border: "1px solid #e2e8f0", borderRadius: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px 0", fontSize: "18px" }}>{op.plate}</h3>
                    <p style={{ margin: "0", color: "#64748b", fontSize: "14px" }}>
                      {op.customerName} - {op.productDescription}
                    </p>
                    <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "14px" }}>
                      Motorista: {op.driverName}
                    </p>
                  </div>
                  <span style={{
                    padding: "4px 12px",
                    borderRadius: "20px",
                    background: "#dcfce7",
                    color: "#166534",
                    fontSize: "12px",
                    fontWeight: 700
                  }}>
                    Aguardando
                  </span>
                </div>
                <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "14px", color: "#64748b" }}>
                    Peso entrada: {op.entryWeightKg?.toLocaleString("pt-BR")} kg
                  </span>
                  <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                    {new Date(op.createdAt).toLocaleString("pt-BR")}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
