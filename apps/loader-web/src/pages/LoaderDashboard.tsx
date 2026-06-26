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
  loaderCompletedAt: string | null;
}

function formatWeight(weightKg: number): string {
  if (!weightKg) {
    return "A definir";
  }

  return `${weightKg.toLocaleString("pt-BR")} kg`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

interface LoadingRequestRow {
  id: string;
  plate: string;
  customer_name: string;
  driver_name: string;
  product_description: string;
  entry_weight_kg: number | null;
  status: string;
  created_at: string;
  loader_completed_at: string | null;
}

function mapRow(row: LoadingRequestRow): WeighingOperation {
  return {
    id: row.id,
    plate: row.plate,
    customerName: row.customer_name,
    driverName: row.driver_name,
    productDescription: row.product_description,
    entryWeightKg: Number(row.entry_weight_kg ?? 0),
    status: row.status,
    createdAt: row.created_at,
    loaderCompletedAt: row.loader_completed_at
  };
}

export function LoaderDashboard() {
  const { user, logout } = useAuth();
  const [operations, setOperations] = useState<WeighingOperation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingCompletions, setPendingCompletions] = useState<Set<string>>(new Set());

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
        .select(
          "id,plate,customer_name,driver_name,product_description,entry_weight_kg,status,created_at,loader_completed_at"
        )
        .eq("unit_id", user.unitId)
        .eq("status", "open")
        .order("created_at", { ascending: true });

      if (error) throw error;
      setOperations((data ?? []).map(mapRow));
      setErrorMessage(null);
    } catch (error) {
      console.error("Error loading operations:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Nao foi possivel carregar a fila de cargas."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCompleteOperation(operation: WeighingOperation) {
    if (!user?.unitId) return;
    if (operation.loaderCompletedAt) return;
    if (pendingCompletions.has(operation.id)) return;

    setPendingCompletions((current) => {
      const next = new Set(current);
      next.add(operation.id);
      return next;
    });

    const optimisticTimestamp = new Date().toISOString();
    setOperations((current) =>
      current.map((item) =>
        item.id === operation.id
          ? { ...item, loaderCompletedAt: optimisticTimestamp }
          : item
      )
    );

    try {
      const { error } = await supabase
        .from("loading_requests")
        .update({ loader_completed_at: optimisticTimestamp })
        .eq("id", operation.id)
        .eq("unit_id", user.unitId)
        .eq("status", "open");

      if (error) throw error;
      setErrorMessage(null);
    } catch (error) {
      console.error("Error completing loading operation:", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Nao foi possivel marcar a carga como concluida."
      );
      setOperations((current) =>
        current.map((item) =>
          item.id === operation.id ? { ...item, loaderCompletedAt: null } : item
        )
      );
    } finally {
      setPendingCompletions((current) => {
        const next = new Set(current);
        next.delete(operation.id);
        return next;
      });
    }
  }

  const inProgressOperations = operations.filter((operation) => !operation.loaderCompletedAt);

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <span style={styles.userName}>{user?.name ?? "Carregador"}</span>
        <button onClick={logout} style={styles.logoutButton}>
          Sair
        </button>
      </header>

      {errorMessage ? (
        <div style={styles.errorBanner} role="alert">
          {errorMessage}
        </div>
      ) : null}

      <section style={styles.board}>
        <section style={styles.column} aria-labelledby="in-progress-title">
          <div style={styles.columnHeader}>
            <div>
              <h2 id="in-progress-title" style={styles.columnTitle}>
                Cargas em andamento
              </h2>
              <p style={styles.columnDescription}>Atenda de cima para baixo. Ao concluir, a carga sai desta lista.</p>
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
                  isSubmitting={pendingCompletions.has(operation.id)}
                  onComplete={() => void handleCompleteOperation(operation)}
                />
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
  isSubmitting,
  onComplete
}: {
  operation: WeighingOperation;
  position: number;
  isSubmitting: boolean;
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

      <button
        onClick={onComplete}
        disabled={isSubmitting}
        style={{
          ...styles.completeButton,
          ...(isSubmitting ? styles.completeButtonDisabled : null)
        }}
      >
        {isSubmitting ? "Enviando..." : "Concluir carga"}
      </button>
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
    alignItems: "center",
    gap: "12px",
    margin: "0 auto 20px",
    maxWidth: "1280px"
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
  board: {
    display: "block",
    maxWidth: "1280px",
    margin: "0 auto"
  },
  column: {
    minHeight: "680px",
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
  cardList: {
    display: "flex",
    flexDirection: "column",
    gap: "14px"
  },
  operationCard: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: "18px",
    padding: "16px",
    boxShadow: "0 12px 34px rgba(15, 23, 42, 0.06)"
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
  completeButtonDisabled: {
    background: "#475569",
    cursor: "not-allowed",
    opacity: 0.7
  },
  errorBanner: {
    maxWidth: "1280px",
    margin: "0 auto 16px",
    background: "#fee2e2",
    border: "1px solid #ef4444",
    borderRadius: "12px",
    padding: "12px 16px",
    color: "#991b1b",
    fontSize: "14px"
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
