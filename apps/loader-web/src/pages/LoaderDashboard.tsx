import { useEffect, useState, type CSSProperties } from "react";

import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

export interface WeighingOperation {
  id: string;
  plate: string;
  customerName: string;
  driverName: string;
  productDescription: string;
  entryWeightKg: number;
  status: string;
  createdAt: string;
}

export interface CompletedWeighingOperation extends WeighingOperation {
  completedAt: string;
}

export function completeLoadingOperation(
  inProgress: WeighingOperation[],
  completed: CompletedWeighingOperation[],
  operationId: string,
  completedAt: string
): { inProgress: WeighingOperation[]; completed: CompletedWeighingOperation[] } {
  if (completed.some((operation) => operation.id === operationId)) {
    return { inProgress, completed };
  }

  const operation = inProgress.find((item) => item.id === operationId);
  if (!operation) {
    return { inProgress, completed };
  }

  return {
    inProgress: inProgress.filter((item) => item.id !== operationId),
    completed: [...completed, { ...operation, status: "completed", completedAt }]
  };
}

function formatWeight(weightKg: number): string {
  if (!weightKg) {
    return "A definir";
  }

  return `${weightKg.toLocaleString("pt-BR")} kg`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function LoaderDashboard() {
  const { user, logout } = useAuth();
  const [operations, setOperations] = useState<WeighingOperation[]>([]);
  const [completedOperations, setCompletedOperations] = useState<CompletedWeighingOperation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadOperations();

    if (!user?.unitId) return;

    const channel = supabase
      .channel(`loading-requests:${user.unitId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loading_requests",
          filter: `unit_id=eq.${user.unitId}`
        },
        () => void loadOperations({ preserveLoading: true })
      )
      .subscribe();

    const fallbackPolling = window.setInterval(
      () => void loadOperations({ preserveLoading: true }),
      15_000
    );

    return () => {
      window.clearInterval(fallbackPolling);
      void supabase.removeChannel(channel);
    };
  }, [user?.unitId]);

  async function loadOperations(options: { preserveLoading?: boolean } = {}) {
    if (!user?.unitId) {
      setIsLoading(false);
      return;
    }

    if (!options.preserveLoading) setIsLoading(true);
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

  function handleCompleteOperation(operationId: string) {
    setCompletedOperations((current) => {
      const result = completeLoadingOperation(
        operations,
        current,
        operationId,
        new Date().toISOString()
      );

      return result.completed;
    });
  }

  const inProgressOperations = operations.filter((operation) =>
    completedOperations.every((completed) => completed.id !== operation.id)
  );

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Painel do carregador</p>
          <h1 style={styles.title}>Fila de cargas</h1>
          <p style={styles.subtitle}>Organize os caminhões por ordem de chegada e marque as cargas concluídas.</p>
        </div>

        <div style={styles.userArea}>
          <span style={styles.userName}>{user?.name ?? "Carregador"}</span>
          <button onClick={logout} style={styles.logoutButton}>
            Sair
          </button>
        </div>
      </header>

      <section style={styles.summaryGrid} aria-label="Resumo da fila de carga">
        <article style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Em andamento</span>
          <strong style={styles.summaryValue}>{inProgressOperations.length}</strong>
          <span style={styles.summaryHelp}>Ordem FIFO: primeiro que chega, primeiro que carrega.</span>
        </article>

        <article style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Concluídas</span>
          <strong style={styles.summaryValue}>{completedOperations.length}</strong>
          <span style={styles.summaryHelp}>Conclusões locais, sem envio ao desktop por enquanto.</span>
        </article>
      </section>

      <section style={styles.board}>
        <section style={styles.column} aria-labelledby="in-progress-title">
          <div style={styles.columnHeader}>
            <div>
              <h2 id="in-progress-title" style={styles.columnTitle}>
                Cargas em andamento
              </h2>
              <p style={styles.columnDescription}>Atenda de cima para baixo para preservar a chegada.</p>
            </div>
            <span style={styles.badge}>{inProgressOperations.length}</span>
          </div>

          {isLoading ? (
            <EmptyState title="Carregando fila..." description="Buscando cargas em aberto da unidade." />
          ) : inProgressOperations.length === 0 ? (
            <EmptyState
              title="Nenhuma carga aguardando"
              description="Quando uma operação entrar na fila, ela aparecerá aqui."
            />
          ) : (
            <div style={styles.cardList}>
              {inProgressOperations.map((operation, index) => (
                <LoadingCard
                  key={operation.id}
                  operation={operation}
                  position={index + 1}
                  onComplete={() => handleCompleteOperation(operation.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section style={styles.column} aria-labelledby="completed-title">
          <div style={styles.columnHeader}>
            <div>
              <h2 id="completed-title" style={styles.columnTitle}>
                Concluídas
              </h2>
              <p style={styles.columnDescription}>Histórico das cargas finalizadas nesta tela.</p>
            </div>
            <span style={{ ...styles.badge, ...styles.successBadge }}>{completedOperations.length}</span>
          </div>

          {completedOperations.length === 0 ? (
            <EmptyState
              title="Nada concluído ainda"
              description="Clique em Concluir carga quando o caminhão já tiver sido carregado."
            />
          ) : (
            <div style={styles.cardList}>
              {completedOperations.map((operation, index) => (
                <CompletedCard key={operation.id} operation={operation} position={index + 1} />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function LoadingCard({
  operation,
  position,
  onComplete
}: {
  operation: WeighingOperation;
  position: number;
  onComplete: () => void;
}) {
  return (
    <article style={styles.operationCard}>
      <div style={styles.operationTopRow}>
        <span style={styles.queuePosition}>{position}º</span>
        <div style={styles.operationIdentity}>
          <h3 style={styles.plate}>{operation.plate}</h3>
          <p style={styles.customer}>{operation.customerName}</p>
        </div>
        <span style={styles.waitingPill}>Aguardando</span>
      </div>

      <dl style={styles.detailsGrid}>
        <InfoItem label="Motorista" value={operation.driverName} />
        <InfoItem label="Produto" value={operation.productDescription} />
        <InfoItem label="Quantidade" value={formatWeight(operation.entryWeightKg)} />
        <InfoItem label="Chegada" value={formatDateTime(operation.createdAt)} />
      </dl>

      <button onClick={onComplete} style={styles.completeButton}>
        Concluir carga
      </button>
    </article>
  );
}

function CompletedCard({
  operation,
  position
}: {
  operation: CompletedWeighingOperation;
  position: number;
}) {
  return (
    <article style={{ ...styles.operationCard, ...styles.completedCard }}>
      <div style={styles.operationTopRow}>
        <span style={{ ...styles.queuePosition, ...styles.completedPosition }}>{position}º</span>
        <div style={styles.operationIdentity}>
          <h3 style={styles.plate}>{operation.plate}</h3>
          <p style={styles.customer}>{operation.customerName}</p>
        </div>
        <span style={styles.donePill}>Concluída</span>
      </div>

      <dl style={styles.detailsGrid}>
        <InfoItem label="Motorista" value={operation.driverName} />
        <InfoItem label="Produto" value={operation.productDescription} />
        <InfoItem label="Quantidade" value={formatWeight(operation.entryWeightKg)} />
        <InfoItem label="Finalizada" value={formatDateTime(operation.completedAt)} />
      </dl>
    </article>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={styles.detailLabel}>{label}</dt>
      <dd style={styles.detailValue}>{value}</dd>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div style={styles.emptyState}>
      <strong style={styles.emptyTitle}>{title}</strong>
      <span style={styles.emptyDescription}>{description}</span>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)",
    color: "#0f172a",
    padding: "32px",
    boxSizing: "border-box"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "20px",
    margin: "0 auto 24px",
    maxWidth: "1280px",
    flexWrap: "wrap"
  },
  eyebrow: {
    margin: "0 0 8px",
    color: "#2563eb",
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase"
  },
  title: {
    margin: 0,
    fontSize: "36px",
    lineHeight: 1.1,
    letterSpacing: "-0.04em"
  },
  subtitle: {
    margin: "10px 0 0",
    color: "#64748b",
    fontSize: "16px",
    maxWidth: "620px"
  },
  userArea: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    background: "rgba(255, 255, 255, 0.82)",
    border: "1px solid #e2e8f0",
    borderRadius: "999px",
    padding: "8px 8px 8px 16px",
    boxShadow: "0 14px 40px rgba(15, 23, 42, 0.08)"
  },
  userName: {
    color: "#334155",
    fontSize: "14px",
    fontWeight: 700
  },
  logoutButton: {
    padding: "9px 16px",
    borderRadius: "999px",
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#0f172a",
    cursor: "pointer",
    fontWeight: 800
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "16px",
    margin: "0 auto 18px",
    maxWidth: "1280px"
  },
  summaryCard: {
    background: "rgba(255, 255, 255, 0.9)",
    border: "1px solid #e2e8f0",
    borderRadius: "20px",
    padding: "18px 20px",
    boxShadow: "0 18px 60px rgba(15, 23, 42, 0.08)",
    display: "flex",
    flexDirection: "column",
    gap: "6px"
  },
  summaryLabel: {
    color: "#64748b",
    fontSize: "13px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.06em"
  },
  summaryValue: {
    fontSize: "34px",
    lineHeight: 1
  },
  summaryHelp: {
    color: "#64748b",
    fontSize: "13px"
  },
  board: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "18px",
    maxWidth: "1280px",
    margin: "0 auto"
  },
  column: {
    minHeight: "520px",
    background: "rgba(255, 255, 255, 0.92)",
    border: "1px solid #e2e8f0",
    borderRadius: "24px",
    padding: "20px",
    boxShadow: "0 18px 60px rgba(15, 23, 42, 0.08)",
    boxSizing: "border-box"
  },
  columnHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "14px",
    marginBottom: "16px"
  },
  columnTitle: {
    margin: 0,
    fontSize: "22px",
    letterSpacing: "-0.02em"
  },
  columnDescription: {
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: "14px"
  },
  badge: {
    minWidth: "34px",
    height: "34px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontWeight: 900
  },
  successBadge: {
    background: "#dcfce7",
    color: "#166534"
  },
  cardList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px"
  },
  operationCard: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: "18px",
    padding: "16px",
    boxShadow: "0 12px 34px rgba(15, 23, 42, 0.06)"
  },
  completedCard: {
    background: "#f8fff9",
    borderColor: "#bbf7d0"
  },
  operationTopRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px"
  },
  queuePosition: {
    minWidth: "42px",
    height: "42px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "14px",
    background: "#0f172a",
    color: "#fff",
    fontSize: "15px",
    fontWeight: 900
  },
  completedPosition: {
    background: "#166534"
  },
  operationIdentity: {
    flex: 1,
    minWidth: 0
  },
  plate: {
    margin: 0,
    fontSize: "24px",
    lineHeight: 1,
    letterSpacing: "0.04em"
  },
  customer: {
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: "14px",
    fontWeight: 700
  },
  waitingPill: {
    borderRadius: "999px",
    background: "#fef3c7",
    color: "#92400e",
    padding: "6px 10px",
    fontSize: "12px",
    fontWeight: 900,
    whiteSpace: "nowrap"
  },
  donePill: {
    borderRadius: "999px",
    background: "#dcfce7",
    color: "#166534",
    padding: "6px 10px",
    fontSize: "12px",
    fontWeight: 900,
    whiteSpace: "nowrap"
  },
  detailsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "12px",
    margin: "16px 0 0"
  },
  detailLabel: {
    color: "#94a3b8",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase"
  },
  detailValue: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: "14px",
    fontWeight: 800
  },
  completeButton: {
    width: "100%",
    marginTop: "16px",
    border: 0,
    borderRadius: "14px",
    background: "#0f172a",
    color: "#fff",
    padding: "13px 16px",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 900
  },
  emptyState: {
    minHeight: "220px",
    border: "1px dashed #cbd5e1",
    borderRadius: "18px",
    background: "#f8fafc",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    textAlign: "center",
    padding: "24px",
    boxSizing: "border-box"
  },
  emptyTitle: {
    color: "#334155",
    fontSize: "16px"
  },
  emptyDescription: {
    color: "#64748b",
    fontSize: "14px",
    marginTop: "6px",
    maxWidth: "300px"
  }
};
